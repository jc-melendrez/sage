import { useEffect, useRef, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, usePathname, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
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

const APP_ROOT_SEGMENTS = new Set([
  '(tabs)',
  'chat',
  'edit-profile',
  'educator',
  'game',
  'login',
  'modal',
  'settings',
  'superadmin',
  'tv',
]);

async function fetchRoleHome() {
  const auth = await import('@/services/authService');
  try {
    const user = await auth.getCurrentUser();
    return auth.roleHomePath(user);
  } catch {
    // Backend fetch failed (offline, waking up, transient 401). Fall back to the
    // role embedded in the stored JWT instead of silently defaulting to student.
    const tokenRole = await auth.getRoleFromToken();
    return auth.roleHomePath(null, tokenRole);
  }
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const navigationState = useRootNavigationState();

  const [isReady, setIsReady] = useState(() => Platform.OS === 'web');
  const stopSyncRef = useRef<(() => void) | null>(null);

  const [fontsLoaded] = useFonts({
    'Montserrat-Regular': Montserrat_400Regular,
    'Montserrat-Medium': Montserrat_500Medium,
    'Montserrat-SemiBold': Montserrat_600SemiBold,
    'Montserrat-Bold': Montserrat_700Bold,
    'Montserrat-ExtraBold': Montserrat_800ExtraBold,
    'Montserrat-Black': Montserrat_900Black,
  });

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let stopped = false;

    (async () => {
      const [{ initOfflineQueue }, { initOfflineGameDb }, { initApiCache }, { startSyncManager }] =
        await Promise.all([
          import('@/services/offlineQueue'),
          import('@/services/offlineGameService'),
          import('@/services/apiCache'),
          import('@/services/syncManager'),
        ]);
      if (stopped) return;
      initOfflineQueue();
      initOfflineGameDb();
      initApiCache();
      stopSyncRef.current = startSyncManager();
    })();

    return () => {
      stopped = true;
      stopSyncRef.current?.();
      stopSyncRef.current = null;
    };
  }, []);

  useEffect(() => {
  if (Platform.OS !== 'web' || !pathname) return;
  const isTvPath = pathname.startsWith('/tv');
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  const isRootRoomCode =
    pathname.split('/').filter(Boolean).length === 1 &&
    /^[a-z0-9]+$/i.test(firstSegment) &&
    !APP_ROOT_SEGMENTS.has(firstSegment);
  if (!isTvPath && !isRootRoomCode) {
    router.replace('/tv');
  }
}, [pathname, router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const verifyAuth = async () => {
      if (!navigationState?.key) return;

      const fbTest = await import('@/services/firebaseTest');
      fbTest.testFirebase();

      const auth = await import('@/services/authService');
      const loggedIn = await auth.isAuthenticated();
      const inAuthGroup = segments[0] === '(tabs)' || segments.length === 0;

      if (!loggedIn && inAuthGroup) {
        router.replace('/login');
      } else if (loggedIn && segments[0] === 'login') {
        router.replace(await fetchRoleHome());
      } else if (loggedIn && segments[0] === '(tabs)') {
        const home = await fetchRoleHome();
        if (home !== '/(tabs)') router.replace(home);
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
        <Stack.Screen name="edit-profile" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="game" options={{ headerShown: false }} />
        <Stack.Screen name="superadmin" options={{ headerShown: false }} />
        <Stack.Screen name="educator" options={{ headerShown: false }} />
        <Stack.Screen name="tv" options={{ headerShown: false }} />
        <Stack.Screen name="[roomCode]" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[groupId]" options={{ headerShown: false, presentation: 'card' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}