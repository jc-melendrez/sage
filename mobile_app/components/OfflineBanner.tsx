import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * App-wide offline indicator. Gameplay screens and the public TV view are
 * excluded: the game screens already signal offline state themselves, and the
 * TV is a viewer display.
 *
 * Inside the tab navigator it floats at the BOTTOM, just above the tab bar, so
 * it can never land on top of the tab screens' full-bleed purple headers (each
 * starts at `insets.top + 20`). On every other screen it keeps the thin top
 * bar, where there is no tab bar to clear.
 *
 * Tapping it bounces to the Play tab, which is where offline solo play lives.
 */
export default function OfflineBanner() {
  const isOffline = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const pathname = usePathname() ?? '';
  const segments = useSegments();
  const router = useRouter();

  if (
    Platform.OS === 'web' ||
    isOffline !== true ||
    pathname.startsWith('/game') ||
    pathname.startsWith('/tv')
  ) {
    return null;
  }

  // Tab screens sit above a 70 + insets.bottom tab bar (see (tabs)/_layout.tsx);
  // other screens have no bar, so the pill just clears the home indicator.
  const inTabs = segments[0] === '(tabs)';

  return (
    <TouchableOpacity
      style={[
        styles.banner,
        inTabs
          ? { bottom: insets.bottom + 70 + 8 }
          : { top: insets.top + 4 },
      ]}
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
    // Opaque, not translucent: the pill now floats over arbitrary screen
    // content at the bottom, so a see-through amber wash would leave the light
    // text unreadable on a pale background. Deep purple keeps the app's palette
    // and gives the amber text a fixed contrast ratio.
    backgroundColor: '#4C1D95',
    borderWidth: 1,
    borderColor: 'rgba(253, 230, 138, 0.5)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
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