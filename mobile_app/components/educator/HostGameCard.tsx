import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';

export function HostGameCard() {
  const router = useRouter();
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => router.push('/educator/host-game' as any)}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, friction: 8, tension: 120, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }).start()}
      >
        <LinearGradient
          colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.iconBox}>
            <Ionicons name="game-controller" size={24} color="white" />
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>Host Live Game</Text>
            <Text style={styles.sub}>Start a live quiz battle and watch students compete in real time</Text>
          </View>
          <View style={styles.arrow}>
            <Ionicons name="arrow-forward" size={18} color="white" />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  gradient: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: { flex: 1 },
  title: { color: 'white', fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', marginBottom: 3 },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17 },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
