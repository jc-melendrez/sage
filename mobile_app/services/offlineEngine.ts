export type PowerupKey = 'freeze' | 'hint' | 'doublePoints' | 'shield';

const POWERUP_KEYS: PowerupKey[] = ['freeze', 'hint', 'doublePoints', 'shield'];

/** A powerup is guaranteed on every Nth consecutive correct answer. */
export const STREAK_REWARD_INTERVAL = 3;

export interface GameQuestion {
  type: 'mcq' | 'identification';
  question: string;
  choices?: string[];
  correctAnswer: string;
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
}

const LETTERS = ['A', 'B', 'C', 'D'];

export function buildQuestions(quiz: QuizPayload): GameQuestion[] {
  const out: GameQuestion[] = [];
  for (const q of quiz.questions ?? []) {
    if (!q || !q.question_text) continue;
    const opts = Array.isArray(q.options) && q.options.length > 0 ? q.options : [];
    if (opts.length > 0) {
      const choices = opts.map((opt, i) => `${LETTERS[i]}. ${opt}`);
      let correctIdx = -1;
      opts.forEach((opt, i) => {
        if (String(opt).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase()) {
          correctIdx = i;
        }
      });
      out.push({
        type: 'mcq',
        question: q.question_text,
        choices,
        correctAnswer: choices[correctIdx >= 0 ? correctIdx : 0],
      });
    } else {
      out.push({
        type: 'identification',
        question: q.question_text,
        correctAnswer: String(q.correct_answer || ''),
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

  answer(questionIndex: number, answer: string, timeTaken: number, flags: AnswerFlags = {}): AnswerOutcome {
    const cached = this.lastResults[questionIndex];
    if (cached) return cached;

    const question = this.questions[questionIndex];
    if (!question) throw new Error('Invalid question index');

    const isCorrect = question.type === 'identification'
      ? answer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
      : answer === question.correctAnswer;

    this.answeredCount += 1;

    if (isCorrect) {
      this.correctCount += 1;
      const base = Math.floor(1000 * (1 - (timeTaken / this.timePerQuestion) * 0.5));
      const earned = flags.useDoublePoints ? Math.max(base, 500) * 2 : Math.max(base, 500);
      const newStreak = this.streak + 1;
      this.streak = newStreak;
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
      };
      this.lastResults[questionIndex] = outcome;
      return outcome;
    }

    if (!flags.useShield) this.streak = 0;
    const outcome: AnswerOutcome = {
      correct: false,
      correctAnswer: question.correctAnswer,
      pointsAwarded: 0,
      powerupEarned: null,
      newStreak: this.streak,
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