import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { GestureResponderEvent, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import { Ionicons } from '@expo/vector-icons';
import { HapticTab } from '@/components/haptic-tab';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { COLORS } from '@/constants/educatorTheme';

// 🔥 Import Tabler icons
import { IconHome, IconSchool, IconClipboardList, IconUser } from '@tabler/icons-react-native';

export const unstable_settings = {
  initialRouteName: 'dashboard',
};

/* Visually emphasized center "Create" button — the main educator action. */
function CreateTabButton({ onPress }: { onPress?: (e: GestureResponderEvent) => void }) {
  return (
    <TouchableOpacity style={styles.createTabBtn} onPress={onPress} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Create">
      <Ionicons name="add" size={30} color="#fff" />
    </TouchableOpacity>
  );
}

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
        name="courses"
        options={{
          title: 'Classes',
          tabBarIcon: ({ color }) => <IconSchool size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarButton: (props) => <CreateTabButton onPress={props.onPress} />,
        }}
      />
      <Tabs.Screen
        name="assignments"
        options={{
          title: 'Activities',
          tabBarIcon: ({ color }) => <IconClipboardList size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconUser size={24} color={color} />,
        }}
      />
      {/* Hidden sub-screens (reachable via push from within tabs / deep links) */}
      <Tabs.Screen name="classes" options={{ href: null }} />
      <Tabs.Screen name="content" options={{ href: null }} />
      <Tabs.Screen name="student-detail" options={{ href: null }} />
      <Tabs.Screen name="host-game" options={{ href: null }} />
      <Tabs.Screen name="host-session" options={{ href: null }} />
      <Tabs.Screen name="leaderboard" options={{ href: null }} />
      <Tabs.Screen name="announcements" options={{ href: null }} />
      <Tabs.Screen name="ai-insights" options={{ href: null }} />
      <Tabs.Screen name="quiz-manager" options={{ href: null }} />
      <Tabs.Screen name="study-groups" options={{ href: null }} />
      <Tabs.Screen name="student-progress" options={{ href: null }} />
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="course-detail" options={{ href: null }} />
      <Tabs.Screen name="topic-detail" options={{ href: null }} />
      <Tabs.Screen name="task-submissions" options={{ href: null }} />
      <Tabs.Screen name="add-node" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  createTabBtn: {
    position: 'absolute',
    left: '50%',
    marginLeft: -30,
    top: -26,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.purplePrimary,
    borderWidth: 4,
    borderColor: '#4C1D95',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});