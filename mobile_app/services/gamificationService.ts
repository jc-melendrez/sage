// services/gamificationService.ts
// Client helpers for the gamification endpoints (XP, badges, streaks, leaderboard).
import { API_BASE_URL } from '@/config/api';
import { getToken, refreshAccessToken } from './authService';
import { invalidateCachePrefix } from './apiCache';
import { savePendingQuizResult } from './offlineGameService';
import { requestSyncFlush } from './syncManager';

async function authFetch(path: string, options: RequestInit = {}) {
  const doFetch = async (token: string | null) => {
    return fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  };

  let token = await getToken();
  let response = await doFetch(token);
  if (response.status === 401) {
    const result = await refreshAccessToken();
    if (result.ok) response = await doFetch(result.access);
  }
  return response;
}

async function postJson(path: string, body: object) {
  const res = await authFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export interface QuizResult {
  xp: number;
  level: number;
  leveled_up: boolean;
  perfect: boolean;
  badges: { icon: string; name: string }[];
}

export interface LessonResult {
  xp: number;
  level: number;
  leveled_up: boolean;
  passed: boolean;
  badges: { icon: string; name: string }[];
}

export interface CheckInResult {
  checked_in: boolean;
  xp: number;
  streak: number;
  leveled_up: boolean;
  badges: { icon: string; name: string }[];
  message: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: number;
  username: string;
  display_name: string;
  level: number;
  total_points: number;
  streak: number;
  is_you: boolean;
}

/** fetch() rejects with a TypeError (or a platform-shaped message) when the
 *  request never reached the server -- distinct from an HTTP error response. */
function isNetworkError(err: unknown): boolean {
  const raw = err instanceof Error ? err : new Error(String(err));
  return raw.name === 'TypeError'
    || /Network request failed|Failed to fetch|NetworkError|network error/i.test(raw.message);
}

export async function completeQuiz(score: number, total: number, courseId?: number, quizId?: number): Promise<QuizResult> {
  const body = {
    score,
    total,
    ...(courseId != null ? { course_id: courseId } : {}),
    ...(quizId != null ? { quiz_id: quizId } : {}),
  };
  try {
    const result = await postJson('/users/me/complete-quiz/', body);
    // The quiz list now reflects the "attempted" flag — drop the cached copy so
    // the Quizzes tab revalidates instead of showing a stale "Take" button.
    invalidateCachePrefix('/ai/quizzes');
    return result;
  } catch (err) {
    // Offline (or a dropped connection): the score was graded locally, so queue
    // the attempt and replay it on reconnect instead of silently discarding it.
    // The reward is unknowable until the server scores it, so return a neutral
    // result rather than pretending the run earned nothing.
    if (isNetworkError(err)) {
      try {
        savePendingQuizResult(body);
        requestSyncFlush();
      } catch {}
      return { xp: 0, level: 0, leveled_up: false, perfect: false, badges: [] };
    }
    throw err;
  }
}

export async function completeLesson(
  courseId: string,
  levelId: number,
  score: number,
  total: number,
  passed: boolean,
): Promise<LessonResult> {
  return postJson('/users/me/complete-lesson/', { course_id: courseId, level_id: levelId, score, total, passed });
}

export async function dailyCheckIn(): Promise<CheckInResult> {
  return postJson('/users/me/check-in/', {});
}

export async function getMyProgress(): Promise<{
  lesson_progress: { course_id: string; level_id: number; score: number; total: number; passed: boolean }[];
}> {
  const res = await authFetch('/users/me/progress/');
  if (!res.ok) throw new Error(`Failed to load progress (${res.status})`);
  return res.json();
}

export async function getLeaderboard(): Promise<{
  entries: LeaderboardEntry[];
  your_rank: number;
  your_points: number;
}> {
  const res = await authFetch('/users/leaderboard/');
  if (!res.ok) throw new Error(`Failed to load leaderboard (${res.status})`);
  return res.json();
}
