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
 * Keyed by the CANONICAL index into the room's `questions` array.
 *
 * In classic, solo, offline and LAN play every player gets a different shuffled
 * `questionOrder`, but the index recorded is the shared index into the room's
 * question list, so answers to the same question can be compared across the
 * whole room even though nobody saw them in the same order.
 *
 * Team mode is the exception: the room owns ONE `teamQuestionIndex` and shows
 * everyone the same question, so a team member's log entry describes the team's
 * single outcome -- the same `correct` and `points` for every member -- and only
 * `picked` (their own vote) and `agreed` differ.
 */
export interface AnswerLogEntry {
  correct: boolean;
  points: number;
  /**
   * What the player chose, `''` on a timeout. This is shown to that player
   * only -- the summary deliberately does not expose a peer's picks.
   */
  picked: string;
  /**
   * Team mode only: did this member's own pick match the team's answer? A
   * voided (tied) question counts as agreeing, because there was no team answer
   * to disagree with. Absent on classic play, where agreement is meaningless.
   */
  agreed?: boolean;
  /** Team mode only: how many members backed the team's answer. */
  agreedCount?: number;
  /** Team mode only: how many distinct answers were on the table. */
  pickers?: number;
}

/** Firestore map keys are always strings, so a log is keyed by `String(questionIndex)`. */
export type PlayerAnswerLog = Record<string, AnswerLogEntry>;

/**
 * Pull a player's log out defensively -- it is absent on older rooms -- and
 * normalize its keys to `String(questionIndex)`.
 *
 * The server writes online logs with a `q` prefix (`q0`, `q1`, ...) while the
 * offline/LAN path builds them from numeric keys (`"0"`, `"1"`). Consumers index
 * by `String(index)`, so strip the prefix here or every online summary reads an
 * empty log.
 */
export function answerLog(player?: Pick<PlayerEntry, 'answers'> | null): PlayerAnswerLog {
  const raw = player?.answers;
  if (!raw) return {};
  const out: PlayerAnswerLog = {};
  for (const [key, entry] of Object.entries(raw)) {
    const stripped = key.startsWith('q') ? key.slice(1) : key;
    out[/^\d+$/.test(stripped) ? stripped : key] = entry;
  }
  return out;
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
  /** Correct answers out of `answeredCount`, as a percentage. */
  accuracy?: number;
  /**
   * How often this member voted with the team, 0-100.
   *
   * This replaced `contribution` (a share of the team's points), which became
   * meaningless when members started sharing one team score -- every member
   * would have shown the same number.
   */
  agreement?: number;
  /** Best run of consecutive correct answers. */
  bestStreak?: number;
  /** Submitted before the team closed its last question. */
  earlyFinisher?: boolean;
  /** Highest agreement on the team. At most one per team. */
  isMvp?: boolean;
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
  teamCorrect: number;
  teamStreak: number;
  bestStreak: number;
  powerups: PowerupPool;
  namedBy?: string | null;
  nameLocked?: boolean;
  /** Present on the leaderboard and the final snapshot. */
  accuracy?: number;
  members?: TeamMember[];
  /**
   * How many members have picked for the CURRENT shared question.
   *
   * This is a bare number on purpose. The team document is readable by every
   * signed-in user (`firestore.rules`), so the picks themselves live in the
   * server-only `_server` collection and never appear here -- a member can see
   * that their team is 3-of-4 in without being able to see who has or has not
   * answered, let alone what anyone chose. Zero once the question is scored.
   */
  pickCount?: number;
  /**
   * Every member of this team has pressed Finish.
   *
   * Rolled up server-side when the last member finishes, because the final
   * screen reveals a team's score on completion and has to know whether the
   * TEAM is done rather than re-counting members on a subscription that may not
   * have delivered all of them yet. Absent on rooms created before it existed,
   * which read as "not finished" -- see the settled check on the results screen.
   */
  isFinished?: boolean;
  /** Who seated first, and owns the team for the session. */
  leaderId?: string | null;
  /**
   * What the team settled on, per question index, once it is resolved.
   *
   * Every member reads the same reveal, so a member who picked early learns the
   * result from here instead of waiting on a response that only ever goes back
   * to whoever happened to submit last.
   */
  reveals?: Record<string, TeamReveal>;
}

export interface TeamReveal {
  index: number;
  /** The answer the team's plurality settled on, empty when the vote tied. */
  answer: string;
  correctAnswer: string;
  correct: boolean;
  /** A tie has no majority: nobody scores, and the answer is shown anyway. */
  void: boolean;
  /** How many members backed the winning answer. Never who they were. */
  agreed: number;
  /** Distinct answers that were actually offered. */
  pickers: number;
  expected: number;
  points: number;
  multiplier: number;
  basePoints: number;
  speedBonus: number;
  doublePoint: boolean;
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
  type: 'mcq' | 'identification' | 'fill_in_blank' | 'true_false';
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
 * Momentum tiers: removed, along with `formatMultiplier` and
 * `nextMomentumTier`.
 *
 * The ladder compounded with the streak bonus and the doubled questions, so a
 * team that got hot early kept scoring well past the point it stopped knowing
 * the material. Everything left in scoring scales from the answer in front of
 * you. Do not reintroduce a term driven by a running "how many right so far".
 */

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
