import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { DashboardStatsRow } from '@/components/educator/DashboardStatsRow';
import { HostGameCard } from '@/components/educator/HostGameCard';
import { AtRiskSection } from '@/components/educator/AtRiskSection';
import { ROSTER, CLASS_LABEL } from '@/constants/educatorMockData';

export default function ClassDashboardScreen() {
  const classLabel = CLASS_LABEL;
  const atRisk = ROSTER.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention');

  return (
    <View style={styles.container}>
      <EducatorHeader title="Class Dashboard" subtitle={`${classLabel} · ${ROSTER.length} students`} />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <DashboardStatsRow roster={ROSTER} />
        </View>

        <View style={styles.section}>
          <HostGameCard />
        </View>

        <AtRiskSection students={atRisk} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  scrollContent: { paddingBottom: 40 },
  section: { marginBottom: 28 },
});
