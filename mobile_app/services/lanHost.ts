import TcpSocket from 'react-native-tcp-socket';
import {
  LAN_PORT,
  LanMessage,
  LanPlayer,
  LanResultPayload,
  LanReveal,
  LanTeam,
  LineBuffer,
  encodeMessage,
} from './lanProtocol';
import {
  buildQuestions,
  answerMatches,
  TYPED_QUESTION_TYPES,
  isDoublePointQuestion,
  streakBonusMultiplier,
  STREAK_REWARD_INTERVAL,
} from './offlineEngine';
import type { QuizPayload, GameQuestion } from './offlineEngine';
import type { PowerupKey } from '@/types/game';
import { emptyPowerupPool } from '@/types/game';

/** The four power-up kinds, in the pool's canonical order. */
const POWERUP_KEYS: PowerupKey[] = ['freeze', 'hint', 'doublePoints', 'shield'];

/**
 * The host's representative answer time for a team: the median of the recorded
 * pick times. Mirrors `median_pick_time` in the backend so a LAN team is scored
 * off the same speed as the same picks made online. Unrecorded times are
 * dropped rather than defaulted, so a data gap cannot drag the team down.
 */
function medianPickTime(values: number[]): number | null {
  const times = values
    .filter(t => typeof t === 'number' && isFinite(t) && t >= 0 && t <= 60)
    .sort((a, b) => a - b);
  if (times.length === 0) return null;
  const mid = Math.floor(times.length / 2);
  if (times.length % 2) return times[mid];
  return (times[mid - 1] + times[mid]) / 2;
}

interface TeamTally {
  choice: string;
  agreed: number;
  pickers: number;
  void: boolean;
  split: boolean;
}

/**
 * Resolve a team's private picks into one answer: plain majority wins. A pure
 * 1-1 disagreement is settled by a coin flip; any larger even split voids.
 * Mirrors `tally_team_picks` in the backend, including the lenient
 * case/whitespace-folding when the question is typed (so two members who typed
 * "Mitochondria" and "mitochondria" are one vote, not a split).
 */
function tallyTeamPicks(values: string[], typed: boolean): TeamTally {
  const counts = new Map<string, number>();
  const sample = new Map<string, string>();
  for (const value of values) {
    const raw = String(value ?? '');
    if (!raw.trim()) continue;
    const key = typed ? raw.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!sample.has(key)) sample.set(key, raw);
  }
  const pickers = values.filter(v => String(v ?? '').trim()).length;
  if (counts.size === 0) {
    return { choice: '', agreed: 0, pickers: 0, void: true, split: false };
  }
  const top = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, c]) => c === top).map(([k]) => k);
  if (leaders.length === 1) {
    return { choice: sample.get(leaders[0]) ?? '', agreed: top, pickers, void: false, split: false };
  }
  if (leaders.length === 2 && pickers === 2) {
    const winner = leaders[Math.floor(Math.random() * leaders.length)];
    return { choice: sample.get(winner) ?? '', agreed: counts.get(winner) ?? 0, pickers, void: false, split: true };
  }
  return { choice: '', agreed: top, pickers, void: true, split: true };
}

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
    // Canonical question list, in the SAME order every client builds from the
    // relayed quiz. Team questions are indexed by position (LAN team play uses
    // identity order, matching the online team path), so `questions[index]` is
    // the question every member is looking at.
    this.questions = buildQuestions(quiz);
  }

  /** Question the room is on, and when the host opened its shared clock. */
  private currentIndex = 0;
  private questionStartedAt: number | null = null;
  /** Canonical questions, built from the quiz at setQuiz time. */
  private questions: GameQuestion[] = [];
  /** Which players have marked each question read, keyed by question index. */
  private readonly readyByIndex = new Map<number, Set<string>>();
  /** Group play: reported picks per question, keyed by player id. */
  private readonly picksByIndex = new Map<number, Record<string, string>>();
  /** Group play: reported pick times per question, keyed by player id. */
  private readonly pickTimesByIndex = new Map<number, Record<string, number>>();
  /** Resolved team reveals per question, keyed by team id. */
  private readonly revealsByIndex = new Map<number, Record<string, LanReveal>>();
  /** Per-question team power-ups armed, keyed by index then team id. */
  private readonly armedTeamsByIndex = new Map<number, Record<string, PowerupKey[]>>();
  /** Per-question hint choices the host chose, shared by the team. */
  private readonly hintChoicesByIndex = new Map<number, string[]>();
  /** Resolves a team's stragglers when the shared question timer expires. */
  private questionTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.picksByIndex.delete(index);
    this.pickTimesByIndex.delete(index);
    this.broadcast({
      t: 'question',
      index,
      startedAt: this.questionStartedAt,
      timeLimit: this.timePerQuestion,
    });
    if (this.teamMode) {
      this.broadcast({ t: 'team-powerups', index, teams: this.teams, armed: this.armedForIndex(index) });
    }
    // The host is the timekeeper for team resolution too: when the shared clock
    // runs out, resolve whichever teams have not settled so a straggler cannot
    // hold the room on a question past the buzzer.
    if (this.questionTimer != null) {
      clearTimeout(this.questionTimer);
      this.questionTimer = null;
    }
    if (this.teamMode) {
      this.questionTimer = setTimeout(() => {
        this.questionTimer = null;
        if (index === this.currentIndex) this.resolveOpenTeams(index);
      }, (this.timePerQuestion + 0.75) * 1000);
    }
  }

  /** Connected players seated on `teamId`. */
  private teamMembers(teamId: string): LanPlayer[] {
    return this.players.filter(p => p.connected && String(p.teamId ?? '') === String(teamId));
  }

  /**
   * Every team on `index` that has at least one member but has not settled yet.
   * Used by the shared-clock timeout so a member who never answered does not
   * leave their team permanently unresolved.
   */
  private resolveOpenTeams(index: number) {
    if (!this.teamMode) return;
    const resolved = this.revealsByIndex.get(index) ?? {};
    for (const team of this.teams) {
      if (resolved[team.id]) continue;
      if (this.teamMembers(team.id).length === 0) continue;
      this.resolveTeam(index, team.id);
    }
  }

  /**
   * Resolve one team's answer for `index` and broadcast the reveal.
   *
   * The host is the authority here exactly as the server is online: it tallies
   * the majority vote, scores the team off the median pick time (streak bonus,
   * doubled question and an armed double-points, in that order), folds the
   * points into the team's running total and publishes the shared result. Every
   * member applies the same payload, so the team scores once -- not once per
   * player -- and the results screen can rank teams without summing members.
   */
  private resolveTeam(index: number, teamId: string, fallbackTime?: number) {
    if (!this.quiz) return;
    const question = this.questions[index];
    if (!question) return;
    const resolved = this.revealsByIndex.get(index) ?? {};
    if (resolved[teamId]) return;
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return;

    const picks = this.picksByIndex.get(index) ?? {};
    const times = this.pickTimesByIndex.get(index) ?? {};
    const members = this.teamMembers(teamId);
    const expected = members.length;
    const answeredIds = members
      .map(m => m.id)
      .filter(id => picks[id] != null && String(picks[id]).trim() !== '');
    const typed = (TYPED_QUESTION_TYPES as readonly string[]).includes(question.type);
    const tally = tallyTeamPicks(answeredIds.map(id => picks[id]), typed);
    const teamTime = medianPickTime(answeredIds.map(id => times[id]).filter((t): t is number => typeof t === 'number'))
      ?? (typeof fallbackTime === 'number' ? fallbackTime : this.timePerQuestion);
    let isCorrect = !tally.void
      && (typed ? answerMatches(tally.choice, question.correctAnswer) : tally.choice === question.correctAnswer);
    if (!String(question.correctAnswer || '').trim()) isCorrect = false;

    const armedForTeam = (this.armedTeamsByIndex.get(index) ?? {})[teamId] ?? [];
    const submitted = answeredIds.length > 0;
    const spentDouble = armedForTeam.includes('doublePoints');
    const spentShield = armedForTeam.includes('shield') && submitted;

    const priorCorrect = team.correctCount ?? 0;
    const priorStreak = team.teamStreak ?? 0;
    let points = 0;
    let speedBonus = 0;
    /** Named on the broadcast so every member shows the same reward roulette. */
    let rewardKey: PowerupKey | null = null;

    if (isCorrect) {
      const base = Math.max(Math.floor(1000 * (1 - (teamTime / this.timePerQuestion) * 0.5)), 500);
      points = base;
      speedBonus = base - 500;
      const newStreak = priorStreak + 1;
      const bonus = streakBonusMultiplier(newStreak);
      if (bonus !== 1.0) points = Math.round(points * bonus);
      if (isDoublePointQuestion(index)) points *= 2;
      if (spentDouble) points *= 2;
      team.score = (team.score ?? 0) + points;
      team.correctCount = priorCorrect + 1;
      team.teamCorrect = (team.teamCorrect ?? 0) + 1;
      team.teamStreak = newStreak;
      team.bestStreak = Math.max(team.bestStreak ?? 0, newStreak);
      team.answeredCount = (team.answeredCount ?? 0) + 1;
      // Guaranteed reward every 3rd consecutive correct team answer, never on
      // the last question (the game ends immediately after).
      if (index < this.questions.length - 1
          && newStreak >= STREAK_REWARD_INTERVAL
          && newStreak % STREAK_REWARD_INTERVAL === 0) {
        const p = team.powerups ?? (team.powerups = emptyPowerupPool());
        const lowest = Math.min(...POWERUP_KEYS.map(k => p[k] ?? 0));
        const candidates = POWERUP_KEYS.filter(k => (p[k] ?? 0) === lowest);
        const ptype = candidates[Math.floor(Math.random() * candidates.length)];
        p[ptype] = (p[ptype] ?? 0) + 1;
        rewardKey = ptype;
      }
    } else {
      team.answeredCount = (team.answeredCount ?? 0) + 1;
      if (!spentShield) team.teamStreak = 0;
    }

    team.memberCount = expected;
    const reveal: LanReveal = {
      index,
      answer: tally.choice,
      correctAnswer: question.correctAnswer,
      correct: isCorrect,
      void: tally.void,
      split: tally.split,
      agreed: tally.agreed,
      pickers: tally.pickers,
      expected,
      points,
      speedBonus,
    };
    resolved[teamId] = reveal;
    this.revealsByIndex.set(index, resolved);
    this.broadcast({ t: 'team-reveal', index, reveals: resolved });
    this.broadcast({
      t: 'team-powerups',
      index,
      teams: this.teams,
      armed: this.armedForIndex(index),
      ...(rewardKey ? { reward: { key: rewardKey, index, teamId } } : {}),
    });
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
  recordPick(playerId: string, index: number, answer: string, timeTaken?: number) {
    if (!playerId) return;
    const picks = this.picksByIndex.get(index) ?? {};
    picks[playerId] = answer;
    this.picksByIndex.set(index, picks);
    if (typeof timeTaken === 'number' && isFinite(timeTaken)) {
      const times = this.pickTimesByIndex.get(index) ?? {};
      times[playerId] = timeTaken;
      this.pickTimesByIndex.set(index, times);
    }
    this.broadcast({ t: 'picks', index, picks });
    // Team play resolves the moment the whole team has locked a pick, rather
    // than waiting on the clock: the shared clock then only bounds the members
    // who never answered.
    if (this.teamMode && index === this.currentIndex) {
      const player = this.players.find(p => p.id === playerId);
      const teamId = player?.teamId;
      if (teamId) {
        const members = this.teamMembers(teamId);
        const allPicked = members.length > 0
          && members.every(m => picks[m.id] != null && String(picks[m.id]).trim() !== '');
        if (allPicked) this.resolveTeam(index, teamId, timeTaken);
      }
    }
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
    this.broadcast({
      t: 'team-powerups',
      index: this.currentIndex,
      teams: this.teams,
      armed: this.armedForIndex(this.currentIndex),
      reward: { key, index: this.currentIndex, teamId: player.teamId },
    });
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
        // Read the canonical question the room is actually looking at. Team
        // play ignores the shuffle order (identity), so pick the same index the
        // members render; classic play follows `order`.
        const qIndex = this.teamMode ? index : this.order[this.currentIndex];
        const q = this.questions[qIndex];
        if (q && Array.isArray(q.choices) && q.choices.length > 0) {
          const wrong = q.choices.filter((c: string) => c !== q.correctAnswer);
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
    this.pickTimesByIndex.clear();
    this.revealsByIndex.clear();
    this.armedTeamsByIndex.clear();
    this.hintChoicesByIndex.clear();
    if (this.questionTimer != null) {
      clearTimeout(this.questionTimer);
      this.questionTimer = null;
    }
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
      this.recordPick(conn.id, msg.index, msg.answer, msg.timeTaken);
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
    this.broadcast({
      t: 'leaderboard',
      players: this.sortedPlayers(),
      final: this.allFinished(),
      teams: this.teamMode ? this.teams : undefined,
    });
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