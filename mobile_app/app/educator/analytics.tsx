import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, StatCard, FilterChip, ProgressBar } from '@/components/educator/EducatorPrimitives';

const FILTERS = ['Today', 'Week', 'Month', 'Semester'];

// Mock series (0-100 scale) for the score trend bar chart
const SCORE_TREND = [62, 58, 71, 68, 75, 80, 74];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const ENGAGEMENT_ROWS = [
  { label: 'Daily Active Students', value: '18/24', percent: 75, icon: 'people' as const, color: COLORS.purpleVibrant },
  { label: 'Quiz Completion Rate', value: '82%', percent: 82, icon: 'checkmark-done' as const, color: COLORS.success },
  { label: 'AI Assistant Usage', value: '64%', percent: 64, icon: 'sparkles' as const, color: COLORS.accent },
  { label: 'Study Hours Goal', value: '71%', percent: 71, icon: 'time' as const, color: COLORS.warning },
];

export default function AnalyticsScreen() {
  const [filter, setFilter] = useState('Week');
  const maxScore = Math.max(...SCORE_TREND);

  return (
    <View style={styles.container}>
      <EducatorHeader title="Analytics" subtitle="Period 3 · Algebra I" showBack rightIcon="download-outline" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.statsRow}>
            <StatCard icon="trending-up" value="+12%" label="XP Earned" color={COLORS.purpleVibrant} />
            <StatCard icon="flash" value="1,240" label="Total XP" color={COLORS.accent} />
            <StatCard icon="school" value="46.5h" label="Study Hours" color={COLORS.warning} />
          </View>
        </View>

        {/* Score trend chart */}
        <View style={styles.section}>
          <SectionHeader title="Quiz Score Trend" />
          <View style={styles.chartCard}>
            <View style={styles.chartRow}>
              {SCORE_TREND.map((v, idx) => (
                <View key={idx} style={styles.barColumn}>
                  <View style={styles.barTrack}>
                    <LinearGradient
                      colors={[COLORS.purpleLight, COLORS.purplePrimary]}
                      start={{ x: 0, y: 1 }}
                      end={{ x: 0, y: 0 }}
                      style={[styles.barFill, { height: `${(v / maxScore) * 100}%` }]}
                    />
                  </View>
                  <Text style={styles.barLabel}>{DAY_LABELS[idx]}</Text>
                </View>
              ))}
            </View>
            <View style={styles.chartFooter}>
              <Ionicons name="arrow-up" size={13} color={COLORS.success} />
              <Text style={styles.chartFooterText}>Average score trending up this {filter.toLowerCase()}</Text>
            </View>
          </View>
        </View>

        {/* Engagement breakdown */}
        <View style={styles.section}>
          <SectionHeader title="Engagement" />
          <View style={styles.listCard}>
            {ENGAGEMENT_ROWS.map((row, idx) => (
              <View key={row.label} style={[styles.engagementRow, idx > 0 && styles.borderTop]}>
                <View style={styles.engagementTop}>
                  <View style={styles.engagementLeft}>
                    <View style={[styles.engagementIconBg, { backgroundColor: tint(row.color) }]}>
                      <Ionicons name={row.icon} size={16} color={row.color} />
                    </View>
                    <Text style={styles.engagementLabel}>{row.label}</Text>
                  </View>
                  <Text style={styles.engagementValue}>{row.value}</Text>
                </View>
                <ProgressBar percent={row.percent} height={6} />
              </View>
            ))}
          </View>
        </View>

        {/* AI usage summary */}
        <View style={styles.section}>
          <SectionHeader title="AI Usage This Period" />
          <View style={styles.aiSummaryCard}>
            <Text style={styles.aiSummaryValue}>312</Text>
            <Text style={styles.aiSummaryLabel}>total AI assistant prompts across the class</Text>
            <View style={styles.divider} />
            <Text style={styles.aiTopicsLabel}>Top topics</Text>
            <View style={styles.chipRow}>
              {['Fractions', 'Word problems', 'Order of operations'].map((t) => (
                <View key={t} style={styles.topicChip}>
                  <Text style={styles.topicChipText}>{t}</Text>
                </View>
              ))}
            </View>
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24 },
  statsRow: { flexDirection: 'row', gap: 10 },

  chartCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, marginBottom: 12 },
  barColumn: { alignItems: 'center', flex: 1 },
  barTrack: { width: 18, height: 96, borderRadius: 9, backgroundColor: 'rgba(124,58,237,0.1)', justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 9 },
  barLabel: { fontSize: 10.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, marginTop: 8 },
  chartFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  chartFooterText: { fontSize: 12, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textSecondary },

  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  engagementRow: { paddingVertical: 14 },
  engagementTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  engagementLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  engagementIconBg: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  engagementLabel: { fontSize: 13.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary },
  engagementValue: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },

  aiSummaryCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  aiSummaryValue: { fontSize: 32, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purpleDeep, letterSpacing: -1 },
  aiSummaryLabel: { fontSize: 12.5, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  aiTopicsLabel: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topicChip: { backgroundColor: tint(COLORS.purplePrimary), paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill },
  topicChipText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
});
