export type PowerupKey = 'freeze' | 'hint' | 'doublePoints' | 'shield';

const POWERUP_KEYS: PowerupKey[] = ['freeze', 'hint', 'doublePoints', 'shield'];

/** A powerup is guaranteed on every Nth consecutive correct answer. */
export const STREAK_REWARD_INTERVAL = 3;

/**
 * Question types the player types out rather than picking. Both are graded the
 * same way, so both use the same rule. Mirrors `TYPED_QUESTION_TYPES` in
 * `backend_api/core/game/views.py`.
 */
export const TYPED_QUESTION_TYPES = ['identification', 'fill_in_blank'] as const;

/**
 * Compare a typed answer to the expected one.
 *
 * Lenient about capitalisation and stray or doubled whitespace -- the things a
 * phone keyboard changes on its own -- and strict about everything else. A
 * misspelling is wrong: the question asked for a term, and quietly accepting
 * "photosynthosis" would teach the student nothing. Deliberately no fuzzy
 * matching or edit distance.
 *
 * Must stay behaviourally identical to `answer_matches` in the backend, or an
 * offline game would mark answers differently from the same answers played
 * online.
 */
export function answerMatches(given: unknown, expected: unknown): boolean {
  if (given == null || expected == null) return false;
  const norm = (value: unknown) => String(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return norm(given) === norm(expected);
}

const TYPED_TYPES = new Set(['identification', 'fill_in_blank', 'true_false']);
const CHOICE_TYPES = new Set(['mcq', 'true_false']);

export interface GameQuestion {
  type: 'mcq' | 'identification' | 'fill_in_blank' | 'true_false';
  question: string;
  choices?: string[];
  correctAnswer: string;
  explanation?: string | null;
}

export interface QuizPayload {
  id: number;
  title: string;
  quiz_type?: string;
  questions?: Array<{
    id?: number;
    question_text?: string;
    options?: string[];
    correct_answer?: string;
    explanation?: string | null;
  }>;
}

export interface AnswerFlags {
  useHint?: boolean;
  useDoublePoints?: boolean;
  useShield?: boolean;
}

export interface AnswerOutcome {
  correct: boolean;
  correctAnswer: string;
  pointsAwarded: number;
  powerupEarned: PowerupKey | null;
  newStreak: number;
  /** What the player chose, '' on a timeout. Powers the "you picked X" review. */
  picked: string;
  /** Portion of `pointsAwarded` earned by answering fast, above the 500 floor. */
  speedBonus: number;
}

const LETTERS = ['A', 'B', 'C', 'D'];

export function buildQuestions(quiz: QuizPayload): GameQuestion[] {
  const out: GameQuestion[] = [];
  const quizType = (quiz.quiz_type || '').trim().toLowerCase();
  for (const q of quiz.questions ?? []) {
    if (!q || !q.question_text) continue;
    const opts = Array.isArray(q.options) && q.options.length > 0 ? q.options : [];
    if (quizType === 'true_false') {
      const raw = opts.map(o => String(o).trim()).filter(Boolean);
      const choices = raw.length >= 2 ? raw.slice(0, 2) : ['True', 'False'];
      let correctIdx = 0;
      choices.forEach((c, i) => {
        if (answerMatches(q.correct_answer, c)) correctIdx = i;
      });
      out.push({
        type: 'true_false',
        question: q.question_text,
        choices,
        correctAnswer: choices[correctIdx],
        explanation: q.explanation ?? null,
      });
      continue;
    }
    if (quizType === 'fill-in-the-blank' || quizType === 'fill_in_blank') {
      out.push({
        type: 'fill_in_blank',
        question: q.question_text,
        correctAnswer: String(q.correct_answer || ''),
        explanation: q.explanation ?? null,
      });
      continue;
    }
    if (quizType === 'identification' || quizType === 'sa' || quizType === 'short answer') {
      out.push({
        type: 'identification',
        question: q.question_text,
        correctAnswer: String(q.correct_answer || ''),
        explanation: q.explanation ?? null,
      });
      continue;
    }
    if (opts.length > 0) {
      const choices = opts.map((opt, i) => `${LETTERS[i]}. ${opt}`);
      let correctIdx = -1;
      opts.forEach((opt, i) => {
        if (answerMatches(opt, q.correct_answer)) {
          correctIdx = i;
        }
      });
      out.push({
        type: 'mcq',
        question: q.question_text,
        choices,
        correctAnswer: choices[correctIdx >= 0 ? correctIdx : 0],
        explanation: q.explanation ?? null,
      });
    } else {
      // Same rule as the backend's `build_questions_from_quiz`: a quiz-level
      // type picks the label, and the absence of options only tells us it is a
      // typed question.
      out.push({
        type: (quiz.quiz_type || '').trim().toLowerCase() === 'fill-in-the-blank'
          ? 'fill_in_blank'
          : 'identification',
        question: q.question_text,
        correctAnswer: String(q.correct_answer || ''),
        explanation: q.explanation ?? null,
      });
    }
  }
  return out;
}

function shuffleRange(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function validOrder(order: number[] | undefined, count: number): boolean {
  if (!Array.isArray(order) || order.length !== count) return false;
  const seen = new Set<number>();
  for (const idx of order) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= count || seen.has(idx)) return false;
    seen.add(idx);
  }
  return seen.size === count;
}

export interface OfflineGameOptions {
  order?: number[];
}

/**
 * Momentum ladder: removed.
 *
 * The cumulative multiplier is gone from the backend too (see the note in
 * `backend_api/core/game/views.py`). Do not reintroduce a scoring term driven
 * by "how many right so far" -- it compounds with the streak bonus and the
 * doubled questions, so one strong start used to carry a run to the end.
 */

export class OfflineGame {
  readonly quizId: number;
  readonly quizTitle: string;
  readonly quizType: string;
  readonly timePerQuestion: number;
  readonly questions: GameQuestion[];
  readonly questionOrder: number[];
  readonly startedAt: string;
  powerups: Record<PowerupKey, number>;
  score = 0;
  streak = 0;
  correctCount = 0;
  answeredCount = 0;
  bestStreak = 0;
  private lastResults: Record<number, AnswerOutcome> = {};

  constructor(quiz: QuizPayload, timePerQuestion: number, opts: OfflineGameOptions = {}) {
    const questions = buildQuestions(quiz);
    if (questions.length === 0) throw new Error('Quiz has no valid questions');
    this.quizId = quiz.id;
    this.quizTitle = quiz.title || 'Untitled Quiz';
    this.quizType = quiz.quiz_type || '';
    this.timePerQuestion = Math.max(5, Math.round(timePerQuestion) || 15);
    this.questions = questions;
    this.questionOrder = validOrder(opts.order, questions.length) ? [...opts.order!] : shuffleRange(questions.length);
    this.startedAt = new Date().toISOString();
    this.powerups = { freeze: 0, hint: 0, doublePoints: 0, shield: 0 };
  }

  get totalQuestions(): number {
    return this.questions.length;
  }

  get isComplete(): boolean {
    return this.answeredCount >= this.totalQuestions;
  }

  /**
   * Per-question outcomes, for the end-of-session summary. Offline and LAN
   * games never reach Firestore, so this in-memory log is their only record of
   * what was answered -- copy it before clearing the game.
   */
  get outcomeLog(): Record<number, AnswerOutcome> {
    return { ...this.lastResults };
  }

  answer(questionIndex: number, answer: string, timeTaken: number, flags: AnswerFlags = {}): AnswerOutcome {
    const cached = this.lastResults[questionIndex];
    if (cached) return cached;

    const question = this.questions[questionIndex];
    if (!question) throw new Error('Invalid question index');

    const isCorrect = TYPED_TYPES.has(question.type)
      ? answerMatches(answer, question.correctAnswer)
      : answer === question.correctAnswer;

    this.answeredCount += 1;

    if (isCorrect) {
      this.correctCount += 1;
      // Mirrors the server exactly, so an offline score is the score the same
      // answers would have earned online.
      const basePoints = Math.max(Math.floor(1000 * (1 - (timeTaken / this.timePerQuestion) * 0.5)), 500);
      const speedBonus = basePoints - 500;
      const earned = flags.useDoublePoints ? basePoints * 2 : basePoints;
      const newStreak = this.streak + 1;
      this.streak = newStreak;
      this.bestStreak = Math.max(this.bestStreak, newStreak);
      this.score += earned;

      let powerupEarned: PowerupKey | null = null;
      // Guaranteed reward on every 3rd consecutive correct answer — the
      // streak itself is the reward, there is no probabilistic trigger.
      // Never on the final question: the game ends immediately after, so
      // the reward could never be used.
      if (!this.isComplete && newStreak >= STREAK_REWARD_INTERVAL && newStreak % STREAK_REWARD_INTERVAL === 0) {
        powerupEarned = this.grantPowerup();
      }

      const outcome: AnswerOutcome = {
        correct: true,
        correctAnswer: question.correctAnswer,
        pointsAwarded: earned,
        powerupEarned,
        newStreak,
        picked: answer,
        speedBonus,
      };
      this.lastResults[questionIndex] = outcome;
      return outcome;
    }

    if (!flags.useShield) {
      this.streak = 0;
    }
    const outcome: AnswerOutcome = {
      correct: false,
      correctAnswer: question.correctAnswer,
      pointsAwarded: 0,
      powerupEarned: null,
      newStreak: this.streak,
      picked: answer,
      speedBonus: 0,
    };
    this.lastResults[questionIndex] = outcome;
    return outcome;
  }

  consumePowerup(key: PowerupKey): boolean {
    if (this.powerups[key] <= 0) return false;
    this.powerups[key] -= 1;
    return true;
  }

  /**
   * Award a powerup. Unowned types are all at count 0, which is the lowest
   * count, so this single expression covers both policies: prefer a type the
   * player does not own, and once all four are held, stack onto whichever is
   * rarest. Never degrades to a points consolation.
   */
  private grantPowerup(): PowerupKey {
    const lowest = Math.min(...POWERUP_KEYS.map(k => this.powerups[k]));
    const pool = POWERUP_KEYS.filter(k => this.powerups[k] === lowest);
    const ptype = pool[Math.floor(Math.random() * pool.length)];
    this.powerups[ptype] += 1;
    return ptype;
  }
}