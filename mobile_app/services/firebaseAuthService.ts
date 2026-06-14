import { initializeApp } from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import * as SecureStore from 'expo-secure-store';
import { AuthResponse } from './authService';

const FIREBASE_UID_KEY = 'firebase_uid';

// Avatar color palette for deterministic assignment
const PALETTE = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922'];

/**
 * Initialize Firebase Anonymous Auth and sync user to Firestore
 * This is called silently after every login/register
 * @param djangoUser The user object from Django's AuthResponse
 */
export async function initFirebaseAuth(djangoUser: AuthResponse['user']): Promise<void> {
  try {
    // Check if already authenticated
    const currentUser = auth().currentUser;
    if (currentUser) {
      // User is already signed in, skip re-authentication
      const existingUid = await SecureStore.getItemAsync(FIREBASE_UID_KEY);
      if (existingUid) {
        return; // Already initialized
      }
      // If no stored UID, store the current one
      await SecureStore.setItemAsync(FIREBASE_UID_KEY, currentUser.uid);
      return;
    }

    // Sign in anonymously
    const result = await auth().signInAnonymously();
    const firebaseUid = result.user.uid;

    // Build display name
    const firstName = djangoUser.first_name?.trim() || '';
    const lastName = djangoUser.last_name?.trim() || '';
    const displayName = (firstName && lastName)
      ? `${firstName} ${lastName}`
      : firstName || lastName || djangoUser.username;

    // Assign avatar color deterministically
    const avatarColor = PALETTE[djangoUser.id % PALETTE.length];

    // Write user document to Firestore
    await firestore().collection('users').doc(firebaseUid).set({
      djangoUserId: djangoUser.id,
      username: djangoUser.username,
      displayName,
      avatarColor,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });

    // Store Firebase UID securely for later retrieval
    await SecureStore.setItemAsync(FIREBASE_UID_KEY, firebaseUid);
  } catch (error) {
    // Non-blocking: log error but don't throw
    // Firebase auth failure should not prevent the user from being logged in to Django
    console.error('Firebase auth initialization failed (non-blocking):', error);
  }
}

/**
 * Sign out from Firebase and clear stored Firebase UID
 * Called during logout
 */
export async function signOutFirebase(): Promise<void> {
  try {
    await auth().signOut();
    await SecureStore.deleteItemAsync(FIREBASE_UID_KEY);
  } catch (error) {
    // Log silently - don't throw to avoid blocking logout
    console.error('Firebase sign out failed (non-blocking):', error);
  }
}

/**
 * Get the stored Firebase UID
 * This is the primary identifier for Firestore operations
 * @returns The Firebase UID or null if not authenticated
 */
export async function getFirebaseUid(): Promise<string | null> {
  return await SecureStore.getItemAsync(FIREBASE_UID_KEY);
}
