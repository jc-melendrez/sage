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
  /** True if the current user has already taken this quiz (take-once). */
  attempted?: boolean;
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

/** Record the one-and-only "take" of a quiz. Server-side take-once + deadline gate.
 *  Throws when the quiz was already taken (or its deadline passed). */
export async function startQuizAttempt(quizId: number): Promise<void> {
  await apiCall<{ id: number }>(`/ai/quizzes/${quizId}/attempts/`, {
    method: 'POST',
    body: JSON.stringify({}),
    noCache: true,
  });
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