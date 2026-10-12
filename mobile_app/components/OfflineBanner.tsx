import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * App-wide offline indicator. Rendered as a thin amber bar overlapping the top
 * of every native screen (tabs, chat, flashcards, courses, ...). Gameplay
 * screens and the public TV view are excluded: the game screens already signal
 * offline state themselves, and the TV is a viewer display.
 *
 * Tapping it bounces to the Play tab, which is where offline solo play lives.
 */
export default function OfflineBanner() {
  const isOffline = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const pathname = usePathname() ?? '';
  const router = useRouter();

  if (
    Platform.OS === 'web' ||
    isOffline !== true ||
    pathname.startsWith('/game') ||
    pathname.startsWith('/tv')
  ) {
    return null;
  }

  return (
    <TouchableOpacity
      style={[styles.banner, { top: insets.top + 4 }]}
      onPress={() => router.navigate('/(tabs)/games')}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel="You are offline. Tap to go to Play."
    >
      <Ionicons name="cloud-offline-outline" size={14} color="#FDE68A" style={{ marginRight: 6 }} />
      <Text style={styles.text}>OFFLINE MODE — some features need a connection</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    zIndex: 999,
    elevation: 999,
  },
  text: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});