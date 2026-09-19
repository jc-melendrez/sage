import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/educatorTheme';
import { StatCard } from './EducatorPrimitives';
import { StudentSummary } from './StudentRow';

interface DashboardStatsRowProps {
  roster: StudentSummary[];
}

export function DashboardStatsRow({ roster }: DashboardStatsRowProps) {
  const avgXp = Math.round(roster.reduce((sum, s) => sum + s.xp, 0) / roster.length);
  const activeToday = roster.filter((s) => s.lastActive === 'today').length;
  const atRisk = roster.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention').length;

  return (
    <View style={styles.row}>
      <StatCard icon="warning" value={atRisk} label="At Risk" color={COLORS.danger} />
      <StatCard icon="pulse" value={activeToday} label="Active Today" color={COLORS.accent} />
      <StatCard icon="star" value={avgXp} label="Avg XP" color={COLORS.purpleVibrant} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
});