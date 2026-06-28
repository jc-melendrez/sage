import * as SecureStore from 'expo-secure-store';
import auth from '@react-native-firebase/auth';

const FIREBASE_UID_KEY = 'firebase_uid';

export async function initFirebaseAuth(): Promise<void> {
  console.log("Firebase Auth service initialized");
}

/**
 * Sign in with email and password using native Firebase SDK.
 * Returns the Firebase ID Token.
 */
export async function signInWithEmail(email: string, password: string): Promise<string> {
  try {
    const userCredential = await auth().signInWithEmailAndPassword(email, password);
    const idToken = await userCredential.user.getIdToken();
    await SecureStore.setItemAsync(FIREBASE_UID_KEY, userCredential.user.uid);
    return idToken;
  } catch (error) {
    console.error('Firebase sign in failed:', error);
    throw error;
  }
}

/**
 * Sign up with email and password using native Firebase SDK.
 * Returns the Firebase ID Token.
 */
export async function signUpWithEmail(email: string, password: string): Promise<string> {
  try {
    const userCredential = await auth().createUserWithEmailAndPassword(email, password);
    const idToken = await userCredential.user.getIdToken();
    await SecureStore.setItemAsync(FIREBASE_UID_KEY, userCredential.user.uid);
    return idToken;
  } catch (error) {
    console.error('Firebase sign up failed:', error);
    throw error;
  }
}

/**
 * Sign out from Firebase.
 */
export async function signOutFirebase(): Promise<void> {
  try {
    await auth().signOut();
    await SecureStore.deleteItemAsync(FIREBASE_UID_KEY);
  } catch (error) {
    console.error('Firebase sign out failed (non-blocking):', error);
  }
}

/**
 * Get the stored Firebase UID.
 */
export async function getFirebaseUid(): Promise<string | null> {
  return await SecureStore.getItemAsync(FIREBASE_UID_KEY);
}

/**
 * Get the current Firebase user.
 */
export async function getCurrentFirebaseUser(): Promise<{ uid: string } | null> {
  const user = auth().currentUser;
  if (user) return { uid: user.uid };
  const uid = await SecureStore.getItemAsync(FIREBASE_UID_KEY);
  return uid ? { uid } : null;
}