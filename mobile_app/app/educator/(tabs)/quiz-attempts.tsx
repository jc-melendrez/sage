import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, CARD_SHADOW, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { EmptyState, StatCard } from '@/components/educator/EducatorPrimitives';
import { getQuizAttempts, QuizAttemptMonitor, QuizAttemptRow } from '@/services/quizService';
import { getCourse, CourseStudent } from '@/services/courseService';

function percentColor(percent: number | null): string {
  if (percent === null || percent === undefined) return COLORS.textMuted;
  if (percent >= 70) return COLORS.success;
  if (percent >= 50) return COLORS.warning;
  return COLORS.danger;
}

function studentLabel(student: CourseStudent): string {
  const name = `${student.first_name || ''} ${student.last_name || ''}`.trim();
  return name || student.username;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Not finished';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString();
}

export default function QuizAttemptsScreen() {
  const { quizId, quizTitle, courseId } = useLocalSearchParams<{
    quizId: string;
    quizTitle?: string;
    courseId?: string;
  }>();
  const qid = Number(quizId);

  const [data, setData] = useState<QuizAttemptMonitor | null>(null);
  const [roster, setRoster] = useState<CourseStudent[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!qid || Number.isNaN(qid)) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const result = await getQuizAttempts(qid);
      setData(result);
    } catch {
      setData(null);
      Alert.alert(
        'Failed to load results',
        'Could not fetch quiz attempts. If this quiz belongs to a class, make sure you are the class educator.',
      );
    } finally {
      setLoading(false);
    }
  }, [qid]);

  // The attempts endpoint reports a class size but not the identities of the
  // learners who never opened the quiz, so pull the roster to name them.
  useFocusEffect(
    useCallback(() => {
      load();
      const cid = Number(courseId);
      if (!cid || Number.isNaN(cid)) {
        setRoster(null);
        return;
      }
      let cancelled = false;
      getCourse(cid)
        .then((course) => {
          if (!cancelled) setRoster(course.students || []);
        })
        .catch(() => {
          if (!cancelled) setRoster(null);
        });
      return () => {
        cancelled = true;
      };
    }, [load, courseId]),
  );

  const attemptedIds = new Set((data?.attempts || []).map((r) => r.student_id));
  const missing: CourseStudent[] = (roster || []).filter((s) => !attemptedIds.has(s.id));
  const notStartedCount =
    roster !== null ? missing.length : Math.max(0, (data?.student_count || 0) - (data?.attempted_count || 0));

  const renderRow = (row: QuizAttemptRow) => {
    const color = percentColor(row.best_percent);
    const retried = row.attempts > 1;
    return (
      <View key={row.student_id} style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{row.student_name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.studentName}>{row.student_name}</Text>
            <Text style={styles.meta}>
              {row.completed ? `Finished ${formatWhen(row.completed_at)}` : 'Started, not submitted'}
            </Text>
          </View>
          {row.best_percent !== null ? (
            <View style={styles.scoreBadge}>
              <Text style={[styles.scoreBadgeText, { color }]}>{row.best_percent}%</Text>
            </View>
          ) : (
            <View style={[styles.scoreBadge, styles.incompleteBadge]}>
              <Text style={[styles.scoreBadgeText, { color: COLORS.warning }]}>In progress</Text>
            </View>
          )}
        </View>

        {row.best_score !== null && row.best_total !== null ? (
          <Text style={styles.scoreDetail}>
            Best: {row.best_score} / {row.best_total}
            {row.last_score_percent !== null && row.last_score_percent !== row.best_percent
              ? `  ·  latest attempt: ${row.last_score_percent}%`
              : ''}
          </Text>
        ) : null}

        {retried ? (
          <View style={styles.retryBadge}>
            <Ionicons name="repeat" size={12} color={COLORS.purpleVibrant} />
            <Text style={styles.retryBadgeText}>{row.attempts} attempts</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Quiz Results"
        subtitle={data?.quiz.title || quizTitle || `Quiz #${qid}`}
        showBack
      />

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
        </View>
      ) : !data ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Results unavailable"
          text="We could not load attempts for this quiz."
        />
      ) : (
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={styles.statRow}>
            <StatCard
              icon="people-outline"
              value={`${data.attempted_count}/${data.student_count}`}
              label="Attempted"
            />
            <StatCard
              icon="analytics-outline"
              value={data.average_percent === null ? '—' : `${data.average_percent}%`}
              label="Avg best score"
              color={COLORS.accent}
            />
          </View>

          {data.quiz.available_until ? (
            <View style={styles.deadlineRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.deadlineText}>
                Closes {formatWhen(data.quiz.available_until)}
              </Text>
            </View>
          ) : null}

          {notStartedCount > 0 ? (
            <View style={styles.alertBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
              <Text style={styles.alertText}>
                {notStartedCount} student{notStartedCount === 1 ? ' has' : 's have'} not started this quiz
              </Text>
            </View>
          ) : null}

          {missing.length > 0 ? (
            <View style={styles.missingBox}>
              <Text style={styles.missingLabel}>Not started</Text>
              <View style={styles.missingChips}>
                {missing.map((s) => (
                  <View key={s.id} style={styles.missingChip}>
                    <Text style={styles.missingChipText}>{studentLabel(s)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>
            Results{data.completed_count > 0 ? ` (${data.completed_count} submitted)` : ''}
          </Text>

          {data.attempts.length === 0 ? (
            <EmptyState
              icon="clipboard-outline"
              title="No attempts yet"
              text="Nobody in this class has opened the quiz yet."
            />
          ) : (
            <View style={{ gap: 12 }}>{data.attempts.map(renderRow)}</View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  statRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  deadlineText: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: tint(COLORS.warning),
    padding: 12,
    borderRadius: RADIUS.sm,
    marginBottom: 12,
  },
  alertText: { flex: 1, fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },

  missingBox: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 18,
  },
  missingLabel: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  missingChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  missingChip: {
    backgroundColor: COLORS.bg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  missingChipText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary },

  sectionTitle: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },

  card: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 16,
    ...CARD_SHADOW,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(COLORS.purpleVibrant),
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleVibrant },
  studentName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  meta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 2 },
  scoreBadge: {
    backgroundColor: 'rgba(76, 29, 149, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  incompleteBadge: { backgroundColor: tint(COLORS.warning) },
  scoreBadgeText: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700' },
  scoreDetail: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    marginTop: 10,
  },
  retryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: tint(COLORS.purpleVibrant),
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    marginTop: 10,
  },
  retryBadgeText: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.purpleVibrant },
});
