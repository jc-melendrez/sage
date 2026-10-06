/**
 * Derives an educator's class analytics from data they already load.
 *
 * Nothing here talks to the network. Every input arrives from an endpoint the
 * educator already calls elsewhere, so this screen needs no backend view of its
 * own:
 *
 *   - `rows` from `courseRoster.buildStudentRows` (roster + leaderboard + path)
 *     gives per-student completion and `lastActivity`.
 *   - `quizzes` from `GET /ai/quizzes/?course=<id>` already carries the class
 *     score: `class_average_percent` and `class_attempted_count` are computed
 *     server-side by `QuizSerializer` and gated to the course educator, so the
 *     per-quiz averages cost no extra requests.
 *   - `activities` from `GET /users/courses/<id>/activities/` carries
 *     `submission_count` / `graded_count` per assignment.
 *
 * What is deliberately absent: XP totals and study hours. The leaderboard
 * exposes course-scoped `points`, but there is no server-side record of how
 * long anyone studied, and `Session` is vestigial — `gamification.py` never
 * writes to it. Showing those would mean inventing numbers, so they are gone
 * rather than faked.
 *
 * Kept pure (no React, no I/O) so it is testable and mirrors courseRoster.ts.
 */

import type { CourseStudentRow } from './courseRoster';
import type { Quiz } from './quizService';
import type { ClassActivity } from './activityService';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `lastActivity` inside this many days counts as "active this week". */
const ACTIVE_WINDOW_DAYS = 7;

/** One quiz's worth of class performance, ordered oldest to newest. */
export interface ClassScorePoint {
  quizId: number;
  title: string;
  /** Mean of each learner's best completed attempt, 0-100. */
  averagePercent: number;
  /** Distinct learners who opened this quiz. */
  attempted: number;
  /** Learners enrolled — the denominator for participation. */
  enrolled: number;
  /** Kept for ordering; not rendered. */
  createdAt: string;
}

export interface ClassAnalytics {
  students: number;
  /** Mean `completionPct` across the roster, 0-100. */
  averageCompletion: number;
  /** Silent for over a week (at-risk or worse). */
  fallingBehind: number;
  /** Opened the course within the last 7 days. */
  activeThisWeek: number;
  /** Quizzes with at least one completed attempt, oldest first. */
  scoreTrend: ClassScorePoint[];
  /** Mean share of enrolled learners who opened each class quiz. */
  quizParticipation: number;
  /** Turn-ins received across published tasks, as a share of the possible. */
  assignmentTurnIn: number;
  /** Sum of `submission_count` — the numerator behind `assignmentTurnIn`. */
  submissionsReceived: number;
  /** Task count x roster size — the denominator behind `assignmentTurnIn`. */
  submissionsExpected: number;
}

/** Whole days since `iso`; Infinity when absent or unparseable. */
function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Infinity;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return Infinity;
  return Math.floor((now.getTime() - then.getTime()) / DAY_MS);
}

function activeWithin(iso: string | null | undefined, days: number, now: Date): boolean {
  const elapsed = daysSince(iso, now);
  return elapsed >= 0 && elapsed <= days;
}

/**
 * Quizzes that have a class average, oldest first.
 *
 * A quiz nobody finished has no `class_average_percent` and is dropped rather
 * than plotted at zero — "0%" reads as "the class failed this quiz", which is a
 * different and much worse claim than "nobody has submitted yet". Participation
 * still counts those quizzes, so the gap stays visible on the engagement row.
 *
 * Ascending `created_at` because the chart answers "did the class get better
 * or did this topic lose them?", which only reads left-to-right in time order.
 */
export function buildScoreTrend(quizzes: Quiz[], enrolled: number): ClassScorePoint[] {
  return quizzes
    .filter((q) => q.class_average_percent != null)
    .map((q) => ({
      quizId: q.id,
      title: q.title,
      averagePercent: q.class_average_percent as number,
      attempted: q.class_attempted_count ?? 0,
      enrolled,
      createdAt: q.created_at,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Mean share of the class that opened each quiz, 0-100.
 *
 * Averaged per quiz rather than pooled over total opens so one heavily
 * attempted quiz cannot mask five that were ignored. Quizzes with zero opens
 * are included: non-participation is the signal the educator wants here.
 */
export function quizParticipationPercent(quizzes: Quiz[], enrolled: number): number {
  const scoped = quizzes.filter((q) => q.class_attempted_count != null);
  if (!scoped.length || enrolled <= 0) return 0;
  const total = scoped.reduce((sum, q) => sum + (q.class_attempted_count ?? 0), 0);
  return Math.round((total / (scoped.length * enrolled)) * 100);
}

/**
 * Turn-ins received against turn-ins possible, 0-100.
 *
 * Only `task` activities accept submissions (`TaskSubmission` hangs off a
 * task), and only published ones — counting a draft against the class would
 * report non-participation for work nobody was ever shown.
 */
export function assignmentTurnInPercent(
  activities: ClassActivity[],
  enrolled: number,
): { percent: number; received: number; expected: number } {
  const tasks = activities.filter((a) => a.kind === 'task' && a.status === 'published');
  const received = tasks.reduce((sum, a) => sum + (a.submission_count ?? 0), 0);
  const expected = tasks.length * enrolled;
  return {
    percent: expected > 0 ? Math.round((received / expected) * 100) : 0,
    received,
    expected,
  };
}

export function buildClassAnalytics(
  rows: CourseStudentRow[],
  quizzes: Quiz[],
  activities: ClassActivity[],
  now = new Date(),
): ClassAnalytics {
  const students = rows.length;
  const averageCompletion = students
    ? Math.round(rows.reduce((sum, r) => sum + r.completionPct, 0) / students)
    : 0;
  const turnIn = assignmentTurnInPercent(activities, students);

  return {
    students,
    averageCompletion,
    // healthFromLastActive already calls anything past 7 days needsAttention,
    // so "silent this week" is exactly atRisk + needsAttention.
    fallingBehind: rows.filter(
      (r) => r.health === 'atRisk' || r.health === 'needsAttention',
    ).length,
    activeThisWeek: rows.filter((r) => activeWithin(r.lastActivity, ACTIVE_WINDOW_DAYS, now)).length,
    scoreTrend: buildScoreTrend(quizzes, students),
    quizParticipation: quizParticipationPercent(quizzes, students),
    assignmentTurnIn: turnIn.percent,
    submissionsReceived: turnIn.received,
    submissionsExpected: turnIn.expected,
  };
}

/** "18/24" — the participation shape educators already read in course-students. */
export function countFraction(part: number, whole: number): string {
  return `${part}/${whole}`;
}