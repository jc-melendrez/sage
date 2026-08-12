import React, { useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { StatCard, SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { StudentRow } from '@/components/educator/StudentRow';
import { ROSTER, CLASS_LABEL } from '@/constants/educatorMockData';

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
  { id: 'courses', label: 'My Courses', icon: 'book', route: '/educator/courses' },
  { id: 'quiz', label: 'Create Quiz', icon: 'add-circle', route: '/educator/quiz-manager' },
  { id: 'assign', label: 'Create Assignment', icon: 'document-text', route: '/educator/assignments' },
  { id: 'analytics', label: 'View Analytics', icon: 'stats-chart', route: '/educator/analytics' },
];

export default function ClassDashboardScreen() {
  const router = useRouter();
  const classLabel = CLASS_LABEL;

  const hostCardScale = useRef(new Animated.Value(1)).current;
  const animatePressIn = () => {
    Animated.spring(hostCardScale, { toValue: 0.96, friction: 8, tension: 120, useNativeDriver: true }).start();
  };
  const animatePressOut = () => {
    Animated.spring(hostCardScale, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }).start();
  };

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

        {/* Host live game */}
        <View style={styles.section}>
          <Animated.View style={{ transform: [{ scale: hostCardScale }] }}>
            <TouchableOpacity
              style={styles.hostCard}
              activeOpacity={0.85}
              onPress={() => router.push('/educator/host-game' as any)}
              onPressIn={animatePressIn}
              onPressOut={animatePressOut}
            >
            <LinearGradient
              colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hostCardGradient}
            >
              <View style={styles.hostCardLeft}>
                <View style={styles.hostIconBox}>
                  <Ionicons name="game-controller" size={24} color="white" />
                </View>
              </View>
              <View style={styles.hostCardBody}>
                <Text style={styles.hostCardTitle}>Host Live Game</Text>
                <Text style={styles.hostCardSub}>Start a live quiz battle and watch students compete in real time</Text>
              </View>
              <View style={styles.hostCardArrow}>
                <Ionicons name="arrow-forward" size={18} color="white" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
          </Animated.View>
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
                <StudentRow key={s.id} student={s} onPress={() => router.push({ pathname: '/educator/student-detail', params: { id: s.id } })} />
              ))}
            </View>
          </View>
        )}

        {/* Roster */}
        <View style={styles.section}>
          <SectionHeader title="Student Roster" actionLabel="See all" onAction={() => {}} />
          <View style={styles.listCard}>
            {ROSTER.map((s) => (
              <StudentRow key={s.id} student={s} onPress={() => router.push({ pathname: '/educator/student-detail', params: { id: s.id } })} />
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

  hostCard: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  hostCardGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
  },
  hostCardLeft: {},
  hostIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hostCardBody: { flex: 1 },
  hostCardTitle: { color: 'white', fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', marginBottom: 3 },
  hostCardSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17 },
  hostCardArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

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
