import type { QuizPayload } from './offlineEngine';

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
   * Group play: a player reports the option they picked for `index`. The host
   * tallies these and echoes them back so every member can see what their own
   * teammates chose while the question is still open (and after, on the reveal).
   */
  | { t: 'pick'; playerId: string; index: number; answer: string }
  /** The host's tally for `index`: every reported pick, keyed by player id. */
  | { t: 'picks'; index: number; picks: Record<string, string> }
  | { t: 'leaderboard'; players: LanPlayer[]; final: boolean }
  | { t: 'end'; reason: string }
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