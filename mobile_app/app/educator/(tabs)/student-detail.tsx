import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { StatCard, SectionHeader, ProgressBar, Pill, Avatar } from '@/components/educator/EducatorPrimitives';
import { getStudentDetail } from '@/constants/educatorMockData';

function scoreColor(score: number) {
  if (score >= 80) return COLORS.success;
  if (score >= 60) return COLORS.warning;
  return COLORS.danger;
}

export default function StudentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const student = getStudentDetail(typeof id === 'string' ? id : '');
  const percent = Math.min((student.xp / student.nextLevelXp) * 100, 100);
  const initials = student.name.split(' ').map((n) => n[0]).join('').toUpperCase();

  return (
    <View style={styles.container}>
      <EducatorHeader title="Student Progress" subtitle={`${student.name} · Level ${student.level}`} showBack rightIcon="chatbubble-ellipses-outline">
        <View style={styles.studentHeaderRow}>
          <Avatar initials={initials} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={styles.studentName}>{student.name}</Text>
            <View style={styles.levelRow}>
              <Ionicons name="star" size={13} color={COLORS.warning} />
              <Text style={styles.levelText}>Level {student.level}</Text>
              <Text style={styles.xpText}>· {student.xp}/{student.nextLevelXp} XP</Text>
            </View>
            <View style={{ marginTop: 8 }}>
              <ProgressBar percent={percent} trackColor="rgba(255,255,255,0.15)" />
            </View>
          </View>
        </View>
      </EducatorHeader>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Leaderboard shortcut */}
        <View style={styles.section}>
          <SectionHeader title="Class Leaderboard" actionLabel="View all" onAction={() => router.push('/educator/leaderboard' as any)} />
          <TouchableOpacity
            style={styles.linkCard}
            activeOpacity={0.8}
            onPress={() => router.push('/educator/leaderboard' as any)}
          >
            <View style={[styles.linkIconBg, { backgroundColor: tint(COLORS.warning) }]}>
              <Ionicons name="podium" size={18} color={COLORS.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>See who&apos;s on top</Text>
              <Text style={styles.linkSub}>This week&apos;s class rankings</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={styles.statsRow}>
            <StatCard icon="flame" value={student.streak} label="Streak" color={COLORS.warning} />
            <StatCard icon="checkmark-done" value={`${student.completionRate}%`} label="Completion" color={COLORS.success} />
            <StatCard icon="time" value={`${student.studyHours}h`} label="Study Time" color={COLORS.accent} />
          </View>
        </View>

        {/* Quiz history */}
        <View style={styles.section}>
          <SectionHeader title="Quiz History" />
          <View style={styles.listCard}>
            {student.quizHistory.map((q, idx) => (
              <View key={q.id} style={[styles.quizItem, idx > 0 && styles.borderTop]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quizTitle}>{q.title}</Text>
                  <Text style={styles.quizDate}>{q.date}</Text>
                </View>
                <Pill label={`${q.score}%`} color={scoreColor(q.score)} />
              </View>
            ))}
          </View>
        </View>

        {/* AI assistant usage */}
        <View style={styles.section}>
          <SectionHeader title="AI Assistant Usage" />
          <View style={styles.aiCard}>
            <View style={[styles.aiIconBg]}>
              <Ionicons name="sparkles" size={22} color={COLORS.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiSessions}>{student.aiSessions} sessions this month</Text>
              <Text style={styles.aiSub}>Frequently asked about: fractions, decimals</Text>
            </View>
          </View>
        </View>

        {/* Badges */}
        <View style={styles.section}>
          <SectionHeader title="Badges" />
          <View style={styles.badgesRow}>
            {student.badges.map((b) => (
              <View key={b.id} style={[styles.badgeCard, !b.earned && { opacity: 0.4 }]}>
                <Text style={styles.badgeEmoji}>{b.emoji}</Text>
                <Text style={styles.badgeName} numberOfLines={1}>{b.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Activity timeline */}
        <View style={styles.section}>
          <SectionHeader title="Recent Activity" />
          <View style={styles.listCard}>
            {student.timeline.map((item, idx) => (
              <View key={item.id} style={[styles.timelineItem, idx > 0 && styles.borderTop]}>
                <View style={[styles.timelineIconBox, { backgroundColor: tint(item.color) }]}>
                  <Ionicons name={item.icon} size={16} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineText}>{item.text}</Text>
                  <Text style={styles.timelineTime}>{item.time}</Text>
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

  studentHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  studentName: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: 'white', marginBottom: 4 },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  levelText: { color: 'white', fontFamily: FONTS.semiBold, fontWeight: '600', fontSize: 13 },
  xpText: { color: COLORS.purplePale, fontFamily: FONTS.medium, fontSize: 13 },

  statsRow: { flexDirection: 'row', gap: 10 },

  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  linkIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  linkTitle: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  linkSub: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },

  quizItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  quizTitle: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  quizDate: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted },

  aiCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  aiIconBg: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(34,211,238,0.15)', justifyContent: 'center', alignItems: 'center' },
  aiSessions: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  aiSub: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  badgesRow: { flexDirection: 'row', gap: 12 },
  badgeCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  badgeEmoji: { fontSize: 26, marginBottom: 6 },
  badgeName: { fontSize: 10.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, textAlign: 'center' },

  timelineItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  timelineIconBox: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  timelineText: { fontSize: 13.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary, marginBottom: 2 },
  timelineTime: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
