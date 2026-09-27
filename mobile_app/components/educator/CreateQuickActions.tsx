import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';

/* Shared 2x2 "What can I create?" grid — used on the educator Home dashboard
 * and the Create tab. Each tile routes to the dedicated real create flow.
 */
interface Action {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route: string;
}

const CREATE_ACTIONS: Action[] = [
  { id: 'lesson', label: 'Create Lesson', icon: 'book-outline', color: COLORS.purpleVibrant, route: '/educator/lesson-new' },
  { id: 'quiz', label: 'Create Quiz', icon: 'help-circle-outline', color: COLORS.accent, route: '/educator/quiz-manager' },
  { id: 'game', label: 'Create Game', icon: 'game-controller-outline', color: '#F59E0B', route: '/educator/host-game' },
  { id: 'activity', label: 'Create Activity', icon: 'document-text-outline', color: '#10B981', route: '/educator/assignments' },
];

export function CreateQuickActions() {
  const router = useRouter();

  return (
    <View style={styles.grid}>
      {CREATE_ACTIONS.map((a) => (
        <TouchableOpacity
          key={a.id}
          style={styles.tile}
          activeOpacity={0.85}
          onPress={() => router.push(a.route as any)}
        >
          <View style={[styles.iconBg, { backgroundColor: tint(a.color) }]}>
            <Ionicons name={a.icon} size={22} color={a.color} />
          </View>
          <Text style={styles.label}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48.5%',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  iconBg: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
});