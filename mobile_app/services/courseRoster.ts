/**
 * Joins the two course endpoints an educator already has into one roster row.
 *
 * The course APIs split what a roster needs across two responses, and neither
 * is complete on its own:
 *
 *   - `GET /users/courses/<id>/` returns `students` via `UserSerializer`
 *     (users/serializers.py:177). This is the membership list and the only
 *     source of `email` / `username`, but carries no progress.
 *   - `GET /users/courses/<id>/leaderboard/` returns per-student course points,
 *     nodes passed, quizzes completed and `last_activity` (users/views.py:2112).
 *     Rich progress, but no contact details.
 *
 * Merging on `id` therefore yields a full row with no new endpoint. The
 * leaderboard iterates `course.students.all()` so the two sets match exactly,
 * but the roster is still treated as authoritative for membership: a
 * leaderboard row without a roster match is ignored, and a roster student
 * missing from the leaderboard falls back to zeros rather than disappearing.
 */

import type { CourseLeaderboard, CourseLeaderboardEntry, CourseRoster, CourseStudent } from './courseService';

export type StudentHealth = 'onTrack' | 'atRisk' | 'needsAttention' | 'neverStarted';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active within this many days counts as on track. */
const ON_TRACK_DAYS = 3;
/** Active within this many days is a warning; past it, needs attention. */
const AT_RISK_DAYS = 7;

export interface CourseStudentRow {
  id: number;
  /** Best available label: full name, else username. */
  name: string;
  username: string;
  email: string;
  level: number;
  streak: number;
  /** Course-scoped XP: passed-node rewards plus quiz points. */
  points: number;
  nodesCompleted: number;
  /** Total nodes in the course; 0 when the course has no content yet. */
  totalNodes: number;
  quizzesCompleted: number;
  /** ISO timestamp from the leaderboard, or null if they have never worked. */
  lastActivity: string | null;
  /** 0-100. Always a number, including for a course with no nodes. */
  completionPct: number;
  health: StudentHealth;
}

export interface RosterSummary {
  total: number;
  /** Mean `completionPct`, or 0 for an empty roster. */
  averageCompletion: number;
  atRisk: number;
  neverStarted: number;
}

/** "Ada Lovelace" → "AL"; falls back to the first letters of a single name. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Whole days since `iso`; Infinity when absent or unparseable. */
function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Infinity;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return Infinity;
  // Floor, not round: someone active 23 hours ago has had zero full days away.
  return Math.floor((now.getTime() - then.getTime()) / DAY_MS);
}

/**
 * "Today" / "3d ago" / "5w ago" — dense enough for a list row.
 *
 * Relative rather than an absolute date because the point is recency, and
 * "Sep 30" reads identically for someone who was active last week and for
 * someone who was active four months ago.
 */
export function formatLastActive(iso: string | null | undefined, now = new Date()): string {
  const days = daysSince(iso, now);
  if (!Number.isFinite(days)) return 'Never';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Recency bands, derived from the leaderboard's `last_activity`.
 *
 * These are deliberately recency-only rather than completion-based: a student
 * who is behind but still working is not the same problem as one who has gone
 * quiet, and only the latter is visible from `last_activity`. `neverStarted`
 * is kept distinct from `needsAttention` because "hasn't opened the course"
 * usually means the join code was shared late in the week.
 */
export function healthFromLastActive(iso: string | null | undefined, now = new Date()): StudentHealth {
  const days = daysSince(iso, now);
  if (!Number.isFinite(days)) return 'neverStarted';
  if (days <= ON_TRACK_DAYS) return 'onTrack';
  if (days <= AT_RISK_DAYS) return 'atRisk';
  return 'needsAttention';
}

/** `UserSerializer` has no `display_name`, so compose it from the name parts. */
function displayNameOf(student: CourseStudent): string {
  const full = `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim();
  return full || student.username;
}

function rowFor(
  student: CourseStudent,
  entry: CourseLeaderboardEntry | undefined,
  totalNodes: number,
  now: Date,
): CourseStudentRow {
  const nodesCompleted = entry?.nodes_completed ?? 0;
  return {
    id: student.id,
    name: displayNameOf(student),
    username: student.username,
    email: student.email,
    level: entry?.level ?? student.level,
    streak: entry?.streak ?? student.streak,
    points: entry?.points ?? 0,
    nodesCompleted,
    totalNodes,
    quizzesCompleted: entry?.quizzes_completed ?? 0,
    lastActivity: entry?.last_activity ?? null,
    // A course with no nodes is 0%, not NaN — the empty path is a normal state.
    completionPct: totalNodes > 0 ? Math.round((nodesCompleted / totalNodes) * 100) : 0,
    health: healthFromLastActive(entry?.last_activity, now),
  };
}

/**
 * Build one row per enrolled student, richest-progress first by default
 * (caller re-sorts as needed). Sorted here so the ordering is stable across
 * renders without every caller repeating the comparator.
 */
export function buildStudentRows(
  roster: CourseRoster | null,
  leaderboard: CourseLeaderboard | null,
  totalNodes: number,
  now = new Date(),
): CourseStudentRow[] {
  if (!roster?.students?.length) return [];

  const byId = new Map<number, CourseLeaderboardEntry>();
  for (const entry of leaderboard?.entries ?? []) byId.set(entry.id, entry);

  return roster.students
    .map((student) => rowFor(student, byId.get(student.id), totalNodes, now))
    .sort((a, b) => b.points - a.points || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export function summarizeRoster(rows: CourseStudentRow[]): RosterSummary {
  const active = rows.filter((r) => r.health === 'atRisk' || r.health === 'needsAttention').length;
  return {
    total: rows.length,
    averageCompletion: rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.completionPct, 0) / rows.length)
      : 0,
    atRisk: active,
    neverStarted: rows.filter((r) => r.health === 'neverStarted').length,
  };
}

/** Name / username / email match, case-insensitive. Empty query matches all. */
export function matchesQuery(row: CourseStudentRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.name.toLowerCase().includes(q) ||
    row.username.toLowerCase().includes(q) ||
    row.email.toLowerCase().includes(q)
  );
}