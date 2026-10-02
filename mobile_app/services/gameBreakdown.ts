/**
 * End-of-session breakdown, shared by online rooms, offline practice and LAN
 * games.
 *
 * All three modes can describe the same session -- who got what right, which
 * question the room found hardest, where the viewer beat or trailed the field
 * -- so the derivation lives here once and each mode only has to supply the
 * questions and the per-player answer logs. Nothing in this module touches
 * Firestore, SQLite or the LAN socket: it is a pure function of its input,
 * which is what makes the same numbers appear on every mode's results screen.
 *
 * The server is the authority on correctness (it writes the `correct` flag
 * inside the answer transaction), so nothing here re-judges an answer by
 * comparing it against the answer key.
 */

import type {
  AnswerLogEntry,
  GameQuestion,
  PlayerAnswerLog,
  PlayerEntry,
  TeamEntry,
} from '../types/game';
import { activeMembersByTeam, answerLog, teamRankValue } from '../types/game';

/** Per-question accuracy for one team, for the team-mode head-to-head bars. */
export interface TeamQuestionSlice {
  teamId: string;
  correct: number;
  answered: number;
}

export interface QuestionBreakdown {
  index: number;
  question: GameQuestion;
  /** Players who logged an answer to this question. */
  answered: number;
  correct: number;
  /** 0-100. Zero when nobody answered it. */
  accuracy: number;
  /**
   * The viewer's own outcome, or null when they did not answer. Only ever
   * populated for `myUserId` -- a peer's picked answer is deliberately never
   * surfaced here.
   */
  mine: AnswerLogEntry | null;
  /** The viewer got it right and somebody else did not. */
  aheadOfRoom: boolean;
  /** The viewer missed it and somebody else got it. */
  behindRoom: boolean;
  teams: TeamQuestionSlice[];
}

export interface SessionBreakdown {
  perQuestion: QuestionBreakdown[];
  /** Lowest room accuracy, or null when no question was answered. */
  hardestIndex: number | null;
  /** Highest room accuracy, or null when no question was answered. */
  easiestIndex: number | null;
  /** The viewer's misses, easiest to act on first. */
  missed: QuestionBreakdown[];
  /** Most accurate participant, breaking ties on score. */
  mvpId: string | null;
  roomAccuracy: number;
  /** Correct answers the viewer banked. */
  mineCorrect: number;
  mineAnswered: number;
}

export function accuracyPct(correct: number, answered: number): number {
  if (!answered) return 0;
  return Math.round((correct / answered) * 100);
}

/**
 * Convert the offline/LAN engine's index-keyed outcome cache into the same
 * shape the server persists, so one breakdown can read all three modes.
 */
export function answerLogFromOutcomes(
  outcomes: Record<number, { correct: boolean; pointsAwarded?: number; picked?: string }> | null | undefined,
): PlayerAnswerLog {
  const out: PlayerAnswerLog = {};
  if (!outcomes) return out;
  for (const [key, outcome] of Object.entries(outcomes)) {
    out[String(key)] = {
      correct: !!outcome?.correct,
      points: outcome?.pointsAwarded ?? 0,
      // Keep the pick. Without it the offline/LAN review is a wall of
      // "correct" with no way to learn anything from a miss.
      picked: outcome?.picked ?? '',
    };
  }
  return out;
}

/**
 * Overlay the server's settled ranking onto the live team documents.
 *
 * `teamResults.rankScore` is the value the placement XP was paid from, so it
 * wins over anything recomputed here. That is what stops the results screen
 * from ever sorting teams in a different order to the one that was paid.
 */
export function mergeSettledRank(
  teams: TeamEntry[],
  teamResults: { teamId?: string | number; rankScore?: number; activeMembers?: number }[] | null | undefined,
): TeamEntry[] {
  if (!teamResults?.length) return teams;
  const byId = new Map<string, { rankScore?: number; activeMembers?: number }>();
  for (const r of teamResults) {
    if (r?.teamId == null) continue;
    byId.set(String(r.teamId), r);
  }
  if (!byId.size) return teams;
  return teams.map(team => {
    const settled = byId.get(String(team.id));
    if (!settled) return team;
    return {
      ...team,
      rankScore: settled.rankScore ?? team.rankScore,
      activeMembers: settled.activeMembers ?? team.activeMembers,
    };
  });
}

/** Teams ordered for a results screen: settled rank, else live average. */
export function orderTeamsForResults(
  teams: TeamEntry[],
  players: Pick<PlayerEntry, 'teamId' | 'answeredCount'>[],
): TeamEntry[] {
  const active = activeMembersByTeam(players);
  // No override when the server has settled a rankScore. Passing one anyway
  // would silently discard the number the placement XP was paid from and re-sort
  // on a different value -- the exact disagreement this module exists to
  // prevent. Only an unsettled room falls back to counting active members here.
  const rank = (t: TeamEntry) =>
    teamRankValue(t, typeof t.rankScore === 'number' ? undefined : active[String(t.id)] ?? 0);
  return [...teams].sort((a, b) => rank(b) - rank(a));
}

/**
 * Build the full breakdown. `questions` is the room's (or quiz's) question list
 * and `players` is everyone who was in the session, each carrying whatever
 * answer log its mode recorded.
 */
export function buildBreakdown(input: {
  questions: GameQuestion[];
  players: PlayerEntry[];
  myUserId?: string | null;
}): SessionBreakdown {
  const { questions = [], players = [], myUserId = null } = input;
  const myId = myUserId != null ? String(myUserId) : null;

  // One pass over the logs instead of re-scanning the roster per question.
  const logs = players.map(p => ({ player: p, log: answerLog(p) }));
  const teamIds: string[] = [];
  for (const { player } of logs) {
    if (player.teamId == null || player.teamId === '') continue;
    const key = String(player.teamId);
    if (!teamIds.includes(key)) teamIds.push(key);
  }

  const perQuestion: QuestionBreakdown[] = questions.map((question, index) => {
    const key = String(index);
    let answered = 0;
    let correct = 0;
    let mine: AnswerLogEntry | null = null;
    // Rebuilt per question on purpose. Room accuracy and the team head-to-head
    // both mean "how did people do on THIS one", so these counters must not
    // carry over from question to question.
    const slices = new Map<string, TeamQuestionSlice>(
      teamIds.map(id => [id, { teamId: id, correct: 0, answered: 0 }]),
    );

    for (const { player, log } of logs) {
      const entry = log[key];
      if (!entry) continue;
      answered += 1;
      if (entry.correct) correct += 1;
      if (myId != null && String(player.id) === myId) {
        mine = entry;
      }
      const teamKey = player.teamId == null || player.teamId === '' ? null : String(player.teamId);
      const slice = teamKey != null ? slices.get(teamKey) : null;
      if (slice) {
        slice.answered += 1;
        if (entry.correct) slice.correct += 1;
      }
    }

    return {
      index,
      question,
      answered,
      correct,
      accuracy: accuracyPct(correct, answered),
      mine,
      aheadOfRoom: !!mine?.correct && correct < answered,
      behindRoom: !!mine && !mine.correct && correct > 0,
      teams: teamIds.map(id => ({ ...slices.get(id)! })),
    };
  });

  const seen = perQuestion.filter(q => q.answered > 0);
  const hardest = seen.length
    ? seen.reduce((worst, q) => (q.accuracy < worst.accuracy ? q : worst), seen[0])
    : null;
  const easiest = seen.length
    ? seen.reduce((best, q) => (q.accuracy > best.accuracy ? q : best), seen[0])
    : null;

  let mvpId: string | null = null;
  let mvpAccuracy = -1;
  let mvpScore = -1;
  for (const p of players) {
    if ((p.answeredCount ?? 0) <= 0) continue;
    const pct = accuracyPct(p.correctCount ?? 0, p.answeredCount ?? 0);
    const score = p.score ?? 0;
    if (pct > mvpAccuracy || (pct === mvpAccuracy && score > mvpScore)) {
      mvpId = String(p.id);
      mvpAccuracy = pct;
      mvpScore = score;
    }
  }

  const totalAnswered = perQuestion.reduce((sum, q) => sum + q.answered, 0);
  const totalCorrect = perQuestion.reduce((sum, q) => sum + q.correct, 0);
  const mineAnswered = perQuestion.filter(q => q.mine != null).length;
  const mineCorrect = perQuestion.filter(q => q.mine?.correct).length;

  return {
    perQuestion,
    hardestIndex: hardest?.index ?? null,
    easiestIndex: easiest?.index ?? null,
    // Hardest first: the question the room found hardest is the one most worth
    // revisiting, so it leads the review list.
    missed: perQuestion
      .filter(q => q.mine != null && !q.mine.correct)
      .sort((a, b) => a.accuracy - b.accuracy),
    mvpId,
    roomAccuracy: accuracyPct(totalCorrect, totalAnswered),
    mineCorrect,
    mineAnswered,
  };
}