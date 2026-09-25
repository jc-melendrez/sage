import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react'; // ✅ added useEffect
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
    <Tabs
      initialRouteName={isOffline ? 'games' : 'index'}
      screenOptions={{
        tabBarActiveTintColor: '#ffe081',
        tabBarInactiveTintColor: isDark ? '#f6f0ff' : '#c0a7e7',
        headerShown: false,
        tabBarButton: HapticTab,
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
  );
}