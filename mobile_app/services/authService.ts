import { API_BASE_URL } from '../config/api';
import * as SecureStore from 'expo-secure-store';

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
  };
}

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

/** Safely parse JSON from a response, returning null if it fails (e.g. HTML error pages) */
async function safeJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Extract a readable error message from a Django error response */
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
 * Register a new user, then automatically log them in to return tokens.
 */
export async function register(credentials: RegisterCredentials): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/users/register/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, `Registration failed (${response.status})`));
  }

  // Registration succeeded — now log in to get tokens
  return await login({
    username: credentials.username,
    password: credentials.password,
  });
}

/**
 * Login user with username and password.
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/users/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, `Login failed (${response.status})`));
  }

  const data: AuthResponse = await response.json();
  await SecureStore.setItemAsync(TOKEN_KEY, data.access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh);
  return data;
}

/**
 * Get the current user profile using stored token.
 */
export async function getCurrentUser() {
  const token = await getToken();
  if (!token) return null;

  const response = await fetch(`${API_BASE_URL}/users/me/`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Failed to fetch user profile'));
  }

  return await response.json();
}

/**
 * Get the stored authentication token.
 */
export async function getToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Get the stored refresh token.
 */
export async function getRefreshToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

/**
 * Logout and clear stored tokens.
 */
export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

/**
 * Check if user is authenticated.
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}