import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { isAuthenticated } from '@/services/authService';
import { testFirebase } from "@/services/firebaseTest";
import { startSyncManager } from '@/services/syncManager';
import { initOfflineQueue } from '@/services/offlineQueue';

import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
  Montserrat_900Black,
} from '@expo-google-fonts/montserrat';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  const [isReady, setIsReady] = useState(false);

  const [fontsLoaded] = useFonts({
    'Montserrat-Regular': Montserrat_400Regular,
    'Montserrat-Medium': Montserrat_500Medium,
    'Montserrat-SemiBold': Montserrat_600SemiBold,
    'Montserrat-Bold': Montserrat_700Bold,
    'Montserrat-ExtraBold': Montserrat_800ExtraBold,
    'Montserrat-Black': Montserrat_900Black,
  });

  useEffect(() => {
    initOfflineQueue();
    const stop = startSyncManager();
    return () => stop();
  }, []);
  useEffect(() => {
    testFirebase();
    const verifyAuth = async () => {
      if (!navigationState?.key) return;

      const loggedIn = await isAuthenticated();
      const inAuthGroup = segments[0] === '(tabs)' || segments.length === 0;

      if (!loggedIn && inAuthGroup) {
        router.replace('/login');
      } else if (loggedIn && segments[0] === 'login') {
        router.replace('/(tabs)');
      }

      setIsReady(true);
    };

    verifyAuth();
  }, [segments, navigationState?.key]);

  if (!isReady || !fontsLoaded) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="game" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
        <Stack.Screen name="superadmin" options={{ headerShown: false }} />
        <Stack.Screen name="educator" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}