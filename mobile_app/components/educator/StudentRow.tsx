import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, STATUS, tint } from '@/constants/educatorTheme';
import { Avatar, ProgressBar } from './EducatorPrimitives';

export interface StudentSummary {
  id: string;
  name: string;
  level: number;
  xp: number;
  nextLevelXp: number;
  streak: number;
  status: 'onTrack' | 'atRisk' | 'needsAttention';
  lastActive: string;
}

interface StudentRowProps {
  student: StudentSummary;
  onPress?: () => void;
}

export function StudentRow({ student, onPress }: StudentRowProps) {
  const initials = student.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const percent = Math.min((student.xp / student.nextLevelXp) * 100, 100);
  const statusColor = STATUS[student.status];
  const statusLabel =
    student.status === 'atRisk' ? 'At risk' : student.status === 'needsAttention' ? 'Watch' : 'On track';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Avatar initials={initials} size={44} />
      <View style={styles.middle}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{student.name}</Text>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>
        <View style={styles.progressRow}>
          <ProgressBar percent={percent} height={5} />
        </View>
        <Text style={styles.meta}>
          Lv {student.level} · {student.xp}/{student.nextLevelXp} XP · {student.lastActive}
        </Text>
      </View>
      <View style={styles.right}>
        <View style={[styles.streakBadge, { backgroundColor: tint(COLORS.warning) }]}>
          <Ionicons name="flame" size={12} color={COLORS.warning} />
          <Text style={styles.streakText}>{student.streak}</Text>
        </View>
        <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  middle: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  name: { fontSize: 14.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  progressRow: { marginBottom: 5 },
  meta: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  right: { alignItems: 'flex-end', gap: 4 },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  streakText: { fontSize: 11, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.warning },
  statusLabel: { fontSize: 10, fontFamily: FONTS.semiBold, fontWeight: '600' },
});
