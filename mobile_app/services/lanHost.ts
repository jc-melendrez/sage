import TcpSocket from 'react-native-tcp-socket';
import {
  LAN_PORT,
  LanMessage,
  LanPlayer,
  LanResultPayload,
  LineBuffer,
  encodeMessage,
} from './lanProtocol';
import type { QuizPayload } from './offlineEngine';

interface Connection {
  id: string;
  name: string;
  socket: any;
  buffer: LineBuffer;
}

export class LanHostServer {
  readonly roomCode: string;
  players: LanPlayer[] = [];
  private connections = new Map<string, Connection>();
  private nameSet = new Set<string>();
  private server: any = null;
  private quiz: QuizPayload | null = null;
  private order: number[] = [];
  private timePerQuestion = 30;
  private started = false;
  private stopped = false;
  private listener: ((msg: LanMessage) => void) | null = null;

  constructor(roomCode: string) {
    this.roomCode = roomCode;
  }

  onMessage(fn: (msg: LanMessage) => void) {
    this.listener = fn;
  }

  setQuiz(quiz: QuizPayload, order: number[], timePerQuestion: number) {
    this.quiz = quiz;
    this.order = order;
    this.timePerQuestion = timePerQuestion;
  }

  get isStarted() {
    return this.started;
  }

  get playerCount() {
    return this.players.filter(p => p.connected).length;
  }

  start() {
    if (this.server) return;
    this.stopped = false;
    this.server = TcpSocket.createServer((socket: any) => {
      const conn: Connection = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        socket,
        buffer: new LineBuffer(msg => this.handleClient(conn, msg)),
      };
      this.connections.set(conn.id, conn);
      socket.setNoDelay(true);
      socket.on('data', (d: any) => conn.buffer.push(d));
      socket.on('error', () => this.drop(conn));
      socket.on('close', () => this.drop(conn));
    });
    this.server.on('error', (e: any) => this.emit({ t: 'error', message: `Server error: ${e.message}` }));
    this.server.listen({ port: LAN_PORT, host: '0.0.0.0' });
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.connections.forEach(c => {
      try {
        c.socket.destroy();
      } catch {}
    });
    this.connections.clear();
    this.nameSet.clear();
    this.players = [];
    try {
      this.server?.close();
    } catch {}
    this.server = null;
  }

  startGame() {
    if (!this.quiz || this.started) return;
    this.started = true;
    try {
      const json = JSON.stringify({ t: 'quiz', quiz: this.quiz, order: this.order, timePerQuestion: this.timePerQuestion });
      console.log(`[lanHost] startGame: broadcast quiz ${json.length} bytes to ${this.connections.size} conn(s), players=${this.players.length}`);
    } catch (e) {
      console.log('[lanHost] startGame: quiz SERIALIZATION error', e);
    }
    this.broadcast({ t: 'roster', players: this.players });
    this.broadcast({ t: 'quiz', quiz: this.quiz, order: this.order, timePerQuestion: this.timePerQuestion });
    this.broadcast({ t: 'start' });
  }

  endGame(reason = 'The host ended the game') {
    if (this.stopped) return;
    this.stopped = true;
    this.broadcast({ t: 'end', reason });
  }

  private emit(msg: LanMessage) {
    if (!this.listener) return;
    try {
      this.listener(msg);
    } catch {}
  }

  private send(conn: Connection, msg: LanMessage) {
    if (!conn.socket) return;
    try {
      for (const line of encodeMessage(msg)) conn.socket.write(line);
    } catch {}
  }

  private broadcast(msg: LanMessage) {
    this.connections.forEach(c => this.send(c, msg));
    this.emit(msg);
  }

  private handleClient(conn: Connection, msg: LanMessage) {
    if (this.stopped) {
      this.send(conn, { t: 'error', message: 'This session is closed' });
      return;
    }
    if (msg.t === 'hello') {
      if (this.started) {
        this.send(conn, { t: 'error', message: 'This game already started' });
        return;
      }
      if (msg.code !== this.roomCode) {
        this.send(conn, { t: 'error', message: 'Wrong room code' });
        return;
      }
      const clean = (msg.name || '').trim().slice(0, 20);
      if (!clean) {
        this.send(conn, { t: 'error', message: 'Enter a name to join' });
        return;
      }
      let unique = clean;
      let i = 2;
      while (this.nameSet.has(unique.toLowerCase())) {
        unique = `${clean} ${i}`;
        i += 1;
      }
      conn.name = unique;
      this.nameSet.add(unique.toLowerCase());
      this.players.push({
        id: conn.id,
        name: unique,
        connected: true,
        finished: false,
        score: 0,
        correctCount: 0,
        answeredCount: 0,
        totalQuestions: 0,
      });
      this.send(conn, { t: 'welcome', roomCode: this.roomCode, playerId: conn.id });
      this.broadcast({ t: 'roster', players: this.players });
      return;
    }
    if (!conn.name) {
      this.send(conn, { t: 'error', message: 'Say hello first' });
      return;
    }
    if (msg.t === 'ping') {
      this.send(conn, { t: 'ping' });
      return;
    }
    if (msg.t === 'result') {
      this.applyResult(conn, msg.data);
    }
  }

  private applyResult(conn: Connection, data: LanResultPayload) {
    if (!data || typeof data.score !== 'number') return;
    const p = this.players.find(x => x.id === conn.id);
    if (!p) return;
    p.score = data.score;
    p.correctCount = data.correctCount;
    p.answeredCount = data.answeredCount;
    p.totalQuestions = data.totalQuestions;
    p.finished = true;
    this.broadcast({ t: 'leaderboard', players: this.sortedPlayers(), final: this.allFinished() });
  }

  private drop(conn: Connection) {
    if (!this.connections.delete(conn.id)) return;
    if (conn.name) this.nameSet.delete(conn.name.toLowerCase());
    const p = this.players.find(x => x.id === conn.id);
    if (p) {
      p.connected = false;
      if (!this.started) {
        this.players = this.players.filter(x => x.id !== conn.id);
      }
    }
    this.broadcast({ t: 'roster', players: this.players });
  }

  private sortedPlayers(): LanPlayer[] {
    return [...this.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  private allFinished(): boolean {
    const active = this.players.filter(p => p.connected);
    return active.length > 0 && active.every(p => p.finished);
  }
}

export function makeOrder(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}