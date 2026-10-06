import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';

/* Shared 2x2 "What can I create?" grid — used on the Create tab. Each tile
 * routes to the dedicated real create flow.
 *
 * The action list is exported so the Home dashboard's CreateFab offers the
 * exact same four destinations; labels/routes can no longer drift per screen.
 */
export interface CreateAction {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route: string;
}

export const CREATE_ACTIONS: CreateAction[] = [
  { id: 'lesson', label: 'Create Lesson', icon: 'book-outline', color: COLORS.purpleVibrant, route: '/educator/lesson-new' },
  { id: 'quiz', label: 'Create Quiz', icon: 'help-circle-outline', color: COLORS.accent, route: '/educator/quiz-manager' },
  // Labels say what the educator is going to do, not which object is created.
  // The game action lands on /game, the same Game Center the student Play tab
  // renders (app/(tabs)/games.tsx re-exports it); it role-gates itself for
  // educators and hands START off to host-session. It has to be the root /game
  // route, not /games — the root layout bounces any non-student role off the
  // (tabs) segment back to their role home (app/_layout.tsx:126-128).
  { id: 'game', label: 'Host Game', icon: 'game-controller-outline', color: COLORS.warning, route: '/game' },
  { id: 'activity', label: 'Assignments', icon: 'document-text-outline', color: COLORS.success, route: '/educator/assignments' },
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
          accessibilityRole="button"
          accessibilityLabel={a.label}
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