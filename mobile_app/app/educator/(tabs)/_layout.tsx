import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';

import { HapticTab } from '@/components/haptic-tab';
import { useColorScheme } from '@/hooks/use-color-scheme';

// 🔥 Import Tabler icons
import {
  IconHome,
  IconUsers,
  IconBooks,
  IconMessages,
  IconChartBar,
} from '@tabler/icons-react-native';

export const unstable_settings = {
  initialRouteName: 'dashboard',
};

export default function EducatorTabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const setNavBar = async () => {
      try {
        await NavigationBar.setBackgroundColorAsync('#2D1B4E');
        await NavigationBar.setButtonStyleAsync('light');
      } catch (error) {
        console.warn('Failed to set navigation bar:', error);
      }
    };
    setNavBar();
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#ffe081',
        tabBarInactiveTintColor: isDark ? '#f6f0ff' : '#c0a7e7',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#4C1D95',
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
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconHome size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="student-progress"
        options={{
          title: 'Students',
          tabBarIcon: ({ color }) => <IconUsers size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="quiz-manager"
        options={{
          title: 'Content',
          tabBarIcon: ({ color }) => <IconBooks size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="study-groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <IconMessages size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color }) => <IconChartBar size={24} color={color} />,
        }}
      />
      {/* Hidden sub-screens (reachable via push from within tabs) */}
      <Tabs.Screen name="leaderboard" options={{ href: null }} />
      <Tabs.Screen name="assignments" options={{ href: null }} />
      <Tabs.Screen name="announcements" options={{ href: null }} />
      <Tabs.Screen name="ai-insights" options={{ href: null }} />
    </Tabs>
  );
}
