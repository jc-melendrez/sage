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

/**
 * One recorded answer.
 *
 * Keyed by the CANONICAL index into the room's `questions` array. Every player
 * gets a different shuffled `questionOrder`, but the index they submit is the
 * shared index into the room's question list, so answers to the same question
 * can be compared across the whole room even though nobody saw them in the
 * same order.
 */
export interface AnswerLogEntry {
  correct: boolean;
  points: number;
  /**
   * What the player chose, `''` on a timeout. This is shown to that player
   * only -- the summary deliberately does not expose a peer's picks.
   */
  picked: string;
}

/**
 * Firestore map keys are always strings, so a log is keyed by
 * `String(questionIndex)` even though the numbers arrive as keys of `q0`,
 * `q1`, ... from the server.
 */
export type PlayerAnswerLog = Record<string, AnswerLogEntry>;

/** Pull a player's log out defensively -- it is absent on older rooms. */
export function answerLog(player?: Pick<PlayerEntry, 'answers'> | null): PlayerAnswerLog {
  return player?.answers ?? {};
}

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
  /**
   * Per-question answer log, written by the server inside the answer
   * transaction. Absent for rooms that predate it, and for players who have
   * not answered anything, so always read it through answerLog() rather than
   * indexing straight into it.
   */
  answers?: PlayerAnswerLog;
  /**
   * Personal momentum rung, mirroring TEAM_MOMENTUM_TIERS. Classic mode only;
   * team mode climbs the same ladder but the team document owns it. Stored as
   * the tier just EARNED, so the boost lands on the following answer.
   */
  multiplier?: number;
  /** Longest run of consecutive correct answers. */
  bestStreak?: number;
  /**
   * When this player last arrived in the room, as a Firestore timestamp.
   * Player document ids are user ids, so there is no arrival order to recover
   * from the id -- the lobby's "joined recently" strip sorts on this instead.
   * A plain number is accepted too, and documents written before the field
   * existed are simply absent, so read it through joinedAtMillis().
   */
  joinedAt?: { toMillis(): number } | number | null;
}

/** joinedAt as epoch milliseconds, or 0 when it was never written. */
export function joinedAtMillis(player: Pick<PlayerEntry, 'joinedAt'>): number {
  const raw = player.joinedAt;
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  return typeof raw.toMillis === 'function' ? raw.toMillis() : 0;
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
   * Average points per active member -- the value teams are RANKED on.
   *
   * The server settles this next to `score` and pays placement XP from it, so
   * the results screen sorts on this number rather than re-deriving the
   * ranking and risking an order that disagrees with the XP paid. Absent on
   * rooms that predate it, so go through teamRankValue() rather than reading
   * it directly.
   */
  rankScore?: number;
  /** Members who answered at least one question: the averaging denominator. */
  activeMembers?: number;
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
  /**
   * Why the answer is right. Carried through the offline/LAN builders as well
   * as the server one -- a missed question with its reason attached is the
   * part that actually sticks, so it is shown on the miss and again in the
   * end-of-session summary.
   */
  explanation?: string | null;
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
/**
 * How many members of each team actually played, keyed by team id.
 *
 * Mirrors the server's `_active_members_by_team`. "Active" means the member
 * answered at least one question: averaging over the raw roster instead would
 * punish a team for a member who joined and went quiet.
 */
export function activeMembersByTeam(players: Pick<PlayerEntry, 'teamId' | 'answeredCount'>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of players) {
    if (p.teamId == null || p.teamId === '') continue;
    if ((p.answeredCount ?? 0) <= 0) continue;
    const key = String(p.teamId);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * The number a team is RANKED on: average points per active member.
 *
 * Mirrors the server's `team_rank_value`, including the floor at one member so
 * a team nobody played on still has a defined denominator. When the server has
 * already settled a `rankScore` it wins, because that is the value the
 * placement XP was actually paid from; pass `activeOverride` to force a
 * live recomputation for mid-game standings.
 */
export function teamRankValue(
  team: Pick<TeamEntry, 'score' | 'rankScore' | 'activeMembers'>,
  activeOverride?: number,
): number {
  if (activeOverride == null && typeof team.rankScore === 'number') {
    return team.rankScore;
  }
  const active = Math.max(1, Math.floor(activeOverride ?? team.activeMembers ?? 0));
  return (team.score ?? 0) / active;
}

export function sameTeamId(a?: string | null, b?: string | null): boolean {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export function emptyPowerupPool(): PowerupPool {
  return { freeze: 0, hint: 0, doublePoints: 0, shield: 0 };
}
