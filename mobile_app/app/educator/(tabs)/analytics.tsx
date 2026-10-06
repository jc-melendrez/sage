import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, CARD_SHADOW, tint, SPACE, TYPE } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import {
  SectionHeader,
  StatCard,
  FilterChip,
  ProgressBar,
  EmptyState,
} from '@/components/educator/EducatorPrimitives';
import {
  getCourse,
  getMyCourses,
  getCourseLeaderboard,
  getCoursePath,
  CourseLeaderboard,
  CourseRoster,
  CourseSummary,
} from '@/services/courseService';
import { getQuizzes, Quiz } from '@/services/quizService';
import { getCourseActivities, ClassActivity } from '@/services/activityService';
import { buildStudentRows, CourseStudentRow } from '@/services/courseRoster';
import { buildClassAnalytics } from '@/services/analyticsService';

/** Height of the plot area in px. Bars scale 0-100% against this. */
const PLOT_HEIGHT = 96;

/** Leaderboard entries are per-student but nodes are per-topic, so the course
 *  node total is the denominator for every completion percentage. */
function countNodes(topics: Awaited<ReturnType<typeof getCoursePath>>): number {
  return topics.reduce((sum, topic) => sum + topic.nodes.length, 0);
}

export default function AnalyticsScreen() {
  const router = useRouter();

  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [roster, setRoster] = useState<CourseRoster | null>(null);
  const [leaderboard, setLeaderboard] = useState<CourseLeaderboard | null>(null);
  const [totalNodes, setTotalNodes] = useState(0);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [activities, setActivities] = useState<ClassActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors `selectedId` for the focus effect, which must not list it as a
  // dependency or it would re-run (and re-fetch) on every picker change.
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true);
    try {
      const mine = await getMyCourses();
      setCourses(mine);
      // Land on the first class, but keep an existing selection if it survived.
      setSelectedId((current) =>
        current != null && mine.some((c) => c.id === current) ? current : mine[0]?.id ?? null,
      );
    } catch (err: any) {
      setCourses([]);
      setSelectedId(null);
      setError(err?.message ?? 'Could not load your classes.');
    } finally {
      setCoursesLoading(false);
    }
  }, []);

  const loadClass = useCallback(async (courseId: number) => {
    setLoading(true);
    setError(null);
    try {
      // The roster is the only hard requirement. Everything else degrades on
      // its own: a missing leaderboard zeroes the progress numbers but the
      // students still appear, and a missing quiz or activity list only
      // empties its own section. Same reasoning as course-students.tsx.
      const [course, board, quizList, activityList] = await Promise.all([
        getCourse(courseId),
        getCourseLeaderboard(courseId).catch(() => null),
        getQuizzes(courseId).catch(() => [] as Quiz[]),
        getCourseActivities(courseId).catch(() => [] as ClassActivity[]),
      ]);
      setRoster(course);
      setLeaderboard(board);
      setQuizzes(quizList);
      setActivities(activityList);

      getCoursePath(courseId)
        .then((topics) => setTotalNodes(countNodes(topics)))
        .catch(() => setTotalNodes(0));
    } catch (err: any) {
      setError(err?.message ?? 'Could not load this class.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCourses();
      // Re-read the class on every focus so a tap that lands straight from the
      // course detail screen doesn't paint a stale roster. The ref keeps this
      // callback identity-stable, so the selection effect below isn't run twice.
      const cid = selectedRef.current;
      if (cid != null) loadClass(cid);
    }, [loadCourses, loadClass]),
  );

  // Fires on first selection and on every course-picker change. Not on refocus,
  // which the focus effect above already covered.
  useEffect(() => {
    if (selectedId != null) loadClass(selectedId);
  }, [selectedId, loadClass]);

  const rows: CourseStudentRow[] = useMemo(
    () => buildStudentRows(roster, leaderboard, totalNodes),
    [roster, leaderboard, totalNodes],
  );

  const analytics = useMemo(
    () => buildClassAnalytics(rows, quizzes, activities),
    [rows, quizzes, activities],
  );

  const onRefresh = useCallback(() => {
    loadCourses();
    if (selectedId != null) loadClass(selectedId);
  }, [loadCourses, loadClass, selectedId]);

  const selected = courses.find((c) => c.id === selectedId) ?? null;

  /* Bars scale against a fixed 0-100 axis, not against the tallest bar. The
     old chart normalised to `maxScore`, which meant a class trending up from
     62 to 80 rendered as three flat full-height bars and a short one — the
     improvement the chart exists to show was invisible. */
  const trend = analytics.scoreTrend;
  const meanScore = trend.length
    ? Math.round(trend.reduce((sum, p) => sum + p.averagePercent, 0) / trend.length)
    : 0;
  const hardest = [...trend].sort((a, b) => a.averagePercent - b.averagePercent).slice(0, 3);

  const engagement = [
    {
      label: 'Active this week',
      value: `${analytics.activeThisWeek}/${analytics.students}`,
      percent: analytics.students
        ? Math.round((analytics.activeThisWeek / analytics.students) * 100)
        : 0,
      icon: 'people' as const,
      color: COLORS.purpleVibrant,
    },
    {
      label: 'Quiz participation',
      value: `${analytics.quizParticipation}%`,
      percent: analytics.quizParticipation,
      icon: 'checkmark-done' as const,
      color: COLORS.success,
    },
    {
      label: 'Assignments turned in',
      value: analytics.submissionsExpected
        ? `${analytics.submissionsReceived}/${analytics.submissionsExpected}`
        : '—',
      percent: analytics.assignmentTurnIn,
      icon: 'document-text' as const,
      color: COLORS.accent,
    },
  ];

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Analytics"
        subtitle={selected?.name}
        showBack
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={loading || coursesLoading}
            onRefresh={onRefresh}
            tintColor={COLORS.purpleVibrant}
            colors={[COLORS.purpleVibrant]}
          />
        }
      >
        {/* One class at a time. The period chips this replaced did not change a
            single number; a class picker changes every figure on the screen. */}
        {courses.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.coursePicker}
          >
            {courses.map((course) => (
              <FilterChip
                key={course.id}
                label={course.name}
                active={course.id === selectedId}
                onPress={() => setSelectedId(course.id)}
              />
            ))}
          </ScrollView>
        )}

        {coursesLoading && courses.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
          </View>
        ) : error && courses.length === 0 ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Couldn't load your classes"
            text={error}
          />
        ) : courses.length === 0 ? (
          <EmptyState
            icon="school-outline"
            title="No classes yet"
            text="Create a class to see how your students are doing."
          />
        ) : (
          <>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              </View>
            ) : error ? (
              <EmptyState
                icon="alert-circle-outline"
                title="Couldn't load this class"
                text={error}
              />
            ) : (
              <>
                <View style={styles.statsRow}>
                  <StatCard
                    icon="people"
                    value={analytics.students}
                    label="Students"
                    color={COLORS.purpleVibrant}
                  />
                  <StatCard
                    icon="trending-up"
                    value={`${analytics.averageCompletion}%`}
                    label="Avg done"
                    color={COLORS.success}
                  />
                  <StatCard
                    icon="warning"
                    value={analytics.fallingBehind}
                    label="Falling behind"
                    color={COLORS.danger}
                  />
                </View>

                {/* ---------- Class average by quiz ---------- */}
                <View style={styles.section}>
                  <SectionHeader title="Class Average by Quiz" />
                  {trend.length === 0 ? (
                    <EmptyState
                      icon="bar-chart-outline"
                      title="No quiz results yet"
                      text="Once students complete a quiz in this class its class average appears here."
                    />
                  ) : (
                    <View style={styles.chartCard}>
                      <View style={styles.plot}>
                        {/* Mean sits on the same 0-100 axis as the bars, so it
                            reads against them without a second scale. */}
                        <View
                          style={[styles.meanLine, { bottom: `${meanScore}%` }]}
                          accessibilityRole="image"
                          accessibilityLabel={`Class average across these quizzes is ${meanScore} percent`}
                        />
                        <View style={styles.chartRow}>
                          {trend.map((point) => (
                            <View
                              key={point.quizId}
                              style={styles.barColumn}
                              accessible
                              accessibilityRole="image"
                              accessibilityLabel={`${point.title}: class average ${Math.round(
                                point.averagePercent,
                              )} percent, ${point.attempted} of ${point.enrolled} took it`}
                            >
                              <View style={styles.barTrack}>
                                <LinearGradient
                                  colors={[COLORS.purpleLight, COLORS.purplePrimary]}
                                  start={{ x: 0, y: 1 }}
                                  end={{ x: 0, y: 0 }}
                                  style={[
                                    styles.barFill,
                                    {
                                      height: `${Math.max(
                                        0,
                                        Math.min(100, point.averagePercent),
                                      )}%`,
                                    },
                                  ]}
                                />
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                      <View style={styles.chartLabels}>
                        {trend.map((point) => (
                          <Text key={point.quizId} style={styles.barLabel}>
                            {Math.round(point.averagePercent)}
                          </Text>
                        ))}
                      </View>

                      <View style={styles.chartFooter}>
                        <Ionicons name="calendar-outline" size={13} color={COLORS.textSecondary} />
                        <Text style={styles.chartFooterText}>
                          Oldest to newest · {trend.length} quiz{trend.length === 1 ? '' : 'es'} ·
                          mean {meanScore}%
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* The chart shows every quiz; this names the ones worth
                    reteaching, which a bar grid alone does not convey. */}
                {hardest.length > 0 && (
                  <View style={styles.section}>
                    <SectionHeader title="Lowest Averages" />
                    <View style={styles.listCard}>
                      {hardest.map((point, idx) => (
                        <View
                          key={point.quizId}
                          style={[styles.hardestRow, idx > 0 && styles.borderTop]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.hardestTitle} numberOfLines={1}>
                              {point.title}
                            </Text>
                            <Text style={styles.hardestSub}>
                              {point.attempted} of {point.enrolled} took it
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.hardestPercent,
                              point.averagePercent < 60 && { color: COLORS.danger },
                            ]}
                          >
                            {Math.round(point.averagePercent)}%
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* ---------- Engagement ---------- */}
                <View style={styles.section}>
                  <SectionHeader title="Engagement" />
                  <View style={styles.listCard}>
                    {engagement.map((row, idx) => (
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

                <TouchableOpacity
                  style={styles.linkCard}
                  activeOpacity={0.8}
                  onPress={() => router.push('/educator/ai-insights' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="AI Insights"
                >
                  <View style={[styles.linkIconBg, { backgroundColor: tint(COLORS.accent) }]}>
                    <Ionicons name="sparkles" size={18} color={COLORS.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkTitle}>AI Insights</Text>
                    <Text style={styles.linkSub}>Review how students use the AI helper</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: SPACE.xl },
  section: { marginTop: SPACE.xxl },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: SPACE.lg },

  coursePicker: { paddingBottom: SPACE.lg, paddingRight: 24 },

  // CARD_SHADOW is load-bearing, not decoration: `surface` sits at 1.08:1
  // against `bg`, so without it the cards don't read as raised objects.
  chartCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACE.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...CARD_SHADOW,
  },
  plot: { height: PLOT_HEIGHT, justifyContent: 'flex-end' },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', height: PLOT_HEIGHT },
  barColumn: { alignItems: 'center', flex: 1 },
  barTrack: {
    width: 18,
    height: PLOT_HEIGHT,
    borderRadius: 9,
    backgroundColor: tint(COLORS.purplePrimary, 0.1),
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 9 },
  meanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.textMuted,
  },
  chartLabels: { flexDirection: 'row', marginTop: SPACE.sm },
  barLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: TYPE.meta,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  chartFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACE.md,
    paddingTop: SPACE.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  chartFooterText: {
    fontSize: TYPE.meta,
    fontFamily: FONTS.medium,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },

  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...CARD_SHADOW,
  },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },

  hardestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    minHeight: 44,
  },
  hardestTitle: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  hardestSub: {
    fontSize: TYPE.meta,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  hardestPercent: {
    fontSize: TYPE.body,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  engagementRow: { paddingVertical: SPACE.lg },
  engagementTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACE.md,
  },
  engagementLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  engagementIconBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  engagementLabel: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  engagementValue: {
    fontSize: TYPE.body,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACE.md,
    marginTop: SPACE.xxl,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...CARD_SHADOW,
    minHeight: 44,
  },
  linkIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkTitle: {
    fontSize: TYPE.body,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  linkSub: {
    fontSize: TYPE.meta,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
  },
});