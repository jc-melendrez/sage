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
import { REACTION_EMOJIS, emptyPowerupPool } from '@/types/game';

/**
 * Team streak rewards exclude freeze. Freeze pauses a single player's timer; a
 * team shares one countdown, so a frozen teammate has nothing to stop and the
 * freeze button is hidden in team mode. Awarding it would leave the team with a
 * power-up it cannot spend. Mirrors TEAM_POWERUP_KEYS in the backend.
 */
const TEAM_REWARD_KEYS: PowerupKey[] = ['hint', 'doublePoints', 'shield'];

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
  /** The tied answers, when a leader must break the tie (`needsLeader`). */
  candidates: string[];
  /** The vote tied with no majority, so a designated leader must decide. */
  needsLeader: boolean;
}

/**
 * Resolve a team's private picks into one answer: plain majority wins. A tie
 * (a 1-1, a 1-1-1, a 2-2, ...) has no majority, so a designated leader picks
 * the team's final answer -- there is no coin flip. Mirrors `tally_team_picks`
 * in the backend, including the lenient case/whitespace-folding when the
 * question is typed (so two members who typed "Mitochondria" and "mitochondria"
 * are one vote, not a split).
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
    return { choice: '', agreed: 0, pickers: 0, void: true, split: false, candidates: [], needsLeader: false };
  }
  const top = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, c]) => c === top).map(([k]) => k);
  if (leaders.length === 1) {
    return {
      choice: sample.get(leaders[0]) ?? '', agreed: top, pickers,
      void: false, split: false, candidates: [], needsLeader: false,
    };
  }
  return {
    choice: '', agreed: top, pickers, void: true, split: true,
    candidates: leaders.map(k => sample.get(k) ?? k),
    needsLeader: pickers >= 2,
  };
}

/** How long the designated leader has to break a tie before it auto-resolves. */
const DECISION_TIMEOUT_MS = 15000;

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
  /**
   * True once the host pressed START in group play and is pulling everyone into
   * /game/lobby. Re-sent to a client that (re)connects before the quiz starts so
   * it lands in the room rather than sitting on the Play tab.
   */
  private lobbyOpen = false;
  /** True once the TCP server has actually bound LAN_PORT. */
  private listening = false;
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
  setTeams(count: number): LanTeam[] {
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
    return this.teams;
  }

  /**
   * Switch the room between classic and group play while it is still on the
   * Play tab, mirroring the online `POST /game/mode/`. Group (re)creates the
   * team slots; classic releases every seat and drops the teams. The new mode
   * is broadcast so a joiner's locked mode card re-tints immediately.
   */
  setMode(mode: 'classic' | 'group', teamCount = 2): void {
    if (mode === 'group') {
      this.setTeams(Math.max(2, teamCount));
    } else {
      this.setTeams(0);
    }
    this.broadcast({ t: 'mode', teamMode: this.teamMode });
    this.broadcast({ t: 'roster', players: this.players });
    this.broadcast({ t: 'teams', teams: this.teams });
  }

  /** Host pressed START: tell joiners to open the lobby. */
  openLobby(topic?: string): void {
    this.lobbyOpen = true;
    this.broadcast({ t: 'lobby', teamMode: this.teamMode, topic });
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
  /**
   * Teams whose vote tied and are waiting on a designated leader to pick the
   * final answer, keyed by index then team id. A team is only ever "final"
   * once it is absent from here AND present in `finalTeamsByIndex`.
   */
  private readonly pendingDecisionsByIndex =
    new Map<number, Record<string, { leaderId: string; candidates: string[] }>>();
  /** Teams whose question is truly scored (not merely awaiting a leader). */
  private readonly finalTeamsByIndex = new Map<number, Set<string>>();
  /** Random starting offset in a team's leader rotation, fixed per session. */
  private readonly leaderSeedByTeam = new Map<string, number>();
  /** How many tie-breaks this team has had; drives the alternating leader. */
  private readonly decisionCountByTeam = new Map<string, number>();
  /** Auto-resolve timers for pending leader decisions, keyed `index:teamId`. */
  private readonly decisionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Whose turn it is to break a tie for `teamId`.
   *
   * The order is the team's connected roster (join order) filtered to the
   * members who actually answered, so the same pair alternates A, B, A, B... The
   * starting offset is randomised once per team so the first decider is not
   * always the same person.
   */
  private nextLeader(teamId: string, answeredIds: string[]): string {
    const roster = this.players
      .filter(p => String(p.teamId ?? '') === String(teamId))
      .map(p => p.id);
    const order = roster.filter(id => answeredIds.includes(id));
    if (order.length === 0) return answeredIds[0] ?? '';
    if (!this.leaderSeedByTeam.has(teamId)) {
      this.leaderSeedByTeam.set(teamId, Math.floor(Math.random() * order.length));
    }
    const seed = this.leaderSeedByTeam.get(teamId) ?? 0;
    const count = this.decisionCountByTeam.get(teamId) ?? 0;
    this.decisionCountByTeam.set(teamId, count + 1);
    return order[(seed + count) % order.length];
  }

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
    this.pendingDecisionsByIndex.delete(index);
    this.finalTeamsByIndex.delete(index);
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
  private resolveTeam(index: number, teamId: string, fallbackTime?: number, forcedAnswer?: string) {
    if (!this.quiz) return;
    const question = this.questions[index];
    if (!question) return;
    const finals = this.finalTeamsByIndex.get(index) ?? new Set<string>();
    if (finals.has(teamId)) return;
    const pending = this.pendingDecisionsByIndex.get(index) ?? {};
    // Already awaiting a leader: only `applyLeaderAnswer` may resume this team.
    if (pending[teamId] && forcedAnswer == null) return;
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

    // A tie has no majority, so a designated leader picks the team's final
    // answer. Publish the tie now and wait; the question only scores once the
    // leader (or the auto-resolve timer) has chosen.
    if (tally.needsLeader && forcedAnswer == null) {
      this.enterDecision(index, teamId, tally, answeredIds, expected);
      return;
    }

    let choice = tally.choice;
    let isVoid = tally.void;
    let isSplit = tally.split;
    let agreed = tally.agreed;
    if (forcedAnswer != null) {
      choice = forcedAnswer;
      isVoid = false;
      isSplit = true;
      agreed = answeredIds.filter(id => (
        typed ? answerMatches(String(picks[id]), forcedAnswer) : String(picks[id]) === forcedAnswer
      )).length;
    }

    const teamTime = medianPickTime(answeredIds.map(id => times[id]).filter((t): t is number => typeof t === 'number'))
      ?? (typeof fallbackTime === 'number' ? fallbackTime : this.timePerQuestion);
    let isCorrect = !isVoid
      && (typed ? answerMatches(choice, question.correctAnswer) : choice === question.correctAnswer);
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
        const lowest = Math.min(...TEAM_REWARD_KEYS.map(k => p[k] ?? 0));
        const candidates = TEAM_REWARD_KEYS.filter(k => (p[k] ?? 0) === lowest);
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
      answer: choice,
      correctAnswer: question.correctAnswer,
      correct: isCorrect,
      void: isVoid,
      split: isSplit,
      agreed,
      pickers: tally.pickers,
      expected,
      points,
      speedBonus,
    };
    const resolved = this.revealsByIndex.get(index) ?? {};
    resolved[teamId] = reveal;
    this.revealsByIndex.set(index, resolved);
    finals.add(teamId);
    this.finalTeamsByIndex.set(index, finals);
    this.broadcast({ t: 'team-reveal', index, reveals: resolved });
    this.broadcast({
      t: 'team-powerups',
      index,
      teams: this.teams,
      armed: this.armedForIndex(index),
      ...(rewardKey ? { reward: { key: rewardKey, index, teamId } } : {}),
    });
  }

  /**
   * A team's vote tied: publish the tie, name the deciding leader (alternating
   * per team), and wait for their `leader-answer`. An auto-resolve timer picks
   * the first candidate so a silent leader cannot stall the room.
   */
  private enterDecision(
    index: number, teamId: string, tally: TeamTally, answeredIds: string[], expected: number,
  ) {
    const leaderId = this.nextLeader(teamId, answeredIds);
    const pending = this.pendingDecisionsByIndex.get(index) ?? {};
    pending[teamId] = { leaderId, candidates: tally.candidates };
    this.pendingDecisionsByIndex.set(index, pending);

    const reveal: LanReveal = {
      index,
      answer: '',
      correctAnswer: this.questions[index]?.correctAnswer ?? '',
      correct: false,
      void: true,
      split: true,
      agreed: tally.agreed,
      pickers: tally.pickers,
      expected,
      points: 0,
      speedBonus: 0,
      needsLeader: true,
      leaderId,
      candidates: tally.candidates,
    };
    const resolved = this.revealsByIndex.get(index) ?? {};
    resolved[teamId] = reveal;
    this.revealsByIndex.set(index, resolved);
    this.broadcast({ t: 'team-reveal', index, reveals: resolved });
    this.broadcast({ t: 'team-decision', index, teamId, leaderId, candidates: tally.candidates });

    const key = `${index}:${teamId}`;
    const timer = setTimeout(() => {
      this.decisionTimers.delete(key);
      const still = (this.pendingDecisionsByIndex.get(index) ?? {})[teamId];
      if (!still) return;
      this.applyLeaderAnswer(index, teamId, tally.candidates[0] ?? '');
    }, DECISION_TIMEOUT_MS);
    this.decisionTimers.set(key, timer);
  }

  /** Commit a leader's tie-break and score the team for `index`. */
  applyLeaderAnswer(index: number, teamId: string, answer: string, fallbackTime?: number) {
    const pending = this.pendingDecisionsByIndex.get(index);
    if (!pending || !pending[teamId]) return;
    const { candidates } = pending[teamId];
    delete pending[teamId];
    if (Object.keys(pending).length === 0) this.pendingDecisionsByIndex.delete(index);
    const key = `${index}:${teamId}`;
    const timer = this.decisionTimers.get(key);
    if (timer != null) {
      clearTimeout(timer);
      this.decisionTimers.delete(key);
    }
    const chosen = candidates.includes(answer) ? answer : (candidates[0] ?? '');
    this.resolveTeam(index, teamId, fallbackTime, chosen);
  }

  /** Whether `playerId` leads their team (first connected member, join order). */
  private isTeamLeader(playerId: string): boolean {
    const p = this.players.find(x => x.id === playerId);
    if (!p || !p.teamId) return false;
    const tid = String(p.teamId);
    const first = this.players.find(x => x.connected && String(x.teamId ?? '') === tid);
    return !!first && first.id === playerId;
  }

  /** A leader tapped Next: move the room if they really lead a team. */
  private recordAdvance(playerId: string, index: number) {
    if (index !== this.currentIndex) return;
    if (this.isTeamLeader(playerId)) this.advanceQuestion();
  }

  /** A leader submitted their tie-break; commit it only from the named leader. */
  private recordLeaderAnswer(playerId: string, index: number, answer: string) {
    const pending = this.pendingDecisionsByIndex.get(index);
    if (!pending) return;
    const p = this.players.find(x => x.id === playerId);
    const teamId = p?.teamId != null ? String(p.teamId) : '';
    const entry = teamId ? pending[teamId] : undefined;
    if (!entry || entry.leaderId !== playerId) return;
    this.applyLeaderAnswer(index, teamId, answer);
  }

  /** Host-forced advance: the escape hatch for a player who never readies up. */
  advanceQuestion() {
    const pending = this.pendingDecisionsByIndex.get(this.currentIndex);
    // A tie-break is in flight: moving on now would drop the team's answer.
    if (pending && Object.keys(pending).length > 0) return;
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
    // Team play: a member with no team is a spectator. The online server rejects
    // their answer with 403 and ignores them in settlement, so the LAN host must
    // do the same -- never record a pick that would sway the shared team tally.
    if (this.teamMode) {
      const picker = this.players.find(p => p.id === playerId);
      if (!picker || !picker.teamId) return;
    }
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

  /**
   * True only while the server is actually bound and accepting connections.
   *
   * The Game Center uses this to decide whether an existing host can be reused
   * for a new session. A host whose server was stopped (or whose `listen` never
   * completed) must be treated as absent so a fresh, listening host is created
   * instead of silently reusing a dead one.
   */
  get isAlive() {
    return this.listening && !this.stopped;
  }

  get playerCount() {
    return this.players.filter(p => p.connected).length;
  }

  start() {
    if (this.server) return;
    this.stopped = false;
    this.endedOnce = false;
    this.listening = false;
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
    this.server.on('listening', () => {
      this.listening = true;
    });
    // `e` is not always an Error here (a bind failure can surface as a plain
    // object or string), so a bare `e.message` logged as "Server error:
    // undefined" and hid the actual cause -- usually that the previous session's
    // listener still held LAN_PORT.
    this.server.on('error', (e: any) => this.emit({ t: 'error', message: `Server error: ${e?.message || e?.code || String(e)}` }));
    this.server.listen({ port: LAN_PORT, host: '0.0.0.0' });
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.endedOnce = false;
    this.listening = false;
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
    this.lobbyOpen = false;
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
    // Close the listener once the `end` message has had a moment to flush.
    // Without this the server kept holding LAN_PORT after a host-ended game (or
    // any game where not every player submitted a result, so `applyResult`'s
    // self-stop never ran), and the next session failed to bind.
    setTimeout(() => this.stop(), 800);
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
      // Re-send state a reconnecting client would otherwise miss: the current
      // mode (so its card is tinted/locked correctly) and, if the host has
      // already started pulling everyone in, the lobby signal itself.
      this.send(conn, { t: 'mode', teamMode: this.teamMode });
      if (this.lobbyOpen) {
        this.send(conn, { t: 'lobby', teamMode: this.teamMode, topic: this.quiz?.title });
      }
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
    if (msg.t === 'advance') {
      this.recordAdvance(conn.id, msg.index);
      return;
    }
    if (msg.t === 'leader-answer') {
      this.recordLeaderAnswer(conn.id, msg.index, msg.answer);
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
    if (msg.t === 'react') {
      if ((REACTION_EMOJIS as readonly string[]).includes(msg.emoji)) {
        this.relayReaction(conn.id, msg.emoji);
      }
      return;
    }
    if (msg.t === 'result') {
      this.applyResult(conn, msg.data);
    }
  }

  /**
   * Deliver a cheer to the sender's own team-mates only.
   *
   * The online bar writes to a room-wide collection, but a LAN classroom cheer
   * is meant for the team, so the host scopes delivery by team id: a rival team
   * never sees it. A player with no team (classic, or an unseated spectator)
   * cheers to themselves only -- there is no team to broadcast to.
   */
  private relayReaction(playerId: string, emoji: string) {
    const sender = this.players.find(p => p.id === playerId);
    if (!sender) return;
    const teamId = sender.teamId != null ? String(sender.teamId) : '';
    const reaction: LanMessage = {
      t: 'reaction',
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      emoji,
      playerId: sender.id,
      displayName: sender.name,
      teamId: teamId || null,
      at: Date.now(),
    };
    this.connections.forEach(conn => {
      if (conn.id === sender.id) {
        this.send(conn, reaction);
        return;
      }
      if (!teamId) return;
      const p = this.players.find(x => x.id === conn.id);
      if (p && String(p.teamId ?? '') === teamId) this.send(conn, reaction);
    });
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
      this.broadcast({ t: 'end', reason: 'All players have finished' });
    }
  }

  /**
   * Prepare the SAME server for another round after a finished game.
   *
   * The server is deliberately NOT stopped when a game ends: the host's results
   * screen offers "Play Again", which resets the running game in place and
   * broadcasts `rematch` so every client returns to the lobby with the same
   * room, players and teams -- the LAN twin of the online group rematch. This
   * is why `applyResult` no longer self-stops. The socket is still released the
   * normal way: leaving the results screen (resetLanState) or focusing the Play
   * tab tears the host down.
   */
  resetForRematch() {
    if (this.stopped) return;
    this.started = false;
    this.endedOnce = false;
    this.lobbyOpen = false;
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
    // Keep everyone connected but release the seats, exactly like the online
    // rematch: round two starts on the Play tab where the host re-picks the mode
    // and students re-pick teams, so a stale seat would lock the wrong board in.
    this.players.forEach(p => {
      p.finished = false;
      p.score = 0;
      p.correctCount = 0;
      p.answeredCount = 0;
      p.totalQuestions = 0;
      p.answers = undefined;
      p.teamId = undefined;
    });
    this.teams.forEach(t => {
      t.score = 0;
      t.correctCount = 0;
      t.answeredCount = 0;
      t.teamCorrect = 0;
      t.teamStreak = 0;
      t.bestStreak = 0;
      t.memberCount = 0;
      t.powerups = emptyPowerupPool();
    });
    // `teamMode` is kept so a joiner's card shows the mode just played; the
    // `mode` rebroadcast lets the host flip it from the Play tab.
    this.broadcast({ t: 'roster', players: this.players });
    this.broadcast({ t: 'teams', teams: this.teams });
    this.broadcast({ t: 'mode', teamMode: this.teamMode });
    this.broadcast({ t: 'rematch' });
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