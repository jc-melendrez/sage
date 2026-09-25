import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { OfflineGame, QuizPayload, OfflineGameOptions } from './offlineEngine';

let db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase | null {
  if (Platform.OS === 'web') return null;
  if (!db) db = SQLite.openDatabaseSync('sage_offline.db');
  return db;
}

export interface OfflineGameRow {
  id: number;
  session_key: string;
  quiz_id: number | null;
  quiz_title: string;
  quiz_type: string;
  time_per_question: number;
  score: number;
  correct_count: number;
  answered_count: number;
  total_questions: number;
  completed_at: string;
  is_synced: number;
}

let currentOfflineGame: OfflineGame | null = null;

export function initOfflineGameDb() {
  const d = getDb();
  if (!d) return;
  d.execSync(`
    CREATE TABLE IF NOT EXISTS cached_quizzes (
      quiz_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offline_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL UNIQUE,
      quiz_id INTEGER,
      quiz_title TEXT,
      quiz_type TEXT,
      time_per_question INTEGER,
      score INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      answered_count INTEGER DEFAULT 0,
      total_questions INTEGER DEFAULT 0,
      completed_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );
  `);
}

export function cacheQuizzes(quizzes: QuizPayload[]): number {
  const d = getDb();
  if (!d) return 0;
  if (!Array.isArray(quizzes)) return 0;
  const now = new Date().toISOString();
  let count = 0;
  for (const quiz of quizzes) {
    if (!quiz || quiz.id == null) continue;
    d.runSync(
      `INSERT INTO cached_quizzes (quiz_id, data, cached_at) VALUES (?, ?, ?)
       ON CONFLICT(quiz_id) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at`,
      [quiz.id, JSON.stringify(quiz), now]
    );
    count += 1;
  }
  return count;
}

export function getCachedQuizzes(): QuizPayload[] {
  const d = getDb();
  if (!d) return [];
  const rows = d.getAllSync<{ data: string }>(
    'SELECT data FROM cached_quizzes ORDER BY cached_at DESC'
  );
  const out: QuizPayload[] = [];
  for (const row of rows) {
    try {
      const quiz = JSON.parse(row.data);
      if (quiz && quiz.id != null) out.push(quiz);
    } catch {
    }
  }
  return out;
}

export function getCachedQuiz(quizId: number): QuizPayload | null {
  const d = getDb();
  if (!d) return null;
  const row = d.getFirstSync<{ data: string }>(
    'SELECT data FROM cached_quizzes WHERE quiz_id = ?',
    [quizId]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.data) as QuizPayload;
  } catch {
    return null;
  }
}

export function clearCachedQuizzes() {
  const d = getDb();
  if (!d) return;
  d.runSync('DELETE FROM cached_quizzes');
}

export function createOfflineGame(quiz: QuizPayload, timePerQuestion: number, opts?: OfflineGameOptions): OfflineGame {
  const game = new OfflineGame(quiz, timePerQuestion, opts);
  currentOfflineGame = game;
  return game;
}

export function getCurrentOfflineGame(): OfflineGame | null {
  return currentOfflineGame;
}

export function clearCurrentOfflineGame() {
  currentOfflineGame = null;
}

export function saveOfflineGameResult(game: OfflineGame): number {
  const d = getDb();
  if (!d) return 0;
  const sessionKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  d.runSync(
    `INSERT INTO offline_games (
       session_key, quiz_id, quiz_title, quiz_type, time_per_question,
       score, correct_count, answered_count, total_questions, completed_at, is_synced
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      sessionKey,
      game.quizId,
      game.quizTitle,
      game.quizType,
      game.timePerQuestion,
      game.score,
      game.correctCount,
      game.answeredCount,
      game.totalQuestions,
      new Date().toISOString(),
    ]
  );
  const id = d.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
  return id;
}

export function getPendingOfflineGames(): OfflineGameRow[] {
  const d = getDb();
  if (!d) return [];
  return d.getAllSync<OfflineGameRow>(
    'SELECT * FROM offline_games WHERE is_synced = 0 ORDER BY id'
  );
}

export function markOfflineGameSynced(id: number) {
  const d = getDb();
  if (!d) return;
  d.runSync('UPDATE offline_games SET is_synced = 1 WHERE id = ?', [id]);
}