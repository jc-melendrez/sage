import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { DashboardStatsRow } from '@/components/educator/DashboardStatsRow';
import { HostGameCard } from '@/components/educator/HostGameCard';
import { QuickActionsGrid } from '@/components/educator/QuickActionsGrid';
import { AtRiskSection } from '@/components/educator/AtRiskSection';
import { StudentRosterSection } from '@/components/educator/StudentRosterSection';
import { ActivityFeed } from '@/components/educator/ActivityFeed';
import { AnnouncementsSection } from '@/components/educator/AnnouncementsSection';
import { ROSTER, CLASS_LABEL, ACTIVITY, ANNOUNCEMENTS, QUICK_ACTIONS } from '@/constants/educatorMockData';

export default function ClassDashboardScreen() {
  const classLabel = CLASS_LABEL;
  const activeToday = ROSTER.filter((s) => s.lastActive === 'today').length;
  const streakHealth = Math.round((ROSTER.filter((s) => s.streak > 0).length / ROSTER.length) * 100);
  const atRisk = ROSTER.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention');

  return (
    <View style={styles.container}>
      <EducatorHeader title="Class Dashboard" subtitle={`${classLabel} · ${ROSTER.length} students`}>
        <View style={styles.headerStatsRow}>
          <View style={styles.glassPill}>
            <Ionicons name="pulse" size={14} color={COLORS.accent} />
            <Text style={styles.glassPillText}>{activeToday} active today</Text>
          </View>
          <View style={styles.glassPill}>
            <Ionicons name="flame" size={14} color={COLORS.warning} />
            <Text style={styles.glassPillText}>{streakHealth}% streak health</Text>
          </View>
        </View>
      </EducatorHeader>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <DashboardStatsRow roster={ROSTER} />
        </View>

        <View style={styles.section}>
          <HostGameCard />
        </View>

        <View style={styles.section}>
          <QuickActionsGrid actions={QUICK_ACTIONS} />
        </View>

        <AtRiskSection students={atRisk} />

        <StudentRosterSection students={ROSTER} />

        <ActivityFeed items={ACTIVITY} />

        <AnnouncementsSection items={ANNOUNCEMENTS} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  scrollContent: { paddingBottom: 40 },
  section: { marginBottom: 28 },
  headerStatsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  glassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
  },
  glassPillText: { color: 'white', fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600' },
});
