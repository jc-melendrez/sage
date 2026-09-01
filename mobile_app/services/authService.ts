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
  is_admin?: boolean;
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
    role?: 'superadmin' | 'admin' | 'educator' | 'student';
    school_id?: number | null;
    is_student?: boolean;
    is_educator?: boolean;
    is_admin?: boolean;
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

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  const response = await fetch(`${API_BASE_URL}/users/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok) { await logout(); return null; }
  const data = await response.json();
  await SecureStore.setItemAsync(TOKEN_KEY, data.access);
  return data.access;
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
      is_admin: credentials.is_admin ?? false,
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
    const newToken = await refreshAccessToken();
    if (newToken) response = await doFetch(newToken);
  }
  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Failed to fetch user profile'));
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

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch { return null; }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.exp) return true;
  return payload.exp * 1000 > Date.now();
}

export function roleHomePath(
  user?: { role?: string; is_admin?: boolean; is_educator?: boolean } | null
): Href {
  if (user?.role === 'superadmin') return '/superadmin';
  if (user?.role === 'admin' || user?.is_admin) return '/admin';
  if (user?.role === 'educator' || user?.is_educator) return '/educator';
  return '/(tabs)';
}