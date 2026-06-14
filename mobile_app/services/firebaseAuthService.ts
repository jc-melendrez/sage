import * as SecureStore from 'expo-secure-store';

const FIREBASE_UID_KEY = 'firebase_uid';

/**
 * Firebase sync is now handled server-side by Django.
 * This function is kept for compatibility but does nothing.
 */
export async function initFirebaseAuth(): Promise<void> {
  return;
}

/**
 * Sign out and clear stored Firebase UID
 * Called during logout
 */
export async function signOutFirebase(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(FIREBASE_UID_KEY);
  } catch (error) {
    console.error('Firebase sign out failed (non-blocking):', error);
  }
}

/**
 * Get the stored Firebase UID
 */
export async function getFirebaseUid(): Promise<string | null> {
  return await SecureStore.getItemAsync(FIREBASE_UID_KEY);
}