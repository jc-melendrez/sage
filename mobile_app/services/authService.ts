import { API_BASE_URL } from '../config/api';
import * as SecureStore from 'expo-secure-store';
import { 
  signInWithEmail, 
  signUpWithEmail, 
  signOutFirebase, 
  getFirebaseUid 
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
 * Hybrid Login: Uses Firebase Auth first, then exchanges the ID token for a Django JWT.
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  // 1. Authenticate with Firebase using email/password
  // Note: We use the username field as the email for Firebase lookup if the user enters an email
  const email = credentials.username.includes('@') ? credentials.username : `${credentials.username}@sage.local`; 
  // Ideally, you should update your UI to ask for Email specifically for Firebase Auth
  
  let idToken: string;
  try {
    // Attempt to sign in. If this fails, we fall back or throw.
    // For Phase 1, let's assume the user is entering their email in the username field
    idToken = await signInWithEmail(credentials.username, credentials.password);
  } catch (firebaseError) {
    // If Firebase fails, you might want to fall back to legacy Django login here
    // or just throw the Firebase error to the user.
    throw new Error('Firebase authentication failed. Please check your email and password.');
  }

  // 2. Exchange Firebase ID Token for Django JWT
  const response = await fetch(`${API_BASE_URL}/users/firebase-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Login handshake with server failed'));
  }

  const data: AuthResponse = await response.json();
  
  // 3. Store Django JWTs
  await SecureStore.setItemAsync(TOKEN_KEY, data.access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh);
  
  return data;
}

/**
 * Hybrid Register: Creates Firebase user first, then syncs to Django.
 */
export async function register(credentials: RegisterCredentials): Promise<AuthResponse> {
  // 1. Create user in Firebase Auth
  let idToken: string;
  try {
    idToken = await signUpWithEmail(credentials.email, credentials.password);
  } catch (firebaseError) {
    throw new Error('Firebase registration failed. This email may already be in use.');
  }

  // 2. Send Firebase ID token to Django to create the profile and get JWTs
  const response = await fetch(`${API_BASE_URL}/users/firebase-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      id_token: idToken,
      // We can pass extra profile data here if we update the Django view to accept it
      username: credentials.username,
      first_name: credentials.first_name,
      last_name: credentials.last_name
    }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(extractErrorMessage(error, 'Registration sync with server failed'));
  }

  const data: AuthResponse = await response.json();
  
  // 3. Store Django JWTs
  await SecureStore.setItemAsync(TOKEN_KEY, data.access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh);
  
  return data;
}

/**
 * Get the current user profile using stored Django token.
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
  await signOutFirebase(); // Sign out of Firebase first
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