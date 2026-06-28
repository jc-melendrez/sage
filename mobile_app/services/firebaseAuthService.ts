import * as SecureStore from 'expo-secure-store';

const FIREBASE_UID_KEY = 'firebase_uid';
const FIREBASE_API_KEY = 'AIzaSyDiz2Aeh8lytaGRfEqB3VlpNzVVe_sLU84';

/**
 * Initialize Firebase Auth.
 * Uses REST API to avoid native SDK SSL issues on some devices.
 */
export async function initFirebaseAuth(): Promise<void> {
  console.log("Firebase Auth service initialized");
}

/**
 * Sign in a user with email and password using Firebase Auth REST API.
 * Returns the Firebase ID Token which will be sent to Django.
 */
export async function signInWithEmail(email: string, password: string): Promise<string> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Sign in failed');

    await SecureStore.setItemAsync(FIREBASE_UID_KEY, data.localId);
    return data.idToken;
  } catch (error) {
    console.error('Firebase sign in failed:', error);
    throw error;
  }
}

/**
 * Create a new user with email and password using Firebase Auth REST API.
 * Returns the Firebase ID Token which will be sent to Django.
 */
export async function signUpWithEmail(email: string, password: string): Promise<string> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Sign up failed');

    await SecureStore.setItemAsync(FIREBASE_UID_KEY, data.localId);
    return data.idToken;
  } catch (error) {
    console.error('Firebase sign up failed:', error);
    throw error;
  }
}

/**
 * Sign out from Firebase Auth REST API.
 */
export async function signOutFirebase(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(FIREBASE_UID_KEY);
  } catch (error) {
    console.error('Firebase sign out failed (non-blocking):', error);
  }
}

/**
 * Get the stored Firebase UID from SecureStore.
 */
export async function getFirebaseUid(): Promise<string | null> {
  return await SecureStore.getItemAsync(FIREBASE_UID_KEY);
}

/**
 * Get the current Firebase user info from stored data.
 */
export async function getCurrentFirebaseUser(): Promise<{ uid: string } | null> {
  const uid = await SecureStore.getItemAsync(FIREBASE_UID_KEY);
  return uid ? { uid } : null;
}