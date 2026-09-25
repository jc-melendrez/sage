import { apiCall } from './apiClient';
import { API_BASE_URL } from '../config/api';
import { getToken } from './authService';
import { invalidateCachePrefix } from './apiCache';

export interface QuizQuestion {
  id: number;
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
}

export interface Quiz {
  id: number;
  title: string;
  quiz_type: string;
  course: number | null;
  created_at: string;
  /** ISO datetime deadline — quiz can't be taken after this. null = always open. */
  available_until?: string | null;
  questions: QuizQuestion[];
  /** Number of times the current user has attempted this quiz. */
  attempt_count?: number;
  /** Distinct learners who opened this quiz. Educators only, else null. */
  class_attempted_count?: number | null;
  /** Mean of each learner's best score, 0-100. Educators only, else null. */
  class_average_percent?: number | null;
}

/** One learner's result for a quiz, as an educator reviews it. */
export interface QuizAttemptRow {
  student_id: number;
  student_name: string;
  /** How many times this learner opened the quiz. */
  attempts: number;
  /** Whether the learner's most recent attempt was submitted. */
  completed: boolean;
  best_score: number | null;
  best_total: number | null;
  best_percent: number | null;
  last_score: number | null;
  last_total: number | null;
  last_score_percent: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface QuizAttemptMonitor {
  quiz: {
    id: number;
    title: string;
    quiz_type: string;
    question_count: number;
    available_until: string | null;
  };
  /** Learners enrolled in the quiz's class (the denominator). */
  student_count: number;
  attempted_count: number;
  completed_count: number;
  average_percent: number | null;
  attempts: QuizAttemptRow[];
}

export interface QuizShareData {
  id: number;
  title: string;
  question_count: number;
  quiz_type: string;
  deep_link: string;
}

/** Parse a "YYYY-MM-DD HH:MM" string into a Date, or null if invalid/empty. */
export function parseDeadlineInput(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

export interface GenerateQuizInput {
  /** Base64-encoded study material file ({ name, data }) */
  file?: { name: string; data: string };
  /** Raw text material (alternative to file) */
  content?: string;
  difficulty?: string;
  count?: number;
  type?: string;
  instructions?: string;
  /** Optional class to attach the generated quiz to */
  course?: number;
  /** Optional ISO datetime deadline after which the quiz is closed. */
  available_until?: string | null;
}

/** List the caller's quizzes, optionally scoped to a class. */
export async function getQuizzes(courseId?: number): Promise<Quiz[]> {
  return apiCall<Quiz[]>(courseId != null ? `/ai/quizzes/?course=${courseId}` : '/ai/quizzes/');
}

export async function getQuiz(quizId: number): Promise<Quiz> {
  return apiCall<Quiz>(`/ai/quizzes/${quizId}/`);
}

/** Get shareable data for a quiz (title, question count, deep link). */
export async function getQuizShare(quizId: number): Promise<QuizShareData> {
  return apiCall<QuizShareData>(`/ai/quizzes/${quizId}/share/`);
}

/** Generate a quiz from a file (base64 JSON body) and optionally attach it to a class. */
export async function generateQuiz(input: GenerateQuizInput): Promise<Quiz> {
  const token = await getToken();
  const response = await fetch(`${API_BASE_URL}/ai/generate-quiz/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to generate quiz');
  invalidateCachePrefix('/ai/quizzes');
  return data as Quiz;
}

/** Record a quiz attempt. Unlimited retries allowed. */
export async function startQuizAttempt(quizId: number): Promise<void> {
  await apiCall<{ id: number }>(`/ai/quizzes/${quizId}/attempts/`, {
    method: 'POST',
    body: JSON.stringify({}),
    noCache: true,
  });
}

/**
 * Educator monitoring: who attempted a quiz and how they scored.
 * 404s for anyone who is not the quiz author or the class educator.
 */
export async function getQuizAttempts(quizId: number): Promise<QuizAttemptMonitor> {
  return apiCall<QuizAttemptMonitor>(`/ai/quizzes/${quizId}/attempts/`, { noCache: true });
}

export async function updateQuiz(
  quizId: number,
  data: { title?: string; questions?: Partial<QuizQuestion>[]; available_until?: string | null },
): Promise<Quiz> {
  const quiz = await apiCall<Quiz>(`/ai/quizzes/${quizId}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  invalidateCachePrefix('/ai/quizzes');
  return quiz;
}

export async function deleteQuiz(quizId: number): Promise<void> {
  const token = await getToken();
  const response = await fetch(`${API_BASE_URL}/ai/quizzes/${quizId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 204) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete quiz');
  }
  invalidateCachePrefix('/ai/quizzes');
}