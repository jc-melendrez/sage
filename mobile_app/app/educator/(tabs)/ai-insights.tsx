import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, StatCard, Pill, Avatar } from '@/components/educator/EducatorPrimitives';

const SESSIONS = [
  { id: 's1', student: 'Amara Chen', prompts: 12, lastTopic: 'Simplifying fractions', flagged: false, time: '20m ago' },
  { id: 's2', student: 'Diego Ramos', prompts: 34, lastTopic: 'Word problem strategies', flagged: false, time: '1h ago' },
  { id: 's3', student: 'Owen Blake', prompts: 3, lastTopic: 'Just give me the answer', flagged: true, time: '2h ago' },
];

const TOPICS = [
  { topic: 'Fractions', count: 58 },
  { topic: 'Word problems', count: 41 },
  { topic: 'Order of operations', count: 29 },
  { topic: 'Decimals', count: 18 },
];

const RECOMMENDATIONS = [
  { id: 'r1', text: 'Several students are struggling with fraction simplification — consider a mini-lesson recap.', icon: 'bulb' as const },
  { id: 'r2', text: "Owen Blake's AI sessions suggest he may be seeking answers rather than understanding — a quick check-in could help.", icon: 'alert-circle' as const },
];

export default function AIInsightsScreen() {
  const totalPrompts = SESSIONS.reduce((sum, s) => sum + s.prompts, 0);
  const flaggedCount = SESSIONS.filter((s) => s.flagged).length;

  return (
    <View style={styles.container}>
      <EducatorHeader title="AI Assistant Insights" subtitle="Review how students use SAGE's AI helper" showBack />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <View style={styles.statsRow}>
            <StatCard icon="chatbubbles" value={SESSIONS.length} label="Sessions" color={COLORS.accent} />
            <StatCard icon="sparkles" value={totalPrompts} label="Prompts" color={COLORS.purpleVibrant} />
            <StatCard icon="flag" value={flaggedCount} label="Flagged" color={COLORS.danger} />
          </View>
        </View>

        {/* Recommendations */}
        <View style={styles.section}>
          <SectionHeader title="Learning Recommendations" />
          <View style={{ gap: 12 }}>
            {RECOMMENDATIONS.map((r) => (
              <View key={r.id} style={styles.recCard}>
                <View style={[styles.recIconBg, { backgroundColor: tint(COLORS.purplePrimary) }]}>
                  <Ionicons name={r.icon} size={18} color={COLORS.purplePrimary} />
                </View>
                <Text style={styles.recText}>{r.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Frequently discussed topics */}
        <View style={styles.section}>
          <SectionHeader title="Frequently Discussed Topics" />
          <View style={styles.listCard}>
            {TOPICS.map((t, idx) => (
              <View key={t.topic} style={[styles.topicRow, idx > 0 && styles.borderTop]}>
                <Text style={styles.topicName}>{t.topic}</Text>
                <Text style={styles.topicCount}>{t.count} prompts</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Student sessions */}
        <View style={styles.section}>
          <SectionHeader title="Student AI Sessions" />
          <View style={{ gap: 12 }}>
            {SESSIONS.map((s) => (
              <TouchableOpacity key={s.id} style={styles.sessionCard} activeOpacity={0.8}>
                <Avatar initials={s.student.split(' ').map((n) => n[0]).join('')} size={40} />
                <View style={{ flex: 1 }}>
                  <View style={styles.sessionTopRow}>
                    <Text style={styles.sessionStudent}>{s.student}</Text>
                    {s.flagged && <Pill label="Flagged" color={COLORS.danger} icon="flag" />}
                  </View>
                  <Text style={styles.sessionTopic} numberOfLines={1}>Asked about: {s.lastTopic}</Text>
                  <Text style={styles.sessionMeta}>{s.prompts} prompts · {s.time}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
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

  recCard: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  recIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  recText: { flex: 1, fontSize: 13, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary, lineHeight: 19 },

  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  topicRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  topicName: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  topicCount: { fontSize: 12.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textSecondary },

  sessionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  sessionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  sessionStudent: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  sessionTopic: { fontSize: 12.5, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginBottom: 2 },
  sessionMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
