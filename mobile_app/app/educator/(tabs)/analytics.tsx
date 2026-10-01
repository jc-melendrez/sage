import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, StatCard, FilterChip, ProgressBar } from '@/components/educator/EducatorPrimitives';
import {
  getCourseAnalytics, getMyCourses,
  type AnalyticsRange, type CourseAnalytics, type CourseRoster,
} from '@/services/courseService';

const FILTERS: { label: string; range: AnalyticsRange }[] = [
  { label: 'Today', range: 'today' },
  { label: 'Week', range: 'week' },
  { label: 'Month', range: 'month' },
  { label: 'Semester', range: 'semester' },
];

/** Monday-first initials for the 7-day bar chart. */
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function initialsFor(isoDate: string): string {
  // Parse as UTC then re-read in UTC: the server sends a bare date, so using
  // local time would shift the label by a day either side of midnight.
  const d = new Date(`${isoDate}T00:00:00Z`);
  const jsDay = d.getUTCDay(); // 0=Sun
  return DAY_LABELS[(jsDay + 6) % 7];
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const [courses, setCourses] = useState<CourseRoster[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [range, setRange] = useState<AnalyticsRange>('week');
  const [data, setData] = useState<CourseAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine = await getMyCourses();
        if (cancelled) return;
        setCourses(mine);
        if (mine.length > 0) setCourseId(mine[0].id);
        else setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Could not load your courses.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (id: number, r: AnalyticsRange) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getCourseAnalytics(id, r));
    } catch {
      // Say so. A stale-looking zero total is indistinguishable from a real
      // "nobody did anything" total, which is exactly the confusion this
      // screen is being rebuilt to remove.
      setError('Could not load analytics. Pull down to retry.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (courseId != null) void load(courseId, range);
  }, [courseId, range, load]);

  const onRefresh = useCallback(async () => {
    if (courseId == null) return;
    setRefreshing(true);
    await load(courseId, range);
    setRefreshing(false);
  }, [courseId, range, load]);

  const chart = useMemo(() => {
    const series = data?.daily_series ?? [];
    const peak = Math.max(1, ...series.map((d) => d.active));
    return series.map((d) => ({ ...d, label: initialsFor(d.date), pct: d.active / peak }));
  }, [data]);

  const engagementRows = useMemo(() => {
    const e = data?.engagement;
    if (!e) return [];
    return [
      { label: 'Daily Active Students', percent: e.daily_active, icon: 'people' as const, color: COLORS.purpleVibrant },
      { label: 'Quiz Participation', percent: e.quiz_participation, icon: 'checkmark-done' as const, color: COLORS.success },
      { label: 'AI Assistant Usage', percent: e.ai_usage, icon: 'sparkles' as const, color: COLORS.accent },
      { label: 'Task Submission Rate', percent: e.submission_rate, icon: 'time' as const, color: COLORS.warning },
    ];
  }, [data]);

  const isEmpty = data != null && data.totals.xp_earned === 0 && data.totals.quiz_attempts === 0
    && chart.every((d) => d.activities === 0);

  return (
    <View style={styles.container}>
      <EducatorHeader title="Analytics" rightIcon="download-outline" />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purplePrimary} />}
      >
        <View style={styles.section}>
          <SectionHeader title="AI Insights" actionLabel="Open" onAction={() => router.push('/educator/ai-insights' as any)} />
          <TouchableOpacity
            style={styles.linkCard}
            activeOpacity={0.8}
            onPress={() => router.push('/educator/ai-insights' as any)}
          >
            <View style={[styles.linkIconBg, { backgroundColor: tint(COLORS.accent) }]}>
              <Ionicons name="sparkles" size={18} color={COLORS.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Actionable AI recommendations</Text>
              <Text style={styles.linkSub}>Trends, at-risk flags, and suggested interventions</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        {courses.length > 1 && (
          <View style={styles.filterRow}>
            {courses.map((c) => (
              <FilterChip
                key={c.id}
                label={c.name}
                active={c.id === courseId}
                onPress={() => setCourseId(c.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <FilterChip key={f.range} label={f.label} active={range === f.range} onPress={() => setRange(f.range)} />
          ))}
        </View>

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.purplePrimary} />
          </View>
        )}

        {error != null && (
          <View style={styles.notice}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        )}

        {data != null && !loading && (
          <>
            <Text style={styles.scopeNote}>{data.course.name}</Text>

            <View style={styles.section}>
              <View style={styles.statsRow}>
                <StatCard
                  icon="trending-up"
                  value={`${data.totals.xp_change_pct >= 0 ? '+' : ''}${data.totals.xp_change_pct}%`}
                  label="XP vs prior"
                  color={COLORS.purpleVibrant}
                />
                <StatCard icon="flash" value={data.totals.xp_earned.toLocaleString()} label="XP Earned" color={COLORS.accent} />
                <StatCard icon="school" value={`${data.totals.study_hours}h`} label="Study Hours" color={COLORS.warning} />
              </View>
            </View>

            <View style={styles.section}>
              <SectionHeader title="Daily Active Students" />
              <View style={styles.chartCard}>
                <View style={styles.chartRow}>
                  {chart.map((d) => (
                    <View key={d.date} style={styles.barColumn}>
                      <View style={styles.barTrack}>
                        <LinearGradient
                          colors={[COLORS.purpleLight, COLORS.purplePrimary]}
                          start={{ x: 0, y: 1 }}
                          end={{ x: 0, y: 0 }}
                          style={[styles.barFill, { height: `${Math.max(d.pct * 100, d.active > 0 ? 6 : 0)}%` }]}
                        />
                      </View>
                      <Text style={styles.barLabel}>{d.label}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.chartFooter}>
                  <Ionicons name="people" size={13} color={COLORS.textSecondary} />
                  <Text style={styles.chartFooterText}>
                    {data.totals.active_students_24h} of {data.roster_size} active in the last 24h
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <SectionHeader title="Engagement" />
              <View style={styles.listCard}>
                {engagementRows.map((row) => (
                  <View key={row.label} style={styles.engagementRow}>
                    <View style={styles.engagementTop}>
                      <View style={styles.engagementLeft}>
                        <View style={[styles.engagementIconBg, { backgroundColor: tint(row.color) }]}>
                          <Ionicons name={row.icon} size={16} color={row.color} />
                        </View>
                        <Text style={styles.engagementLabel}>{row.label}</Text>
                      </View>
                      <Text style={styles.engagementValue}>{row.percent}%</Text>
                    </View>
                    <ProgressBar percent={row.percent} height={6} />
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <SectionHeader title="AI Usage This Period" />
              <View style={styles.aiSummaryCard}>
                <Text style={styles.aiSummaryValue}>{data.totals.ai_prompts}</Text>
                <Text style={styles.aiSummaryLabel}>student prompts sent to the AI assistant</Text>
              </View>
            </View>

            {data.weak_topics.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Concepts Needing Work" />
                <View style={styles.listCard}>
                  {data.weak_topics.map((t, idx) => (
                    <View key={t.title} style={[styles.engagementRow, idx > 0 && styles.borderTop]}>
                      <View style={styles.engagementTop}>
                        <Text style={styles.engagementLabel}>{t.title}</Text>
                        <Text style={styles.engagementValue}>{t.pass_rate}%</Text>
                      </View>
                      <ProgressBar percent={t.pass_rate} height={6} />
                      <Text style={styles.subtle}>{t.attempts} attempts logged</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {data.at_risk.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Needs Attention" />
                <View style={styles.listCard}>
                  {data.at_risk.map((s, idx) => (
                    <View key={s.user_id} style={[styles.atRiskRow, idx > 0 && styles.borderTop]}>
                      <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.engagementLabel}>{s.username}</Text>
                        <Text style={styles.subtle}>{s.reasons.join(' · ')}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {isEmpty && (
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.noticeText}>
                  No recorded activity in this period yet. Once students check in, quizzes, or submit
                  tasks, the figures above fill in.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20, gap: 8 },
  statsRow: { flexDirection: 'row', gap: 10 },
  centered: { paddingVertical: 40, alignItems: 'center' },
  scopeNote: { fontSize: 12.5, fontFamily: FONTS.medium, color: COLORS.textMuted, marginBottom: 12 },

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
  atRiskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  subtle: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 6 },

  aiSummaryCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  aiSummaryValue: { fontSize: 32, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purpleDeep, letterSpacing: -1 },
  aiSummaryLabel: { fontSize: 12.5, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 2 },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 24,
  },
  noticeText: { flex: 1, fontSize: 12.5, fontFamily: FONTS.regular, color: COLORS.textSecondary, lineHeight: 18 },
});