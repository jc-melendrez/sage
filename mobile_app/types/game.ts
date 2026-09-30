/**
 * Shared shapes for the multiplayer game surfaces.
 *
 * These were previously `any[]` in every game screen and typed only inside
 * components/tv/TvLeaderboard.tsx. They are promoted here so the lobby, the
 * question screen, the final scoreboard and the educator console all agree on
 * the same room model — and so a backend field rename surfaces as a type error
 * instead of as a silently `undefined` at runtime.
 *
 * Note on ids: Firestore document ids are always strings, but a team's `id`
 * is compared against a player's `teamId` in several places. Always compare
 * through `sameTeamId()` rather than `===`, which is how the team dot on the
 * old final screen used to silently disappear.
 */

export type RoomStatus = 'waiting' | 'active' | 'finished';

export type PowerupKey = 'freeze' | 'hint' | 'doublePoints' | 'shield';

export type PowerupPool = Record<PowerupKey, number>;

export const POWERUP_KEYS: PowerupKey[] = ['freeze', 'hint', 'doublePoints', 'shield'];

/** Emoji reactions the backend accepts (see REACTION_EMOJIS in game/views.py). */
export const REACTION_EMOJIS = ['🔥', '👏', '🤯', '😢', '💪'] as const;

export interface PlayerEntry {
  id: string;
  displayName: string;
  avatar?: string;
  score: number;
  answeredCount: number;
  correctCount?: number;
  streak: number;
  isFinished: boolean;
  teamId?: string | null;
}

export interface TeamMember extends PlayerEntry {
  /** Share of the team's points this member banked, 0-100. */
  contribution?: number;
}

export interface TeamEntry {
  id: string;
  name: string;
  color: string;
  /**
   * Seats on this team. The host grows it from the "+" beside the last slot,
   * capped at 10 by the server. Optional because rooms created before per-team
   * seats existed have no such field; the UI falls back to 5 to match the
   * server's own default rather than rendering a team that is already full.
   */
  maxSize?: number;
  score: number;
  correctCount: number;
  answeredCount: number;
  memberIds: string[];
  memberCount: number;
  /** Team momentum: 1, 1.2, 1.4, 1.6 or 2. */
  multiplier: number;
  teamCorrect: number;
  teamStreak: number;
  bestStreak: number;
  powerups: PowerupPool;
  namedBy?: string | null;
  nameLocked?: boolean;
  /** Present on the leaderboard and the final snapshot. */
  accuracy?: number;
  maxMultiplier?: number;
  members?: TeamMember[];
}

export interface TeamAssignment {
  id: string;
  displayName: string;
  teamId: string;
  teamName?: string;
  teamColor?: string;
}

export interface RoomData {
  roomCode: string;
  status: RoomStatus;
  topic: string;
  questionCount: number;
  timePerQuestion: number;
  teamMode: boolean;
  teamCount?: number;
  maxTeamSize?: number;
  hostId: string;
  hostName: string;
  players: PlayerEntry[];
  teams: TeamEntry[];
}

export interface GameQuestion {
  type: 'mcq' | 'identification';
  question: string;
  choices?: string[];
  correctAnswer: string;
}

/**
 * Momentum tiers, mirroring TEAM_MOMENTUM_TIERS in backend_api/core/game/views.py.
 * The client uses this only to draw the "next tier" hint; the server is the
 * authority on the actual multiplier.
 */
export const MOMENTUM_TIERS: { at: number; multiplier: number }[] = [
  { at: 0, multiplier: 1.0 },
  { at: 5, multiplier: 1.2 },
  { at: 10, multiplier: 1.4 },
  { at: 15, multiplier: 1.6 },
  { at: 20, multiplier: 2.0 },
];

export function nextMomentumTier(teamCorrect: number) {
  for (const tier of MOMENTUM_TIERS) {
    if (teamCorrect < tier.at) return tier;
  }
  return null;
}

export function formatMultiplier(multiplier: number): string {
  return `×${multiplier % 1 === 0 ? multiplier : multiplier.toFixed(1)}`;
}

/** Ids cross the Firestore/JSON boundary as both strings and numbers. */
export function sameTeamId(a?: string | null, b?: string | null): boolean {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export function emptyPowerupPool(): PowerupPool {
  return { freeze: 0, hint: 0, doublePoints: 0, shield: 0 };
}
