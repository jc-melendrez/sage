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
  const avgLevel = (roster.reduce((sum, s) => sum + s.level, 0) / roster.length).toFixed(1);
  const atRisk = roster.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention').length;

  return (
    <View style={styles.row}>
      <StatCard icon="star" value={avgXp} label="Avg XP" color={COLORS.purpleVibrant} />
      <StatCard icon="trending-up" value={`Lv ${avgLevel}`} label="Avg Level" color={COLORS.accent} />
      <StatCard icon="warning" value={atRisk} label="At Risk" color={COLORS.danger} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
});
