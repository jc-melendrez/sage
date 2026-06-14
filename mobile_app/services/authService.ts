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

/**
 * Register a new user
 */
export async function register(credentials: RegisterCredentials): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/register/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      const error = await response.json();
      // Django usually returns objects for registration errors (e.g., {"username": ["already exists"]})
      const errorMessage = error.detail || error.message || (typeof error === 'object' ? Object.values(error).flat()[0] : 'Registration failed');
      throw new Error(errorMessage as string);
    }

    // 🌟 FIX: Registration was successful, but it doesn't return a token.
    // So we automatically log the user in right now to get their tokens!
    return await login({
      username: credentials.username,
      password: credentials.password,
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
}

/**
 * Login user with username and password
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      const error = await response.json();
      // 🌟 FIX: Django SimpleJWT uses "detail", not "message" for login errors
      throw new Error(error.detail || error.message || 'Login failed');
    }

    const data: AuthResponse = await response.json();
    
    // Store tokens securely
    await SecureStore.setItemAsync(TOKEN_KEY, data.access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh);
    
    return data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

/**
 * Get the current user profile using stored token
 */
export async function getCurrentUser() {
  try {
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
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.message || 'Failed to fetch user profile');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
}

/**
 * Get the stored authentication token
 */
export async function getToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Get the stored refresh token
 */
export async function getRefreshToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

/**
 * Logout and clear stored tokens
 */
export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}
