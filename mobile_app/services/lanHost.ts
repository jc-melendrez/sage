import TcpSocket from 'react-native-tcp-socket';
import {
  LAN_PORT,
  LanMessage,
  LanPlayer,
  LanResultPayload,
  LanTeam,
  LineBuffer,
  encodeMessage,
} from './lanProtocol';
import type { QuizPayload } from './offlineEngine';
import type { PowerupKey } from '@/types/game';
import { emptyPowerupPool } from '@/types/game';

interface Connection {
  id: string;
  name: string;
  avatar?: string;
  socket: any;
  buffer: LineBuffer;
}

/**
 * Reused across every team the host creates so LAN team rooms read as the same
 * visual language as the online lobby's team columns.
 */
const TEAM_COLORS = ['#22D3EE', '#F59E0B', '#34D399', '#F472B6', '#A78BFA', '#FB7185'];

export class LanHostServer {
  readonly roomCode: string;
  players: LanPlayer[] = [];
  teams: LanTeam[] = [];
  teamMode = false;
  private hostInfo: { name?: string; avatar?: string };
  private connections = new Map<string, Connection>();
  private nameSet = new Set<string>();
  private server: any = null;
  private quiz: QuizPayload | null = null;
  private order: number[] = [];
  private timePerQuestion = 30;
  private started = false;
  private stopped = false;
  private endedOnce = false;
  private listeners = new Set<(msg: LanMessage) => void>();

  constructor(roomCode: string, hostInfo?: { name?: string; avatar?: string }) {
    this.roomCode = roomCode;
    this.hostInfo = hostInfo ?? {};
  }

  /** Update host identity shown to joiners (e.g. once profile data loads). */
  setHostInfo(info: { name?: string; avatar?: string }) {
    this.hostInfo = { ...this.hostInfo, ...info };
  }

  /** Replace every message listener (legacy single-listener contract). */
  onMessage(fn: (msg: LanMessage) => void) {
    this.listeners.clear();
    this.listeners.add(fn);
  }

  /**
   * Add a message listener without replacing existing ones. Returns an
   * unsubscribe function. Screens that mount while a host already exists
   * (the lobby under the Game Center) must use this -- `onMessage` would
   * otherwise cut off the screen that created the host.
   */
  addMessageListener(fn: (msg: LanMessage) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  setTeamMode(on: boolean) {
    this.teamMode = on;
  }

  /** Create the initial `count` teams. Idempotent against an existing set. */
  setTeams(count: number) {
    this.teamMode = count > 0;
    while (this.teams.length < count) {
      const i = this.teams.length;
      this.teams.push({
        id: String(i + 1),
        name: `Team ${i + 1}`,
        color: TEAM_COLORS[i % TEAM_COLORS.length],
        powerups: emptyPowerupPool(),
      });
    }
    if (this.teams.length > count) {
      const keep = new Set(this.teams.slice(0, count).map(t => t.id));
      this.players.forEach(p => {
        if (p.teamId && !keep.has(p.teamId)) p.teamId = undefined;
      });
      this.teams = this.teams.slice(0, count);
    }
  }

  addTeam(name?: string): LanTeam {
    const team: LanTeam = {
      id: String(this.teams.length + 1),
      name: (name || '').trim().slice(0, 24) || `Team ${this.teams.length + 1}`,
      color: TEAM_COLORS[this.teams.length % TEAM_COLORS.length],
      powerups: emptyPowerupPool(),
    };
    this.teams.push(team);
    this.teamMode = true;
    return team;
  }

  renameTeam(teamId: string, name: string) {
    const team = this.teams.find(t => t.id === String(teamId));
    if (!team) return;
    const clean = (name || '').trim().slice(0, 24);
    if (clean) team.name = clean;
  }

  assignTeam(playerId: string, teamId: string | null) {
    const p = this.players.find(x => x.id === playerId);
    if (!p) return;
    const target = teamId == null ? null : this.teams.find(t => t.id === String(teamId));
    if (teamId != null && !target) return;
    p.teamId = target ? target.id : undefined;
  }

  /** Deal every connected unassigned player into teams round-robin. */
  autoAssignTeams() {
    if (this.teams.length === 0) return;
    const unassigned = this.players.filter(p => p.connected && !p.teamId);
    unassigned.forEach((p, i) => {
      p.teamId = this.teams[i % this.teams.length].id;
    });
  }

  /** Push the current teams + roster to every client (host-side edits). */
  broadcastTeams() {
    this.broadcast({ t: 'roster', players: this.players });
    this.broadcast({ t: 'teams', teams: this.teams });
  }

  setQuiz(quiz: QuizPayload, order: number[], timePerQuestion: number) {
    this.quiz = quiz;
    this.order = order;
    this.timePerQuestion = timePerQuestion;
  }

  /** Question the room is on, and when the host opened its shared clock. */
  private currentIndex = 0;
  private questionStartedAt: number | null = null;
  /** Which players have marked each question read, keyed by question index. */
  private readonly readyByIndex = new Map<number, Set<string>>();
  /** Group play: reported picks per question, keyed by player id. */
  private readonly picksByIndex = new Map<number, Record<string, string>>();
  /** Per-question team power-ups armed, keyed by index then team id. */
  private readonly armedTeamsByIndex = new Map<number, Record<string, PowerupKey[]>>();
  /** Per-question hint choices the host chose, shared by the team. */
  private readonly hintChoicesByIndex = new Map<number, string[]>();

  /** The armed power-up keys per team for `index`, for the wire broadcast. */
  private armedForIndex(index: number): Record<string, PowerupKey[]> {
    return this.armedTeamsByIndex.get(index) ?? {};
  }

  /**
   * Open `index` on the shared clock and tell every client.
   *
   * The host is the timekeeper: `startedAt` is this device's clock, and every
   * client derives its countdown from it, so all screens agree on the seconds
   * left instead of each one running a timer from the moment it received the
   * quiz.
   */
  broadcastQuestion(index: number) {
    this.currentIndex = index;
    this.questionStartedAt = Date.now();
    this.readyByIndex.delete(index);
    this.armedTeamsByIndex.delete(index);
    this.hintChoicesByIndex.delete(index);
    this.broadcast({
      t: 'question',
      index,
      startedAt: this.questionStartedAt,
      timeLimit: this.timePerQuestion,
    });
    if (this.teamMode) {
      this.broadcast({ t: 'team-powerups', index, teams: this.teams, armed: this.armedForIndex(index) });
    }
  }

  /** Host-forced advance: the escape hatch for a player who never readies up. */
  advanceQuestion() {
    const total = this.quiz?.questions?.length ?? 0;
    if (this.currentIndex + 1 < total) {
      this.broadcastQuestion(this.currentIndex + 1);
    } else {
      this.endGame('The host moved past the last question');
    }
  }

  /** A player marked question `index` read. Advance once everyone has. */
  markReady(playerId: string, index: number) {
    if (!playerId) return;
    const set = this.readyByIndex.get(index) ?? new Set<string>();
    set.add(playerId);
    this.readyByIndex.set(index, set);
    const active = this.players.filter(p => p.connected);
    const ready = active.filter(p => set.has(p.id)).length;
    this.broadcast({ t: 'ready-count', index, ready, expected: active.length });
    if (active.length > 0 && ready >= active.length && index === this.currentIndex) {
      this.advanceQuestion();
    }
  }

  /**
   * Group play: remember a member's pick for `index` and echo the whole tally
   * back, so live "who picked what on my team" is the host's view of the room
   * rather than each client guessing. Mirrors the online team doc's `livePicks`.
   */
  recordPick(playerId: string, index: number, answer: string) {
    if (!playerId) return;
    const picks = this.picksByIndex.get(index) ?? {};
    picks[playerId] = answer;
    this.picksByIndex.set(index, picks);
    this.broadcast({ t: 'picks', index, picks });
  }

  /** Add an earned power-up to the member's shared team pool (team mode). */
  grantTeamPowerup(playerId: string, key: PowerupKey) {
    if (!this.teamMode) return;
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.teamId) return;
    const team = this.teams.find(t => t.id === player.teamId);
    if (!team) return;
    const p = team.powerups ?? (team.powerups = emptyPowerupPool());
    p[key] = (p[key] ?? 0) + 1;
    this.broadcast({ t: 'team-powerups', index: this.currentIndex, teams: this.teams, armed: this.armedForIndex(this.currentIndex) });
  }

  recordPowerup(playerId: string, index: number, key: PowerupKey) {
    if (!this.teamMode || !this.quiz) return;
    if (index !== this.currentIndex) return;
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.connected) return;
    const teamId = player.teamId;
    if (!teamId) return;
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return;
    const p = team.powerups ?? (team.powerups = emptyPowerupPool());
    const armed = this.armedTeamsByIndex.get(index) ?? {};
    const teamArmed = armed[team.id] ?? [];
    if (p[key] <= 0 || teamArmed.includes(key)) {
      // Still broadcast teams to keep state consistent.
      this.broadcast({ t: 'team-powerups', index, teams: this.teams, armed });
      return;
    }
    p[key] = Math.max(0, p[key] - 1);
    armed[team.id] = [...teamArmed, key];
    this.armedTeamsByIndex.set(index, armed);
    let hintChoices: string[] | undefined;
    if (key === 'hint') {
      // Prefer the hint the client already picked (kept stable across members);
      // otherwise pick two wrong ones here so both members hide the same pair.
      const existing = this.hintChoicesByIndex.get(index);
      if (existing && existing.length > 0) {
        hintChoices = existing;
      } else {
        const qIndex = this.order[this.currentIndex];
        const q = this.quiz.questions?.[qIndex];
        if (q && Array.isArray(q.options)) {
          const correct = q.correct_answer ?? '';
          const wrong = q.options.filter((c: string) => c !== correct);
          for (let i = wrong.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
          }
          hintChoices = wrong.slice(0, 2);
          this.hintChoicesByIndex.set(index, hintChoices);
        }
      }
    }
    this.broadcast({ t: 'team-powerups', index, teams: this.teams, armed, hintChoices });
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
    this.endedOnce = false;
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
    this.endedOnce = false;
    this.connections.forEach(c => {
      try {
        c.socket.destroy();
      } catch {}
    });
    this.connections.clear();
    this.nameSet.clear();
    this.players = [];
    this.teams = [];
    this.teamMode = false;
    this.currentIndex = 0;
    this.questionStartedAt = null;
    this.readyByIndex.clear();
    this.picksByIndex.clear();
    this.armedTeamsByIndex.clear();
    this.hintChoicesByIndex.clear();
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
    this.broadcast({ t: 'teams', teams: this.teams });
    this.broadcast({ t: 'quiz', quiz: this.quiz, order: this.order, timePerQuestion: this.timePerQuestion });
    this.broadcast({ t: 'start' });
    // Open question one on the shared clock immediately, so the first countdown
    // is host-driven like every later one rather than starting when each
    // client's `start` handler happened to run.
    this.broadcastQuestion(0);
  }

  endGame(reason = 'The host ended the game') {
    if (this.stopped) return;
    this.stopped = true;
    this.broadcast({ t: 'end', reason });
  }

  private emit(msg: LanMessage) {
    if (this.listeners.size === 0) return;
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {}
    }
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
      conn.avatar = msg.avatar;
      this.nameSet.add(unique.toLowerCase());
      this.players.push({
        id: conn.id,
        name: unique,
        avatar: msg.avatar,
        connected: true,
        finished: false,
        score: 0,
        correctCount: 0,
        answeredCount: 0,
        totalQuestions: 0,
      });
      this.send(conn, { t: 'welcome', roomCode: this.roomCode, playerId: conn.id, hostName: this.hostInfo.name, hostAvatar: this.hostInfo.avatar, teamMode: this.teamMode });
      this.broadcast({ t: 'roster', players: this.players });
      this.broadcast({ t: 'teams', teams: this.teams });
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
    if (msg.t === 'team-join') {
      this.assignTeam(conn.id, msg.teamId);
      this.broadcast({ t: 'roster', players: this.players });
      this.broadcast({ t: 'teams', teams: this.teams });
      return;
    }
    // Team housekeeping is host-only. The host's own socket is the only one
    // that can know the host's display name before its hello, so matching on
    // it keeps joiners from creating/renaming teams. The Game Center's lobby
    // host lane calls addTeam/renameTeam directly anyway -- this is a mirror
    // for whatever flows through the loopback socket.
    const isHostSocket = conn.name === (this.hostInfo.name ?? '');
    if (msg.t === 'team-add' && isHostSocket) {
      this.addTeam(msg.name);
      this.broadcast({ t: 'roster', players: this.players });
      this.broadcast({ t: 'teams', teams: this.teams });
      return;
    }
    if (msg.t === 'team-rename' && isHostSocket) {
      this.renameTeam(msg.teamId, msg.name);
      this.broadcast({ t: 'roster', players: this.players });
      this.broadcast({ t: 'teams', teams: this.teams });
      return;
    }
    if (msg.t === 'ready') {
      this.markReady(conn.id, msg.index);
      return;
    }
    if (msg.t === 'pick') {
      this.recordPick(conn.id, msg.index, msg.answer);
      return;
    }
    if (msg.t === 'powerup') {
      this.recordPowerup(conn.id, msg.index, msg.key);
      return;
    }
    if (msg.t === 'powerup-earned') {
      this.grantTeamPowerup(conn.id, msg.key);
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
    // Optional: a client build from before the answer log was added simply
    // omits it, and its row renders without a breakdown rather than breaking
    // the whole leaderboard broadcast.
    if (data.answers && typeof data.answers === 'object') {
      p.answers = data.answers;
    }
    p.finished = true;
    this.broadcast({ t: 'leaderboard', players: this.sortedPlayers(), final: this.allFinished() });
    if (this.allFinished() && !this.endedOnce) {
      this.endedOnce = true;
      // Let the final leaderboard round-trip, then close the server so a
      // "play again" session starts fresh instead of reusing a stale one.
      this.broadcast({ t: 'end', reason: 'All players have finished' });
      setTimeout(() => this.stop(), 800);
    }
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