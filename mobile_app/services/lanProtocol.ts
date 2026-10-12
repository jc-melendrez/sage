import type { QuizPayload } from './offlineEngine';
import type { PowerupKey, PowerupPool } from '@/types/game';

export const LAN_PORT = 5050;
export const MAX_CHUNK = 24000;

export function generateRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export interface GameQuestionPick {
  type: 'mcq' | 'identification' | 'fill_in_blank' | 'true_false';
  question: string;
  choices?: string[];
  correctAnswer: string;
  explanation?: string | null;
}

/**
 * One recorded answer on a LAN game, keyed by canonical question index.
 *
 * Structurally identical to the server's persisted log, so the same breakdown
 * renders on a LAN results screen as on an online one.
 */
export interface LanAnswer {
  correct: boolean;
  points: number;
  picked: string;
}

export type LanAnswerLog = Record<string, LanAnswer>;

export interface LanPlayer {
  id: string;
  name: string;
  avatar?: string;
  connected: boolean;
  finished: boolean;
  score: number;
  correctCount: number;
  answeredCount: number;
  totalQuestions: number;
  /**
   * Optional so an older build still interoperates: the host simply has no
   * breakdown to show for a player that did not send one.
   */
  answers?: LanAnswerLog;
  /**
   * Team this player is seated in. Absent means the player is a spectator
   * (or the host has not enabled teams). Kept optional so an older client
   * build keeps interoperating with a team-mode host.
   */
  teamId?: string;
}

export interface LanTeam {
  id: string;
  name: string;
  color: string;
  /**
   * Shared power-ups for this team in LAN team play. The host owns and
   * broadcasts this pool, so every member sees the same counts and can see
   * when a power-up has been armed.
   */
  powerups?: PowerupPool;
  /**
   * Host-owned team stats for LAN team play. Online these live on the Firestore
   * team document; here the host is the single source of truth so every member
   * sees the same score and the results screen can rank teams without summing
   * members (which would count a team's score once per player).
   */
  score?: number;
  correctCount?: number;
  answeredCount?: number;
  teamCorrect?: number;
  teamStreak?: number;
  bestStreak?: number;
  memberCount?: number;
}

/**
 * One team's resolved answer for a question. The LAN twin of the online team
 * document's `reveals.q{n}` -- every member reads the same payload, so nobody
 * can see a teammate's individual pick, only the team's decision.
 */
export interface LanReveal {
  index: number;
  answer: string;
  correctAnswer: string;
  correct: boolean;
  void: boolean;
  split: boolean;
  agreed: number;
  pickers: number;
  expected: number;
  points: number;
  speedBonus: number;
  /**
   * The team's vote tied with no majority, so a designated leader must pick the
   * final answer before this question can score. While true, `leadId` names the
   * deciding member and `candidates` lists the tied answers they may choose from;
   * `answer`/`correct`/`points` are not final until a later reveal has
   * `needsLeader` false (or absent).
   */
  needsLeader?: boolean;
  /** The member who breaks a tie (`needsLeader`). */
  leaderId?: string;
  /** The tied answers the leader may choose between (`needsLeader`). */
  candidates?: string[];
}

export interface LanResultPayload {
  quizId: number;
  quizTitle: string;
  quizType: string;
  timePerQuestion: number;
  score: number;
  correctCount: number;
  answeredCount: number;
  totalQuestions: number;
  /** See LanPlayer.answers -- absent on an older client build. */
  answers?: LanAnswerLog;
}

export type LanMessage =
  | { t: 'chunk'; id: string; seq: number; total: number; data: string }
  | { t: 'hello'; code: string; name: string; avatar?: string }
  | { t: 'ping' }
  | { t: 'result'; data: LanResultPayload }
  | { t: 'welcome'; roomCode: string; playerId: string; hostName?: string; hostAvatar?: string; teamMode?: boolean }
  | { t: 'roster'; players: LanPlayer[] }
  | { t: 'teams'; teams: LanTeam[] }
  | { t: 'team-join'; teamId: string | null }
  | { t: 'team-add'; name?: string }
  | { t: 'team-rename'; teamId: string; name: string }
  | { t: 'quiz'; quiz: QuizPayload; order: number[]; timePerQuestion: number }
  | { t: 'start' }
  /**
   * The host owns the shared clock. Sent when a question opens (right after the
   * quiz and again on every advance): `startedAt` is the host's epoch ms and
   * every client derives its countdown from it, so all devices show the same
   * seconds left instead of each running its own independent timer from the
   * moment it happened to receive the quiz.
   */
  | { t: 'question'; index: number; startedAt: number; timeLimit: number }
  /** A player has read the current question and is ready for the next one. */
  | { t: 'ready'; playerId: string; index: number }
  /** What the host counted this round: how many are ready of how many active. */
  | { t: 'ready-count'; index: number; ready: number; expected: number }
  /**
   * A team leader asks to move the room on. The host validates the sender
   * against that team's leader (first connected member) and, if so, advances the
   * shared question the same way a host tap does. SUPERSEDES `ready` for players.
   */
  | { t: 'advance'; playerId: string; index: number }
  /**
   * The host's team vote tied, so a leader must break it. Broadcast after the
   * team's `needsLeader` reveal; the client whose id matches `leaderId` shows
   * the candidates and a Confirm, then sends `leader-answer`.
   */
  | { t: 'team-decision'; index: number; teamId: string; leaderId: string; candidates: string[] }
  /** The designated leader's chosen final answer for a tied team vote. */
  | { t: 'leader-answer'; index: number; answer: string }
  /**
   * A player has armed a shared team power-up for question `index`. The host
   * validates it, decrements the team pool, computes hint choices if needed,
   * and broadcasts `team-powerups`.
   */
  | { t: 'powerup'; index: number; key: PowerupKey }
  /**
   * A member earned a power-up on a streak in team play. The host adds it to
   * that member's shared team pool (online, the server does this) and
   * re-broadcasts `team-powerups`.
   */
  | { t: 'powerup-earned'; key: PowerupKey }
  /**
   * Host broadcast of team power-ups for question `index`. `armed` lists, per
   * team id, the power-up keys armed for this question; `hintChoices` are the
   * two wrong choices to hide when the hint is active (shared by the team).
   */
  | {
      t: 'team-powerups';
      index: number;
      teams: LanTeam[];
      armed?: Record<string, PowerupKey[]>;
      hintChoices?: string[];
      /**
       * Set only on the question a team earned a streak reward on. The pool
       * count alone cannot tell a member that a reward was JUST won (it also
       * moves when a power-up is armed), so the host names the reward here and
       * every member of that team shows the same roulette -- not just whoever's
       * device happened to trigger the streak. `teamId` scopes it: the broadcast
       * is room-wide, so a rival team must not see this team's reward.
       */
      reward?: { key: PowerupKey; index: number; teamId: string };
    }
  /**
   * Group play: a player reports the option they picked for `index`. The host
   * tallies these and echoes them back so every member can see what their own
   * teammates chose while the question is still open (and after, on the reveal).
   */
  | { t: 'pick'; playerId: string; index: number; answer: string; timeTaken?: number }
  /** The host's tally for `index`: every reported pick, keyed by player id. */
  | { t: 'picks'; index: number; picks: Record<string, string> }
  /**
   * Host broadcast once every member of a team has answered `index` (or the
   * question times out). Carries the resolved team answer and scoring, keyed by
   * team id, so each member can render the same reveal the online team path
   * does and fold the team's points into their own result log.
   */
  | { t: 'team-reveal'; index: number; reveals: Record<string, LanReveal> }
  /**
   * Group play: a player taps a cheer emoji. Sent client -> host; the host
   * validates it and re-broadcasts `reaction` to that player's team-mates only
   * (the online bar is room-wide, but a LAN cheer is meant for your own team).
   */
  | { t: 'react'; emoji: string }
  /** Host delivery of a cheer to the sender's team-mates. */
  | {
      t: 'reaction';
      id: string;
      emoji: string;
      playerId: string;
      displayName: string;
      teamId?: string | null;
      at: number;
    }
  | { t: 'leaderboard'; players: LanPlayer[]; final: boolean; teams?: LanTeam[] }
  | { t: 'end'; reason: string }
  /**
   * The host reset the finished game and is opening a fresh lobby with the same
   * room, players and teams. Clients return to /game/lobby on receipt; the host
   * navigates itself. Mirrors the online group rematch, which drops everyone
   * back into the same room's lobby.
   */
  | { t: 'rematch' }
  /**
   * The host changed the game mode (classic <-> group) while the room is still
   * on the Play tab. Clients re-tint their mode card and lock it. Sent on its
   * own so a joiner who is already seated sees the switch without a roster
   * frame; `hello` re-sends it so a late joiner starts in the right mode.
   */
  | { t: 'mode'; teamMode: boolean }
  /**
   * The host pressed START and is opening the group lobby (and pick window).
   * Joiners navigate to /game/lobby on receipt; `hello` re-sends it so a client
   * that reconnects mid-countdown still lands in the room instead of sitting on
   * the Play tab.
   */
  | { t: 'lobby'; teamMode?: boolean; topic?: string }
  | { t: 'error'; message: string };

export function encodeMessage(msg: LanMessage): string[] {
  const json = JSON.stringify(msg);
  if (json.length <= MAX_CHUNK) {
    return [json + '\n'];
  }
  const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const total = Math.ceil(json.length / MAX_CHUNK);
  const lines: string[] = [];
  for (let i = 0; i < total; i++) {
    const data = json.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK);
    lines.push(JSON.stringify({ t: 'chunk', id: ref, seq: i, total, data }) + '\n');
  }
  return lines;
}

export class LineBuffer {
  private buffer = '';
  private chunks = new Map<string, { total: number; parts: Map<number, string> }>();
  private onMessage: (msg: LanMessage) => void;

  constructor(onMessage: (msg: LanMessage) => void) {
    this.onMessage = onMessage;
  }

  push(raw: any) {
    this.buffer += typeof raw === 'string' ? raw : raw.toString('utf8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed && parsed.t === 'chunk') {
        const existing = this.chunks.get(parsed.id);
        const total = existing?.total ?? parsed.total;
        if (!existing && total < 1) continue;
        if (parsed.seq < 0 || parsed.seq >= total) continue;
        const parts = existing?.parts ?? new Map<number, string>();
        parts.set(parsed.seq, parsed.data);
        this.chunks.set(parsed.id, { total, parts });
        if (parts.size === total) {
          const full = Array.from({ length: total }, (_, i) => parts.get(i)).join('');
          this.chunks.delete(parsed.id);
          try {
            this.onMessage(JSON.parse(full) as LanMessage);
          } catch {}
        }
      } else {
        this.onMessage(parsed as LanMessage);
      }
    }
  }

  reset() {
    this.buffer = '';
    this.chunks.clear();
  }
}