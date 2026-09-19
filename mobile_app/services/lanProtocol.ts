import type { QuizPayload } from './offlineEngine';

export const LAN_PORT = 5050;
export const MAX_CHUNK = 24000;

export function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export interface GameQuestionPick {
  type: 'mcq' | 'identification';
  question: string;
  choices?: string[];
  correctAnswer: string;
  explanation?: string | null;
}

export interface LanPlayer {
  id: string;
  name: string;
  connected: boolean;
  finished: boolean;
  score: number;
  correctCount: number;
  answeredCount: number;
  totalQuestions: number;
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
}

export type LanMessage =
  | { t: 'chunk'; id: string; seq: number; total: number; data: string }
  | { t: 'hello'; code: string; name: string }
  | { t: 'ping' }
  | { t: 'result'; data: LanResultPayload }
  | { t: 'welcome'; roomCode: string; playerId: string }
  | { t: 'roster'; players: LanPlayer[] }
  | { t: 'quiz'; quiz: QuizPayload; order: number[]; timePerQuestion: number }
  | { t: 'start' }
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