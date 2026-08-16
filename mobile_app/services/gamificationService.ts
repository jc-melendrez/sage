// services/gamificationService.ts
// Client helpers for the gamification endpoints (XP, badges, streaks, leaderboard).
import { API_BASE_URL } from '@/config/api';
import { getToken, refreshAccessToken } from './authService';

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
    const newToken = await refreshAccessToken();
    if (newToken) response = await doFetch(newToken);
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

export async function completeQuiz(score: number, total: number): Promise<QuizResult> {
  return postJson('/users/me/complete-quiz/', { score, total });
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
