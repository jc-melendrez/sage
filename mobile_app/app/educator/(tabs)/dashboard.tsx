import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { StatCard, SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { StudentRow, StudentSummary } from '@/components/educator/StudentRow';

// --- Mock data (wire up to your API layer, same shape as services/*) ---
const ROSTER: StudentSummary[] = [
  { id: '1', name: 'Amara Chen', level: 12, xp: 840, nextLevelXp: 1000, streak: 14, status: 'onTrack', lastActive: 'today' },
  { id: '2', name: 'Diego Ramos', level: 9, xp: 220, nextLevelXp: 800, streak: 0, status: 'atRisk', lastActive: '6 days ago' },
  { id: '3', name: 'Priya Nair', level: 15, xp: 960, nextLevelXp: 1200, streak: 22, status: 'onTrack', lastActive: 'today' },
  { id: '4', name: 'Owen Blake', level: 7, xp: 310, nextLevelXp: 700, streak: 1, status: 'needsAttention', lastActive: '2 days ago' },
  { id: '5', name: 'Sofia Reyes', level: 11, xp: 705, nextLevelXp: 900, streak: 9, status: 'onTrack', lastActive: 'today' },
];

const ANNOUNCEMENTS = [
  { id: 'a1', title: 'Quiz on Fractions moved to Friday', time: '2h ago' },
  { id: 'a2', title: 'New study group: Algebra Basics', time: '1d ago' },
];

const ACTIVITY = [
  { id: 'e1', icon: 'trophy' as const, text: 'Priya Nair earned the "Streak Master" badge', time: '10m ago', color: COLORS.purpleVibrant },
  { id: 'e2', icon: 'checkmark-done' as const, text: 'Amara Chen completed "Fractions Quiz" — 92%', time: '38m ago', color: COLORS.success },
  { id: 'e3', icon: 'alert-circle' as const, text: 'Diego Ramos missed 3 days of activity', time: '1h ago', color: COLORS.danger },
];

const QUICK_ACTIONS: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { id: 'quiz', label: 'Create Quiz', icon: 'add-circle', route: '/educator/content' },
  { id: 'assign', label: 'Create Assignment', icon: 'document-text', route: '/educator/content' },
  { id: 'analytics', label: 'View Analytics', icon: 'stats-chart', route: '/educator/analytics' },
  { id: 'groups', label: 'Study Groups', icon: 'people', route: '/educator/study-groups' },
];

export default function ClassDashboardScreen() {
  const router = useRouter();
  const [classLabel] = useState('Period 3 · Algebra I');

  const activeToday = ROSTER.filter((s) => s.lastActive === 'today').length;
  const atRisk = ROSTER.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention');
  const avgXp = Math.round(ROSTER.reduce((sum, s) => sum + s.xp, 0) / ROSTER.length);
  const avgLevel = (ROSTER.reduce((sum, s) => sum + s.level, 0) / ROSTER.length).toFixed(1);
  const streakHealth = Math.round((ROSTER.filter((s) => s.streak > 0).length / ROSTER.length) * 100);

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

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Class overview stats */}
        <View style={styles.section}>
          <View style={styles.statsRow}>
            <StatCard icon="star" value={avgXp} label="Avg XP" color={COLORS.purpleVibrant} />
            <StatCard icon="trending-up" value={`Lv ${avgLevel}`} label="Avg Level" color={COLORS.accent} />
            <StatCard icon="warning" value={atRisk.length} label="At Risk" color={COLORS.danger} />
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.section}>
          <SectionHeader title="Quick Actions" />
          <View style={styles.actionsGrid}>
            {QUICK_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={styles.actionCard}
                activeOpacity={0.8}
                onPress={() => router.push(action.route as any)}
              >
                <View style={[styles.actionIconBg, { backgroundColor: tint(COLORS.purplePrimary) }]}>
                  <Ionicons name={action.icon} size={20} color={COLORS.purplePrimary} />
                </View>
                <Text style={styles.actionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* At-risk students callout */}
        {atRisk.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Needs Attention" actionLabel="View all" onAction={() => {}} />
            <View style={styles.listCard}>
              {atRisk.map((s) => (
                <StudentRow key={s.id} student={s} onPress={() => router.push('/educator/student-progress' as any)} />
              ))}
            </View>
          </View>
        )}

        {/* Roster */}
        <View style={styles.section}>
          <SectionHeader title="Student Roster" actionLabel="See all" onAction={() => {}} />
          <View style={styles.listCard}>
            {ROSTER.map((s) => (
              <StudentRow key={s.id} student={s} onPress={() => router.push('/educator/student-progress' as any)} />
            ))}
          </View>
        </View>

        {/* Recent activity */}
        <View style={styles.section}>
          <SectionHeader title="Recent Activity" />
          <View style={styles.listCard}>
            {ACTIVITY.map((item, idx) => (
              <View key={item.id} style={[styles.activityItem, idx > 0 && styles.borderTop]}>
                <View style={[styles.activityIconBox, { backgroundColor: tint(item.color) }]}>
                  <Ionicons name={item.icon} size={18} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityText}>{item.text}</Text>
                  <Text style={styles.activityTime}>{item.time}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Announcements */}
        <View style={styles.section}>
          <SectionHeader title="Recent Announcements" actionLabel="New" onAction={() => router.push('/educator/announcements' as any)} />
          {ANNOUNCEMENTS.length > 0 ? (
            <View style={styles.listCard}>
              {ANNOUNCEMENTS.map((a, idx) => (
                <View key={a.id} style={[styles.announcementItem, idx > 0 && styles.borderTop]}>
                  <Ionicons name="megaphone" size={16} color={COLORS.purpleVibrant} />
                  <Text style={styles.announcementText} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.announcementTime}>{a.time}</Text>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="megaphone-outline" title="No announcements yet" text="Post an update to keep your class in the loop." />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
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

  statsRow: { flexDirection: 'row', gap: 10 },

  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionIconBg: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  actionLabel: { fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },

  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },

  activityItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  activityIconBox: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  activityText: { fontSize: 13.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary, marginBottom: 2 },
  activityTime: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted },

  announcementItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  announcementText: { flex: 1, fontSize: 13.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary },
  announcementTime: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
