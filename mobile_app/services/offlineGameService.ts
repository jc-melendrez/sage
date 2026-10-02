import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { OfflineGame, QuizPayload, OfflineGameOptions } from './offlineEngine';
import { answerLogFromOutcomes } from './gameBreakdown';
import type { GameQuestion, PlayerAnswerLog } from '../types/game';

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
  /**
   * JSON PlayerAnswerLog for the session. Null on rows written before the
   * column existed, so the summary has to degrade rather than assume it.
   */
  answer_log: string | null;
  /**
   * JSON GameQuestion[] as served, including `explanation`. Stored because the
   * results screen needs the wording and the teaching text, and neither is
   * reachable from the quiz id without a network call the practice screen does
   * not otherwise make.
   */
  questions: string | null;
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
      is_synced INTEGER DEFAULT 0,
      answer_log TEXT,
      questions TEXT
    );
  `);

  // `CREATE TABLE IF NOT EXISTS` silently leaves an EXISTING table alone, so on
  // any device that already has sage_offline.db the columns above are never
  // added and the insert below would fail. Migrate them in explicitly.
  const cols = d.getAllSync<{ name: string }>('PRAGMA table_info(offline_games)');
  if (cols.length) {
    for (const name of ['answer_log', 'questions']) {
      if (!cols.some(c => c.name === name)) {
        d.execSync(`ALTER TABLE offline_games ADD COLUMN ${name} TEXT`);
      }
    }
  }
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
       score, correct_count, answered_count, total_questions, completed_at, is_synced, answer_log, questions
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
      JSON.stringify(answerLogFromOutcomes(game.outcomeLog)),
      JSON.stringify(game.questions ?? []),
    ]
  );
  const id = d.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
  return id;
}

/**
 * The questions and answers needed to render the post-game breakdown for a
 * finished offline or LAN session.
 *
 * Both fields degrade to empty rather than throwing: the row can predate the
 * columns, either can be null, and the JSON can be unreadable. A missing
 * breakdown costs the review list, not the whole results screen.
 */
export function getOfflineGameSession(id: number): {
  questions: GameQuestion[];
  answerLog: PlayerAnswerLog;
} {
  const empty = { questions: [] as GameQuestion[], answerLog: {} as PlayerAnswerLog };
  if (!Number.isFinite(id) || id <= 0) return empty;
  const d = getDb();
  if (!d) return empty;
  const row = d.getFirstSync<{ answer_log: string | null; questions: string | null }>(
    'SELECT answer_log, questions FROM offline_games WHERE id = ?',
    [id],
  );
  if (!row) return empty;
  const parse = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  return {
    questions: parse<GameQuestion[]>(row.questions, []),
    answerLog: parse<PlayerAnswerLog>(row.answer_log, {}),
  };
}

/**
 * The recorded answers for a finished offline session.
 *
 * Degrades to an empty log rather than throwing: the row can predate the
 * column, the column can be null, and the JSON can be unreadable. A missing
 * log costs the question breakdown, not the results screen.
 */
export function getOfflineGameAnswerLog(id: number): PlayerAnswerLog {
  return getOfflineGameSession(id).answerLog;
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