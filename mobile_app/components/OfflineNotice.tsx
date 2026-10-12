import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';

const WARNING = '#F59E0B';

/**
 * Inline offline notice shown directly beneath a tab screen's header.
 *
 * Unlike `OfflineBanner` (which floats app-wide), this is part of the normal
 * layout flow, so it pushes the screen content down instead of covering it.
 * The styling mirrors the Play tab's offline strip, but the text is a darker
 * amber because these tab bodies are white and the Play tab's light `#FDE68A`
 * would be unreadable there.
 */
export default function OfflineNotice() {
  const isOffline = useNetworkStatus();

  if (isOffline !== true) return null;

  return (
    <View style={styles.banner} accessibilityRole="text">
      <Ionicons name="cloud-offline-outline" size={14} color={WARNING} style={styles.icon} />
      <Text style={styles.text}>OFFLINE MODE — some features need a connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  icon: { marginRight: 6 },
  text: {
    flex: 1,
    color: '#B45309',
    fontFamily: 'Montserrat-Bold',
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
