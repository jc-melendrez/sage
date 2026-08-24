import * as SQLite from 'expo-sqlite';
import {
  CardState,
  Rating,
  RATINGS,
  gradeCard,
  isDue,
  maturityOf,
  newCardState,
} from './srs';

const db = SQLite.openDatabaseSync('sage_flashcards.db');

export interface Deck {
  id: number;
  name: string;
  subject: string;
  color: string;
  source_quiz_id: number | null;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface Card {
  id: number;
  deck_id: number;
  front: string;
  back: string;
  explanation: string;
  position: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface ReviewLog {
  id: number;
  card_id: number;
  deck_id: number;
  rating: Rating;
  reviewed_at: string;
}

export interface CardEntry {
  card: Card;
  state: CardState;
}

export interface DeckSummary {
  total: number;
  newCount: number;
  learningCount: number;
  matureCount: number;
  dueCount: number;
}

export interface CardSearchMatch {
  deckId: number;
  deckName: string;
  deckColor: string;
  cards: Card[];
}

export function initFlashcardDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT DEFAULT '',
      color TEXT DEFAULT '#7F77DD',
      source_quiz_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      position INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS card_state (
      card_id INTEGER PRIMARY KEY,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      interval_days REAL DEFAULT 0,
      ease REAL DEFAULT 2.5,
      due TEXT NOT NULL,
      state TEXT DEFAULT 'new',
      last_review TEXT
    );
    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      rating TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards (deck_id);
    CREATE INDEX IF NOT EXISTS idx_log_card ON review_log (card_id);
    CREATE INDEX IF NOT EXISTS idx_log_deck ON review_log (deck_id);
    CREATE INDEX IF NOT EXISTS idx_log_date ON review_log (reviewed_at);
  `);
}

const nowIso = () => new Date().toISOString();

// ---------- Decks ----------

export function getDecks(): Deck[] {
  return db
    .getAllSync<Deck>('SELECT * FROM decks WHERE deleted = 0 ORDER BY updated_at DESC')
    .map((d) => ({ ...d, source_quiz_id: d.source_quiz_id ?? null }));
}

export function getDeck(id: number): Deck | null {
  return db.getFirstSync<Deck>('SELECT * FROM decks WHERE id = ? AND deleted = 0', [id]) ?? null;
}

export function createDeck(
  name: string,
  opts?: { subject?: string; color?: string; sourceQuizId?: number | null }
): Deck {
  const ts = nowIso();
  const subject = opts?.subject ?? '';
  const color = opts?.color ?? '#7F77DD';
  const sourceQuizId = opts?.sourceQuizId ?? null;
  db.runSync(
    `INSERT INTO decks (name, subject, color, source_quiz_id, created_at, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [name, subject, color, sourceQuizId, ts, ts]
  );
  const id = db.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
  return { id, name, subject, color, source_quiz_id: sourceQuizId, created_at: ts, updated_at: ts, deleted: 0 };
}

export function updateDeck(id: number, fields: { name?: string; subject?: string; color?: string }): void {
  const ts = nowIso();
  const deck = getDeck(id);
  if (!deck) return;
  const name = fields.name ?? deck.name;
  const subject = fields.subject ?? deck.subject;
  const color = fields.color ?? deck.color;
  db.runSync('UPDATE decks SET name = ?, subject = ?, color = ?, updated_at = ? WHERE id = ?', [
    name,
    subject,
    color,
    ts,
    id,
  ]);
}

export function deleteDeck(id: number): void {
  const ts = nowIso();
  db.runSync('UPDATE decks SET deleted = 1, updated_at = ? WHERE id = ?', [ts, id]);
  const cards = getCards(id);
  for (const card of cards) {
    db.runSync('DELETE FROM card_state WHERE card_id = ?', [card.id]);
  }
  db.runSync('DELETE FROM review_log WHERE deck_id = ?', [id]);
}

// ---------- Cards ----------

export function getCards(deckId: number): Card[] {
  return db
    .getAllSync<Card>('SELECT * FROM cards WHERE deck_id = ? AND deleted = 0 ORDER BY position, id', [deckId])
    .map((c) => ({ ...c, explanation: c.explanation ?? '' }));
}

export function getCard(id: number): Card | null {
  return db.getFirstSync<Card>('SELECT * FROM cards WHERE id = ? AND deleted = 0', [id]) ?? null;
}

export function addCard(deckId: number, front: string, back: string, explanation = ''): Card {
  const ts = nowIso();
  const pos = (db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM cards WHERE deck_id = ?', [deckId])?.n ?? 0) + 1;
  db.runSync(
    `INSERT INTO cards (deck_id, front, back, explanation, position, created_at, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [deckId, front, back, explanation, pos, ts, ts]
  );
  const id = db.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
  db.runSync('UPDATE decks SET updated_at = ? WHERE id = ?', [ts, deckId]);
  return { id, deck_id: deckId, front, back, explanation, position: pos, created_at: ts, updated_at: ts, deleted: 0 };
}

export function updateCard(
  id: number,
  fields: { front?: string; back?: string; explanation?: string }
): void {
  const ts = nowIso();
  const card = getCard(id);
  if (!card) return;
  const front = fields.front ?? card.front;
  const back = fields.back ?? card.back;
  const explanation = fields.explanation ?? card.explanation;
  db.runSync('UPDATE cards SET front = ?, back = ?, explanation = ?, updated_at = ? WHERE id = ?', [
    front,
    back,
    explanation,
    ts,
    id,
  ]);
  db.runSync('UPDATE decks SET updated_at = ? WHERE id = ?', [ts, card.deck_id]);
}

export function deleteCard(id: number): void {
  const ts = nowIso();
  const card = getCard(id);
  db.runSync('UPDATE cards SET deleted = 1, updated_at = ? WHERE id = ?', [ts, id]);
  db.runSync('DELETE FROM card_state WHERE card_id = ?', [id]);
  if (card) db.runSync('UPDATE decks SET updated_at = ? WHERE id = ?', [ts, card.deck_id]);
}

export interface CardEntryInput {
  front: string;
  back: string;
  explanation?: string;
}

export function addCardsBulk(deckId: number, entries: CardEntryInput[]): number {
  let count = 0;
  for (const entry of entries) {
    if (!entry.front.trim() || !entry.back.trim()) continue;
    addCard(deckId, entry.front.trim(), entry.back.trim(), (entry.explanation ?? '').trim());
    count += 1;
  }
  return count;
}

export function parseBulkInput(text: string): CardEntryInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data) ? data : data.cards ?? [];
      return list
        .map((c: any) => ({
          front: String(c.front ?? c.question ?? ''),
          back: String(c.back ?? c.answer ?? ''),
          explanation: c.explanation ? String(c.explanation) : undefined,
        }))
        .filter((c: CardEntryInput) => c.front.trim() && c.back.trim());
    } catch {
      // fall through to pipe parsing
    }
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf('|');
      if (sep === -1) return { front: line, back: '' };
      return { front: line.slice(0, sep).trim(), back: line.slice(sep + 1).trim() };
    })
    .filter((c) => c.front && c.back);
}

// ---------- SRS state ----------

export function getCardState(cardId: number): CardState {
  const row = db.getFirstSync<any>('SELECT * FROM card_state WHERE card_id = ?', [cardId]);
  if (!row) return newCardState();
  return {
    reps: row.reps,
    lapses: row.lapses,
    intervalDays: row.interval_days,
    ease: row.ease,
    due: row.due,
    state: row.state,
    lastReview: row.last_review ?? null,
  };
}

function upsertCardState(cardId: number, state: CardState): void {
  db.runSync(
    `INSERT INTO card_state (card_id, reps, lapses, interval_days, ease, due, state, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET
       reps = excluded.reps,
       lapses = excluded.lapses,
       interval_days = excluded.interval_days,
       ease = excluded.ease,
       due = excluded.due,
       state = excluded.state,
       last_review = excluded.last_review`,
    [
      cardId,
      state.reps,
      state.lapses,
      state.intervalDays,
      state.ease,
      state.due,
      state.state,
      state.lastReview,
    ]
  );
}

export interface ReviewResult {
  reviewId: number;
  prevState: CardState;
  newState: CardState;
}

export function recordReview(
  cardId: number,
  deckId: number,
  rating: Rating,
  now: Date = new Date()
): ReviewResult {
  const prev = getCardState(cardId);
  const next = gradeCard(prev, rating, now);
  upsertCardState(cardId, next);
  db.runSync(
    'INSERT INTO review_log (card_id, deck_id, rating, reviewed_at) VALUES (?, ?, ?, ?)',
    [cardId, deckId, rating, now.toISOString()]
  );
  const reviewId = db.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
  return { reviewId, prevState: prev, newState: next };
}

export function revertReview(cardId: number, reviewId: number, prevState: CardState): void {
  upsertCardState(cardId, prevState);
  db.runSync('DELETE FROM review_log WHERE id = ?', [reviewId]);
}

export function deleteReviewLog(reviewId: number): void {
  db.runSync('DELETE FROM review_log WHERE id = ?', [reviewId]);
}

// ---------- Session queue ----------

export function buildQueue(deckId: number, opts?: { cram?: boolean; now?: Date }): CardEntry[] {
  const now = opts?.now ?? new Date();
  const cards = getCards(deckId);
  const all: CardEntry[] = cards.map((card) => ({ card, state: getCardState(card.id) }));
  if (opts?.cram) return all;
  const due = all.filter((e) => e.state.state !== 'new' && isDue(e.state, now));
  const fresh = all.filter((e) => e.state.state === 'new');
  return [...due, ...fresh];
}

export function getDeckSummary(deckId: number): DeckSummary {
  const entries = buildQueue(deckId);
  const summary: DeckSummary = { total: entries.length, newCount: 0, learningCount: 0, matureCount: 0, dueCount: 0 };
  for (const e of entries) {
    const m = maturityOf(e.state);
    if (m === 'new') summary.newCount += 1;
    else if (m === 'mature') summary.matureCount += 1;
    else summary.learningCount += 1;
    if (e.state.state !== 'new' && isDue(e.state)) summary.dueCount += 1;
  }
  return summary;
}

// ---------- Stats / streak ----------

const dayKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export function getReviewCountOn(date: Date): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM review_log WHERE substr(reviewed_at, 1, 10) = ?',
    [dayKey(date)]
  );
  return row?.n ?? 0;
}

export function getStreak(now: Date = new Date()): number {
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (getReviewCountOn(cursor) === 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (getReviewCountOn(cursor) > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function getDailyCounts(days: number, now: Date = new Date()): { day: string; count: number }[] {
  const result: { day: string; count: number }[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i);
    result.push({ day: dayKey(d), count: getReviewCountOn(d) });
  }
  return result;
}

export function getRatingTotals(): Record<Rating, number> {
  const totals: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  const rows = db.getAllSync<{ rating: string; n: number }>(
    'SELECT rating, COUNT(*) AS n FROM review_log GROUP BY rating'
  );
  for (const row of rows) {
    const r = row.rating as Rating;
    if (RATINGS.includes(r)) totals[r] = row.n;
  }
  return totals;
}

export function getTotalReviews(): number {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM review_log');
  return row?.n ?? 0;
}

// ---------- Search ----------

export function searchCards(query: string): CardSearchMatch[] {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const rows = db.getAllSync<Card>(
    `SELECT c.* FROM cards c
     JOIN decks d ON d.id = c.deck_id
     WHERE c.deleted = 0 AND d.deleted = 0
       AND (c.front LIKE ? OR c.back LIKE ? OR c.explanation LIKE ? OR d.name LIKE ? OR d.subject LIKE ?)
     ORDER BY d.updated_at DESC`,
    [like, like, like, like, like]
  );
  const grouped = new Map<number, CardSearchMatch>();
  for (const row of rows) {
    const deck = getDeck(row.deck_id);
    if (!deck) continue;
    const match = grouped.get(deck.id);
    if (match) {
      match.cards.push(row);
    } else {
      grouped.set(deck.id, {
        deckId: deck.id,
        deckName: deck.name,
        deckColor: deck.color,
        cards: [row],
      });
    }
  }
  return Array.from(grouped.values());
}

// ---------- Quiz import ----------

export interface QuizPayload {
  id: number;
  title: string;
  quiz_type?: string;
  questions?: Array<{
    id?: number;
    question_text?: string;
    correct_answer?: string;
    explanation?: string;
  }>;
}

export function importDeckFromQuiz(quiz: QuizPayload, color?: string): Deck | null {
  const questions = (quiz.questions ?? []).filter((q) => q && q.question_text);
  if (questions.length === 0) return null;
  const deck = createDeck(quiz.title || 'Imported quiz', {
    subject: quiz.quiz_type || 'Quiz',
    color: color ?? '#7F77DD',
    sourceQuizId: quiz.id,
  });
  addCardsBulk(
    deck.id,
    questions.map((q) => ({
      front: String(q.question_text),
      back: String(q.correct_answer ?? ''),
      explanation: q.explanation ? String(q.explanation) : undefined,
    }))
  );
  return deck;
}
