import * as SecureStore from 'expo-secure-store';
import auth from '@react-native-firebase/auth';
import { Platform } from 'react-native';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

const FIREBASE_UID_KEY = 'firebase_uid';

// Web client ID from google-services.json (client_type: 3, sage-a47b8).
const GOOGLE_WEB_CLIENT_ID =
  '247748344557-3okb778k116hb7njoulubquef5l3oji3.apps.googleusercontent.com';

let googleConfigured = false;

export async function initFirebaseAuth(): Promise<void> {
  if (!googleConfigured) {
    try {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
      }
      googleConfigured = true;
    } catch (e) {
      console.error('Google Sign-In configuration failed:', e);
    }
  }
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
 * Sign in with Google using the native Google account picker.
 * Returns the Firebase ID Token.
 */
export async function signInWithGoogle(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Google sign-in is not available on web. Use email and password.');
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signIn();
    const idToken = await GoogleSignin.getTokens();
    const credential = auth.GoogleAuthProvider.credential(idToken.idToken);
    const userCredential = await auth().signInWithCredential(credential);
    const firebaseIdToken = await userCredential.user.getIdToken();
    await SecureStore.setItemAsync(FIREBASE_UID_KEY, userCredential.user.uid);
    return firebaseIdToken;
  } catch (error: any) {
    if (error?.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Google sign-in was cancelled.');
    }
    console.error('Google sign in failed:', error);
    throw error;
  }
}

/**
 * Sign out from both Google and Firebase.
 */
export async function signOutFirebase(): Promise<void> {
  try {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Not signed in with Google — ignore.
    }
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