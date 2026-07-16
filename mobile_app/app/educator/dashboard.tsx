import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { StatCard, SectionHeader } from '@/components/educator/EducatorPrimitives';
import { StudentRow, StudentSummary } from '@/components/educator/StudentRow';

// --- Mock data (wire up to your API layer, same shape as services/*) ---
const ROSTER: StudentSummary[] = [
  { id: '1', name: 'Amara Chen', averageGrade: 91, status: 'onTrack', lastActive: 'today' },
  { id: '2', name: 'Diego Ramos', averageGrade: 58, status: 'atRisk', lastActive: '6 days ago' },
  { id: '3', name: 'Priya Nair', averageGrade: 88, status: 'onTrack', lastActive: 'today' },
  { id: '4', name: 'Owen Blake', averageGrade: 67, status: 'needsAttention', lastActive: '2 days ago' },
  { id: '5', name: 'Sofia Reyes', averageGrade: 84, status: 'onTrack', lastActive: 'today' },
];

const ACTIVITY = [
  { id: 'e1', icon: 'checkmark-done' as const, text: 'Amara Chen completed "Fractions Quiz" — 92%', time: '38m ago', color: COLORS.success },
  { id: 'e2', icon: 'alert-circle' as const, text: 'Diego Ramos missed the last 3 quizzes', time: '1h ago', color: COLORS.danger },
];

const QUICK_ACTIONS: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { id: 'quiz', label: 'Create Quiz', icon: 'add-circle', route: '/educator/quiz-manager' },
  { id: 'analytics', label: 'View Analytics', icon: 'stats-chart', route: '/educator/analytics' },
];

export default function ClassDashboardScreen() {
  const router = useRouter();
  const [classLabel] = useState('Period 3 · Algebra I');

  const atRisk = ROSTER.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention');
  const avgGrade = Math.round(ROSTER.reduce((sum, s) => sum + s.averageGrade, 0) / ROSTER.length);

  return (
    <View style={styles.container}>
      <EducatorHeader title="Class Dashboard" subtitle={`${classLabel} · ${ROSTER.length} students`} />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Class overview stats */}
        <View style={styles.section}>
          <View style={styles.statsRow}>
            <StatCard icon="stats-chart" value={`${avgGrade}%`} label="Avg Grade" color={COLORS.purpleVibrant} />
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
            <SectionHeader title="Needs Attention" />
            <View style={styles.listCard}>
              {atRisk.map((s) => (
                <StudentRow key={s.id} student={s} onPress={() => router.push('/educator/student-progress' as any)} />
              ))}
            </View>
          </View>
        )}

        {/* Roster */}
        <View style={styles.section}>
          <SectionHeader title="Student Roster" />
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },

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
});