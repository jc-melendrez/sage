import { Tabs, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react'; // ✅ added useEffect
import { Keyboard, Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar'; // ✅ import

import { HapticTab } from '@/components/haptic-tab';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// 🔥 Import Tabler icons
import {
  IconHome,
  IconBook,
  IconDeviceGamepad2,
  IconSparkles,
  IconUser,
} from '@tabler/icons-react-native';

/**
 * Visible tabs, in the order the bar shows them. A swipe advances one step
 * through this list — the same list the tab bar draws — so the order can
 * never drift from the UI.
 */
const VISIBLE_TABS = [
  { key: 'index', path: '/' },
  { key: 'activities', path: '/activities' },
  { key: 'games', path: '/games' },
  { key: 'ai-assistant', path: '/ai-assistant' },
  { key: 'profile', path: '/profile' },
];

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then(state => {
      if (mounted) setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // ✅ Set system navigation bar color (Android only) – different from tab bar
  useEffect(() => {
    const setNavBar = async () => {
      try {
        // 🔥 System bar color – change this to any color you like
        await NavigationBar.setBackgroundColorAsync('#2D1B4E'); // e.g., darker purple

        // Optional: also set button style for contrast
        // 'light' = white buttons, 'dark' = black buttons
        await NavigationBar.setButtonStyleAsync('light');
      } catch (error) {
        console.warn('Failed to set navigation bar:', error);
      }
    };
    setNavBar();
  }, []);

  if (isOffline === null) return null;

  return (
    <SwipeTabs offline={isOffline}>
      <Tabs
      initialRouteName={isOffline ? 'games' : 'index'}
      screenOptions={{
        tabBarActiveTintColor: '#ffe081',
        tabBarInactiveTintColor: isDark ? '#f6f0ff' : '#c0a7e7',
        headerShown: false,
        tabBarButton: HapticTab,
      // The AI assistant composes messages from a tab screen, and the bar was
      // covering the bottom of the input with the keyboard up. Hiding it is the
      // fix; `keyboardHidesTabBar` in app.json alone did nothing on Android.
      tabBarHideOnKeyboard: true,
        tabBarStyle: {
          // 🔥 Tab bar color (your choice)
          backgroundColor: '#4C1D95', // purple
          borderTopWidth: 0,
          height: 70 + insets.bottom,
          paddingBottom: insets.bottom + 10,
          paddingTop: 7,
          elevation: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.03,
          shadowRadius: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: -4,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconHome size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="activities"
        options={{
          title: 'Activities',
          tabBarIcon: ({ color }) => <IconBook size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="games"
        options={{
          title: 'Play',
          tabBarIcon: ({ color }) => <IconDeviceGamepad2 size={24} color={color} />,
          ...(isOffline ? { tabBarStyle: { display: 'none' as const } } : {}),
        }}
      />
      <Tabs.Screen
        name="ai-assistant"
        options={{
          title: 'AI Assistant',
          tabBarIcon: ({ color }) => <IconSparkles size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconUser size={24} color={color} />,
        }}
      />
      <Tabs.Screen name="leaderboard" options={{ href: null }} />
      {/* Solo mode (flashcards) lives as a tab so the bottom tab bar stays visible & interactive */}
      <Tabs.Screen name="flashcards" options={{ href: null }} />
      {/* Course/class screens also live as a hidden tab so the bottom bar stays visible */}
      <Tabs.Screen name="course" options={{ href: null }} />
      {/* Explicitly hide unwanted tabs that exist as files in the directory */}
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="dashboard" options={{ href: null }} />
    </Tabs>
    </SwipeTabs>
  );
}

/**
 * Gesture layer for swiping between the visible tabs.
 *
 * This wraps the navigator instead of floating above it. An absolute-fill
 * handler view would sit on top of every screen and swallow the taps and
 * scrolls meant for the content underneath, because React Native hit-tests
 * the topmost view first. Here the handler is on a parent of the navigator,
 * so the gesture layer sees touches from any screen and RNGH only takes the
 * touch once the pan actually activates.
 *
 * Activation rules do the rest:
 *   activeOffsetX  — nothing happens until the finger has moved ~20px
 *                    horizontally, so a stray jitter never changes tabs.
 *   failOffsetY    — a vertical drag fails the pan outright, handing the
 *                    gesture back to the scroll view that wanted it.
 *
 * Deliberately inert while the keyboard is up (a two-thumb keyboard swipe
 * should edit text, not change tabs) and on hidden-tab screens such as
 * /course/:12, where "where you are" has no visible tab to move from.
 */
function SwipeTabs({ children, offline }: { children: React.ReactNode; offline: boolean }) {
  const router = useRouter();
  const segments = useSegments();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Offline hides the Play tab's button, so the swipe cycle skips it too —
  // otherwise a swipe could land on a tab the bar no longer offers.
  const order = useMemo(
    () => (offline ? VISIBLE_TABS.filter(t => t.key !== 'games') : VISIBLE_TABS),
    [offline],
  );

  const gesture = useMemo(() => {
    const insideTabs = String(segments[0] ?? '') === '(tabs)';
    const currentKey = String(segments[1] ?? 'index');
    const from = order.findIndex(t => t.key === currentKey);
    const enabled = !keyboardVisible && insideTabs && from >= 0;

    return Gesture.Pan()
      .enabled(enabled)
      .activeOffsetX([-20, 20])
      .failOffsetY([-20, 20])
      .onEnd(e => {
        // A flick counts too: a fast swipe rarely travels far before release.
        const committed = Math.abs(e.translationX) > 70 || Math.abs(e.velocityX) > 500;
        if (!committed || from < 0) return;
        const target = from + (e.translationX < 0 ? 1 : -1);
        if (target < 0 || target >= order.length) return;
        router.navigate(order[target].path as any);
      });
  }, [segments, keyboardVisible, order, router]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}