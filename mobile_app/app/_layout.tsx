import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { isAuthenticated, getToken, getCurrentUser } from '@/services/authService';
import { getFirebaseUid, initFirebaseAuth } from '@/services/firebaseAuthService';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const verifyAuth = async () => {
      if (!navigationState?.key) return;

      const loggedIn = await isAuthenticated();
      const inAuthGroup = segments[0] === '(tabs)' || segments.length === 0;

      if (!loggedIn && inAuthGroup) {
        router.replace('/login');
      } else if (loggedIn && segments[0] === 'login') {
        router.replace('/(tabs)');
      }

      if (loggedIn) {
        const token = await getToken();
        const fbUid = await getFirebaseUid();
        if (token && !fbUid) {
          try {
            const user = await getCurrentUser();
            if (user) {
              await initFirebaseAuth(user);
            }
          } catch (error) {
            console.error('Firebase recovery initialization failed:', error);
          }
        }
      }

      setIsReady(true);
    };

    verifyAuth();
  }, [segments, navigationState?.key]);

  if (!isReady) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="game" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}