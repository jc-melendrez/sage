import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint, composite, readableOn, SPACE } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState, Pill } from '@/components/educator/EducatorPrimitives';
import { CreateQuickActions } from '@/components/educator/CreateQuickActions';
import { getCurrentUser } from '@/services/authService';
import { getMyCourses, CourseSummary } from '@/services/courseService';
import { getActivities, ClassActivity, ActivityKind } from '@/services/activityService';
import { describeDue } from '@/services/dueDate';

const ACTIVITY_META: Record<ActivityKind, { icon: any; color: string }> = {
  quiz: { icon: 'help-circle', color: COLORS.purpleVibrant },
  lesson: { icon: 'book', color: COLORS.accent },
  game: { icon: 'game-controller', color: COLORS.success },
  task: { icon: 'document-text', color: COLORS.warning },
};

const REVIEW_COLOR = COLORS.warning;
const OVERDUE_COLOR = COLORS.danger;

const OVERDUE_TEXT = readableOn(OVERDUE_COLOR, COLORS.surface);
const REVIEW_TEXT = readableOn(REVIEW_COLOR, COLORS.surface);
// The shared textMuted token is 4.45:1 on surface — a hair under AA, and it
// is used far too widely to change. Resolve a local step for this row instead.
const DUE_TEXT = readableOn(COLORS.textMuted, COLORS.surface);
const RETRY_TEXT = readableOn(COLORS.purpleVibrant, composite(COLORS.purpleVibrant, 0.15, COLORS.surface));

/** How many rows each list shows before deferring to the full Assignments tab. */
const REVIEW_PREVIEW = 3;
const ACTIVITY_PREVIEW = 5;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'T';
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/** Submissions still waiting on a grade. Backed by the same fields the API already returns. */
function ungradedCount(a: ClassActivity): number {
  return Math.max(0, (a.submission_count ?? 0) - (a.graded_count ?? 0));
}

interface Ranked {
  activity: ClassActivity;
  due: ReturnType<typeof describeDue>;
}

/**
 * Urgency order: overdue first, then soonest deadline, then undated.
 * Ties break on the most submissions waiting, then newest first. Every
 * activity appears exactly once, so no section repeats another.
 */
function rankActivities(list: ClassActivity[]): Ranked[] {
  const rows: Ranked[] = list.map((activity) => ({ activity, due: describeDue(activity.due_date) }));

  const tier = (r: Ranked) => (r.due.isOverdue ? 0 : Number.isFinite(r.due.daysLeft) ? 1 : 2);

  return rows.sort((x, y) => {
    const tx = tier(x);
    const ty = tier(y);
    if (tx !== ty) return tx - ty;
    if (tx === 1 && x.due.daysLeft !== y.due.daysLeft) return x.due.daysLeft - y.due.daysLeft;

    const waiting = ungradedCount(y.activity) - ungradedCount(x.activity);
    if (waiting !== 0) return waiting;

    return new Date(y.activity.created_at).getTime() - new Date(x.activity.created_at).getTime();
  });
}

export default function EducatorDashboardScreen() {
  const router = useRouter();

  const [teacherName, setTeacherName] = useState('Teacher');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [activities, setActivities] = useState<ClassActivity[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [classesFailed, setClassesFailed] = useState(false);
  const [activitiesFailed, setActivitiesFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadTeacher = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
        setTeacherName(name || 'Teacher');
      }
    } catch {
      /* keep default greeting name */
    }
  }, []);

  const loadCourses = useCallback(async () => {
    try {
      setCourses(await getMyCourses());
      setClassesFailed(false);
    } catch {
      // Previously swallowed, which made an outage look identical to an
      // empty account. Surface it so the educator knows to retry.
      setClassesFailed(true);
    } finally {
      setLoadingClasses(false);
    }
  }, []);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await getActivities());
      setActivitiesFailed(false);
    } catch {
      setActivitiesFailed(true);
    } finally {
      setLoadingActivities(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadTeacher(), loadCourses(), loadActivities()]);
    setRefreshing(false);
  }, [loadTeacher, loadCourses, loadActivities]);

  useFocusEffect(
    useCallback(() => {
      loadTeacher();
      loadCourses();
      loadActivities();
    }, [loadTeacher, loadCourses, loadActivities])
  );

  // Two disjoint slices of one ranked list. Splitting on "is there grading
  // to do" keeps the queue actionable and stops the same activity appearing
  // under two headings, which is what the old two-section feed did.
  const { reviewQueue, upcoming } = useMemo(() => {
    const ranked = rankActivities(activities);
    return {
      reviewQueue: ranked.filter((r) => ungradedCount(r.activity) > 0),
      upcoming: ranked.filter((r) => ungradedCount(r.activity) === 0),
    };
  }, [activities]);

  const openCourse = (course: CourseSummary) =>
    router.push({
      pathname: '/educator/(tabs)/course-detail',
      params: { courseId: course.id, courseName: course.name },
    });

  /**
   * Row taps resolve to the same destinations the Assignments tab already
   * uses, with the same params. An activity with work waiting goes straight
   * to its grading screen; everything else opens the activity.
   */
  const openActivity = (a: ClassActivity) => {
    if (ungradedCount(a) > 0 && a.kind === 'task') {
      router.push({
        pathname: '/educator/(tabs)/task-submissions',
        params: {
          taskId: a.id,
          taskTitle: a.title,
          courseName: a.course_name,
          maxPoints: String(a.max_points),
        },
      } as any);
      return;
    }
    if (ungradedCount(a) > 0 && a.kind === 'quiz' && a.ref_id != null) {
      router.push({
        pathname: '/educator/(tabs)/quiz-attempts',
        params: {
          quizId: String(a.ref_id),
          quizTitle: a.title,
          courseId: a.course != null ? String(a.course) : undefined,
        },
      } as any);
      return;
    }
    // Cast matches assignments.tsx: expo-router's generated route types lag
    // behind the activity-detail screen.
    router.push({
      pathname: '/educator/(tabs)/activity-detail',
      params: { activityId: String(a.id) },
    } as any);
  };

  const renderActivityRow = (entry: Ranked, key: string) => {
    const a = entry.activity;
    const meta = ACTIVITY_META[a.kind] || ACTIVITY_META.quiz;
    const waiting = ungradedCount(a);
    const isDraft = a.status === 'draft';
    const submitted = a.submission_count ?? 0;
    const graded = a.graded_count ?? 0;

    return (
      <TouchableOpacity
        key={key}
        style={styles.row}
        activeOpacity={0.75}
        onPress={() => openActivity(a)}
        accessibilityRole="button"
        accessibilityLabel={`${a.title}, ${a.course_name}. ${entry.due.label}. ${
          submitted > 0 ? `${submitted} submitted, ${graded} graded.` : 'No submissions yet.'
        }`}
      >
        <View style={[styles.rowIcon, { backgroundColor: tint(meta.color) }]}>
          <Ionicons name={meta.icon} size={16} color={meta.color} />
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {a.title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={2}>
            {a.course_name}
            {` · created ${relativeTime(a.created_at)}`}
          </Text>
          <View style={styles.rowTags}>
            {isDraft && <Pill label="Draft" />}
            {waiting > 0 && <Pill label={`${waiting} ungraded`} color={REVIEW_COLOR} icon="alert-circle" />}
            {waiting === 0 && submitted > 0 && <Pill label="All graded" color={COLORS.success} icon="checkmark-circle" />}
          </View>
        </View>

        <View style={styles.rowTrail}>
          {entry.due.isOverdue ? (
            <Text style={[styles.rowDue, { color: OVERDUE_TEXT }]} numberOfLines={1}>
              Overdue
            </Text>
          ) : (
            <Text style={styles.rowDueNeutral} numberOfLines={1}>
              {entry.due.short}
            </Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderRetry = (onRetry: () => void) => (
    <View style={styles.errorCard}>
      <Ionicons name="cloud-offline-outline" size={22} color={OVERDUE_TEXT} />
      <View style={styles.errorBody}>
        <Text style={styles.errorTitle}>Could not load</Text>
        <Text style={styles.errorText}>Check your connection and try again.</Text>
      </View>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry">
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={greeting()}
        subtitle={teacherName}
        avatar={initialsOf(teacherName)}
        onAvatarPress={() => router.navigate('/educator/profile')}
        showNotifications
        onNotificationsPress={() => router.push('/educator/announcements' as any)}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={COLORS.purpleVibrant}
            colors={[COLORS.purpleVibrant]}
          />
        }
      >
        {/* 1 — Grading queue. Only rendered when there is real work waiting. */}
        {reviewQueue.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Needs Review"
              actionLabel="See all"
              onAction={() => router.navigate('/educator/assignments')}
            />
            <Text style={styles.sectionNote}>
              {reviewQueue.reduce((sum, r) => sum + ungradedCount(r.activity), 0)} submissions waiting
            </Text>
            {reviewQueue.slice(0, REVIEW_PREVIEW).map((r) =>
              renderActivityRow(r, `review-${r.activity.id}`)
            )}
            {reviewQueue.length > REVIEW_PREVIEW && (
              <TouchableOpacity
                style={styles.moreRow}
                onPress={() => router.navigate('/educator/assignments')}
                accessibilityRole="button"
              >
                <Text style={styles.moreText}>
                  {reviewQueue.length - REVIEW_PREVIEW} more waiting to review
                </Text>
                <Ionicons name="chevron-forward" size={15} color={REVIEW_TEXT} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 2 — Classes. Vertical rows so every class is reachable without
             swiping a carousel and discovering the ones off-screen. */}
        <View style={styles.section}>
          <SectionHeader
            title="Your Classes"
            actionLabel="See all"
            onAction={() => router.navigate('/educator/courses')}
          />

          {loadingClasses ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={COLORS.purpleVibrant} />
            </View>
          ) : classesFailed ? (
            renderRetry(loadCourses)
          ) : courses.length === 0 ? (
            <EmptyState
              icon="school-outline"
              title="No classes yet"
              text="Create a course and share its join code so students can enroll."
            />
          ) : (
            <View style={styles.card}>
              {courses.map((c, i) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.classRow, i > 0 && styles.divider]}
                  activeOpacity={0.75}
                  onPress={() => openCourse(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}, ${c.student_count} students, join code ${c.join_code}`}
                >
                  <View style={[styles.classIconBg, { backgroundColor: tint(COLORS.purpleVibrant) }]}>
                    <Ionicons name="people" size={18} color={COLORS.purpleVibrant} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {c.student_count} student{c.student_count === 1 ? '' : 's'}
                      {c.join_code ? ` · Code ${c.join_code}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* 3 — One merged, urgency-ranked list. Replaces the old overlapping
             "Active Activities" and "Recent Activity" sections. */}
        <View style={styles.section}>
          <SectionHeader
            title="Activities"
            actionLabel="See all"
            onAction={() => router.navigate('/educator/assignments')}
          />

          {loadingActivities ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={COLORS.purpleVibrant} />
            </View>
          ) : activitiesFailed ? (
            renderRetry(loadActivities)
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon="file-tray-outline"
              title="Nothing scheduled"
              text="Published quizzes, lessons, games and tasks will appear here, soonest deadline first."
            />
          ) : (
            <View style={styles.card}>
              {upcoming.slice(0, ACTIVITY_PREVIEW).map((r) =>
                renderActivityRow(r, `activity-${r.activity.id}`)
              )}
              {upcoming.length > ACTIVITY_PREVIEW && (
                <TouchableOpacity
                  style={[styles.moreRow, styles.divider]}
                  onPress={() => router.navigate('/educator/assignments')}
                  accessibilityRole="button"
                >
                  <Text style={styles.moreText}>{upcoming.length - ACTIVITY_PREVIEW} more in Assignments</Text>
                  <Ionicons name="chevron-forward" size={15} color={REVIEW_TEXT} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* 4 — Creation, demoted below the work that needs attention. */}
        <View style={styles.section}>
          <SectionHeader title="Create" />
          <CreateQuickActions />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: SPACE.xl, paddingTop: SPACE.md },
  scrollContent: { paddingBottom: 44 },
  section: { marginBottom: 26 },
  sectionNote: {
    fontSize: 13,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    marginTop: -8,
    marginBottom: SPACE.md,
  },
  loadingBox: { paddingVertical: 32, alignItems: 'center' },

  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE.lg,
  },
  divider: { borderTopWidth: 1, borderTopColor: COLORS.border },

  /* Shared list row shape for both activity lists and classes */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: 13,
    minHeight: 44,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, lineHeight: 19 },
  rowMeta: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  rowTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  rowTrail: { alignItems: 'flex-end', gap: 4, maxWidth: 96 },
  rowDue: { fontSize: 11, fontFamily: FONTS.bold, fontWeight: '700' },
  rowDueNeutral: { fontSize: 11, fontFamily: FONTS.medium, fontWeight: '500', color: DUE_TEXT },

  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: 13,
    minHeight: 44,
  },
  classIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },

  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    minHeight: 44,
  },
  moreText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: REVIEW_TEXT },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACE.lg,
  },
  errorBody: { flex: 1 },
  errorTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  errorText: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 2 },
  retryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.md,
    backgroundColor: tint(COLORS.purpleVibrant),
  },
  retryText: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: RETRY_TEXT },
});
