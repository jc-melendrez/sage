import { apiCall } from './apiClient';
import { API_BASE_URL } from '../config/api';
import { getToken } from './authService';

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
  questions: QuizQuestion[];
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
  return data as Quiz;
}

export async function updateQuiz(
  quizId: number,
  data: { title?: string; questions?: Partial<QuizQuestion>[] },
): Promise<Quiz> {
  return apiCall<Quiz>(`/ai/quizzes/${quizId}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
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
}