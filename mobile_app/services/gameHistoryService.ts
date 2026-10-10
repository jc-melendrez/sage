import { apiCall } from './apiClient';
import { invalidateCachePrefix } from './apiCache';
import type { ActivityResults } from '@/components/ActivityResultsView';

/**
 * A hosted game, as archived by the backend's GameRoom rows.
 *
 * The Firestore room is the live state and is keyed only by room code, so it
 * cannot answer "which games did this class play" and loses `finishedAt`
 * entirely on a rematch. This list is the durable history instead, and it is
 * also the only place a classic game's results survive: they are written onto
 * each *player's* activity row, never onto the room.
 */
export type CourseGameStatus = 'waiting' | 'active' | 'finished';

export interface CourseGame {
  id: number;
  room_code: string;
  topic: string;
  /** 'classic' | 'group'. Mirrors the room's game mode, not Firestore's. */
  mode: string;
  team_mode: boolean;
  question_count: number;
  time_per_question: number;
  /** Competitors only. An educator host runs the room and is not counted. */
  player_count: number;
  /** The host is recorded here because an educator host is off the standings. */
  host_name: string;
  /** The class this was hosted for, or null for a game run from the FAB. */
  course_id?: number | null;
  course_name?: string | null;
  status: CourseGameStatus;
  /**
   * Settled results in exactly the shape Recent Activity stores, so both feed
   * the same ActivityResultsView. Null while the game is still running.
   */
  final_payload: ActivityResults | null;
  /**
   * Round one of a rematched room, preserved rather than overwritten. Null
   * until the host hits Rematch at least once.
   */
  previous_round: ActivityResults | null;
  previous_round_finished_at: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface CourseGamesResponse {
  /** Absent from /users/games/mine/, which is not scoped to a class. */
  course_id?: number;
  course_name?: string;
  /** Newest first. */
  games: CourseGame[];
}

/**
 * Games hosted for a course, newest first.
 *
 * Educator-only on the server: these are the educator's own hosted games, so a
 * student gets a 403 rather than a permanently empty list.
 */
export async function getCourseGames(courseId: number): Promise<CourseGamesResponse> {
  return apiCall<CourseGamesResponse>(`/users/courses/${courseId}/games/`);
}

/**
 * Every game this educator hosted, class or no class.
 *
 * The per-course endpoint filters on `course`, so a room hosted from the
 * dashboard FAB (no class attached) is archived but unreachable there. This
 * owner-wide read is what the dashboard's Recent games section and the
 * Hosted games screen are built on.
 */
export async function getMyGames(): Promise<CourseGamesResponse> {
  return apiCall<CourseGamesResponse>('/users/games/mine/');
}

/**
 * Remove one archived game from the host's history (owner-only server-side).
 *
 * The per-course list is SWR-cached (it matches the `/api/users/courses`
 * rule), so the cache is invalidated here too — otherwise the deleted row
 * would come back from cache the next time the Games tab mounted.
 */
export async function deleteGame(gameId: number): Promise<void> {
  await apiCall<void>(`/users/games/${gameId}/`, { method: 'DELETE', noCache: true });
  invalidateCachePrefix('/games/');
}

/**
 * The round whose results are on display: the current one, or the earlier one
 * when a rematch has since restarted the room and wiped `final_payload`.
 */
export function resultsFor(
  game: CourseGame,
  round: 'current' | 'previous' = 'current',
): ActivityResults | null {
  return round === 'previous' ? game.previous_round : game.final_payload;
}

/** How many rounds of results this game has, for the "Round 1 of 2" affordance. */
export function roundCount(game: CourseGame): number {
  return (game.final_payload ? 1 : 0) + (game.previous_round ? 1 : 0);
}
