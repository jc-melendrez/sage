import { API_BASE_URL } from '../config/api';
import * as SecureStore from 'expo-secure-store';
import type { Href } from 'expo-router';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOutFirebase,
} from './firebaseAuthService';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  is_student?: boolean;
  is_educator?: boolean;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: {
    id: number;
    username: string;
    email: string;
    first_name?: string;
    last_name?: string;
    firebase_uid?: string;
    role?: 'superadmin' | 'educator' | 'student';
    is_student?: boolean;
    is_educator?: boolean;
  };
}

/** Response from the login endpoint when an emailed OTP is required first. */
export interface OtpChallengeResponse {
  otp_required: true;
  challenge_token: string;
  email: string;
  expires_in: number;
}

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. If using Render\u2019s free tier, the server may be waking up \u2014 try again in a minute.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type RefreshResult =
  | { ok: true; access: string }
  | { ok: false; reason: 'expired' | 'transient' };

const REFRESH_TIMEOUT_MS = 10000;
const REFRESH_RETRY_DELAY_MS = 1500;

let refreshInFlight: Promise<RefreshResult> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyRefreshResponse(status: number, body: unknown): 'ok' | 'expired' | 'transient' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'expired';
  const text = typeof body === 'string'
    ? body.toLowerCase()
    : JSON.stringify(body ?? '').toLowerCase();
  if (
    status >= 400 &&
    status < 500 &&
    /token_not_valid|invalid or expired|revoked|user not found/.test(text)
  ) {
    return 'expired';
  }
  return 'transient';
}

async function attemptRefresh(refresh: string, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_BASE_URL}/users/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
    signal,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function doRefresh(): Promise<RefreshResult> {
  const refresh = await getRefreshToken();
  if (!refresh) return { ok: false, reason: 'expired' };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let status = 0;
    let body: unknown = null;
    try {
      const result = await attemptRefresh(refresh, controller.signal);
      status = result.status;
      body = result.body;
    } catch {
      status = 0;
    } finally {
      clearTimeout(timer);
    }

    const verdict = classifyRefreshResponse(status, body);
    if (verdict === 'ok') {
      const access = (body as { access?: string })?.access;
      if (access) {
        await SecureStore.setItemAsync(TOKEN_KEY, access);
        return { ok: true, access };
      }
      return { ok: false, reason: 'transient' };
    }
    if (verdict === 'expired') {
      await logout();
      return { ok: false, reason: 'expired' };
    }
    if (attempt === 0) await sleep(REFRESH_RETRY_DELAY_MS);
  }
  return { ok: false, reason: 'transient' };
}

/**
 * Refresh the access token, riding through transient backend restarts/wake-ups
 * (e.g. Render free-tier waking up). The session is only logged out when the
 * server definitively rejects the token (401/403 or token_not_valid); on any
 * transient failure (5xx, timeout, network) the stored tokens are kept intact
 * so callers can retry instead of force-logging the user out.
 */
export function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function safeJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractErrorMessage(error: any, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error.detail) return error.detail;
  if (error.message) return error.message;
  if (typeof error === 'object') {
    const first = Object.values(error).flat()[0];
    if (typeof first === 'string') return first;
  }
  return fallback;
}

/**
 * Login: Firebase Auth → Django JWT (possibly via emailed OTP).
 *
 * Email/password logins return an OtpChallengeResponse (no tokens yet).
 * Call verifyOtp() with the code the user received to finish the login.
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse | OtpChallengeResponse> {
  // 1. Sign in with Firebase using email
  const idToken = await signInWithEmail(credentials.username, credentials.password);

  // 2. Exchange Firebase ID token for Django JWT (or an OTP challenge)
  const response = await fetchWithTimeout(`${API_BASE_URL}/users/firebase-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Login failed.'));
  }

  const data = await response.json();

  if (data.otp_required) {
    return data as OtpChallengeResponse;
  }

  await storeTokens(data);
  return data as AuthResponse;
}

/**
 * Verify the emailed OTP and finish the login (issues the JWT pair).
 */
export async function verifyOtp(challengeToken: string, otp: string): Promise<AuthResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/users/firebase-login/verify-otp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_token: challengeToken, otp }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Verification failed.'));
  }

  const data = await response.json();
  await storeTokens(data);
  return data;
}

/**
 * Login with Google: Firebase Google credential → Django JWT (no OTP).
 */
export async function loginWithGoogle(): Promise<AuthResponse> {
  // 1. Sign in with Google and exchange for a Firebase credential
  const idToken = await signInWithGoogle();

  // 2. Exchange Firebase ID token for Django JWT
  const response = await fetchWithTimeout(`${API_BASE_URL}/users/firebase-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Google sign-in failed.'));
  }

  const data = await response.json();
  await storeTokens(data);
  return data;
}

/**
 * Register: Firebase Auth → Django JWT (via the same OTP login flow).
 */
export async function register(credentials: RegisterCredentials): Promise<AuthResponse | OtpChallengeResponse> {
  // 1. Create Firebase user
  const idToken = await signUpWithEmail(credentials.email, credentials.password);

  // 2. Sync to Django — the backend replies with an OTP challenge
  const response = await fetchWithTimeout(`${API_BASE_URL}/users/firebase-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_token: idToken,
      username: credentials.username,
      first_name: credentials.first_name || '',
      last_name: credentials.last_name || '',
      is_student: credentials.is_student ?? true,
      is_educator: credentials.is_educator ?? false,
    }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Registration failed.'));
  }

  const data = await response.json();

  if (data.otp_required) {
    return data as OtpChallengeResponse;
  }

  await storeTokens(data);
  return data as AuthResponse;
}

async function storeTokens(data: AuthResponse): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, data.access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh);
}

/**
 * Get the current user profile using stored Django token.
 */
export async function getCurrentUser() {
  let token = await getToken();
  if (!token) return null;
  const doFetch = async (tok: string) => {
    return fetch(`${API_BASE_URL}/users/me/`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
    });
  };
  let response = await doFetch(token);
  if (response.status === 401) {
    const result = await refreshAccessToken();
    if (result.ok) {
      response = await doFetch(result.access);
    } else if (result.reason === 'transient') {
      throw new Error('Backend is still waking up — please retry.');
    }
  }
  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Failed to fetch user profile'));
  }
  return await response.json();
}

/**
 * Update the current user's editable profile fields (first_name, last_name).
 * Returns the updated profile.
 */
export async function updateProfile(fields: {
  first_name?: string;
  last_name?: string;
}) {
  let token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const doFetch = async (tok: string) =>
    fetch(`${API_BASE_URL}/users/me/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
      body: JSON.stringify(fields),
    });
  let response = await doFetch(token);
  if (response.status === 401) {
    const result = await refreshAccessToken();
    if (result.ok) {
      response = await doFetch(result.access);
    } else if (result.reason === 'transient') {
      throw new Error('Backend is still waking up — please retry.');
    }
  }
  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Failed to update profile'));
  }
  return await response.json();
}

export async function getToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function logout(): Promise<void> {
  await signOutFirebase();
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload || !payload.exp) return true;
  return payload.exp * 1000 > Date.now();
}

export async function getCachedUserId(): Promise<number | null> {
  const token = await getToken();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload || payload.user_id == null) return null;
  const id = Number(payload.user_id);
  return Number.isFinite(id) ? id : null;
}

export function roleHomePath(
  user?: { role?: string; is_educator?: boolean } | null
): Href {
  if (user?.role === 'superadmin') return '/superadmin';
  if (user?.role === 'educator' || user?.is_educator) return '/educator';
  return '/(tabs)';
}