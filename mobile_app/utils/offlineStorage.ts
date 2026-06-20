import * as SQLite from 'expo-sqlite';

export interface QuizOption {
  id: number;
  option_text: string;
  is_correct: boolean;
}

export interface QuizQuestion {
  id: number;
  question_text: string;
  explanation: string;
  options: QuizOption[];
}

export interface LessonPart {
  id: number;
  part_number: number;
  part_title: string;
  beginner_summary: string;
  advanced_summary: string;
  questions: QuizQuestion[];
}

export interface LearningModule {
  id: number;
  title: string;
  lesson_parts: LessonPart[];
}

async function getDB() {
  return await SQLite.openDatabaseAsync('sage_offline.db');
}

export async function initializeOfflineDatabase(): Promise<void> {
  const db = await getDB();
  
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS learning_modules (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lesson_parts (
      id INTEGER PRIMARY KEY,
      module_id INTEGER NOT NULL,
      part_number INTEGER NOT NULL,
      part_title TEXT NOT NULL,
      beginner_summary TEXT NOT NULL,
      advanced_summary TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY,
      lesson_part_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      explanation TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_options (
      id INTEGER PRIMARY KEY,
      question_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      is_correct INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_part_id INTEGER NOT NULL UNIQUE,
      is_passed INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0.0,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export async function saveModuleToLocalCache(apiModuleData: LearningModule): Promise<void> {
  const db = await getDB();
  
  await db.withTransactionAsync(async () => {
    const updatedAt = new Date().toISOString();
    
    // 1. Insert/Replace learning_modules
    await db.runAsync(
      'INSERT OR REPLACE INTO learning_modules (id, title, updated_at) VALUES (?, ?, ?)',
      [apiModuleData.id, apiModuleData.title, updatedAt]
    );

    // 2. Insert/Replace lesson parts, questions, and options
    for (const part of apiModuleData.lesson_parts || []) {
      await db.runAsync(
        'INSERT OR REPLACE INTO lesson_parts (id, module_id, part_number, part_title, beginner_summary, advanced_summary) VALUES (?, ?, ?, ?, ?, ?)',
        [
          part.id,
          apiModuleData.id,
          part.part_number,
          part.part_title,
          part.beginner_summary,
          part.advanced_summary
        ]
      );

      for (const question of part.questions || []) {
        await db.runAsync(
          'INSERT OR REPLACE INTO quiz_questions (id, lesson_part_id, question_text, explanation) VALUES (?, ?, ?, ?)',
          [
            question.id,
            part.id,
            question.question_text,
            question.explanation
          ]
        );

        for (const option of question.options || []) {
          await db.runAsync(
            'INSERT OR REPLACE INTO quiz_options (id, question_id, option_text, is_correct) VALUES (?, ?, ?, ?)',
            [
              option.id,
              question.id,
              option.option_text,
              option.is_correct ? 1 : 0
            ]
          );
        }
      }
    }
  });
}

export async function getLocalModuleData(moduleId: number): Promise<LearningModule | null> {
  const db = await getDB();
  
  // 1. SELECT the learning_modules row.
  const moduleRows = await db.getAllAsync<{ id: number; title: string; updated_at: string }>(
    'SELECT * FROM learning_modules WHERE id = ?',
    [moduleId]
  );
  
  if (moduleRows.length === 0) {
    return null;
  }
  const moduleRow = moduleRows[0];

  // 2. SELECT all lesson_parts.
  const partRows = await db.getAllAsync<{
    id: number;
    module_id: number;
    part_number: number;
    part_title: string;
    beginner_summary: string;
    advanced_summary: string;
  }>(
    'SELECT * FROM lesson_parts WHERE module_id = ? ORDER BY part_number ASC',
    [moduleId]
  );

  const lesson_parts: LessonPart[] = [];

  for (const partRow of partRows) {
    // 3. SELECT quiz_questions.
    const questionRows = await db.getAllAsync<{
      id: number;
      lesson_part_id: number;
      question_text: string;
      explanation: string;
    }>(
      'SELECT * FROM quiz_questions WHERE lesson_part_id = ? ORDER BY id ASC',
      [partRow.id]
    );

    const questions: QuizQuestion[] = [];

    for (const questionRow of questionRows) {
      // 4. SELECT quiz_options.
      const optionRows = await db.getAllAsync<{
        id: number;
        question_id: number;
        option_text: string;
        is_correct: number;
      }>(
        'SELECT * FROM quiz_options WHERE question_id = ? ORDER BY id ASC',
        [questionRow.id]
      );

      const options: QuizOption[] = optionRows.map((opt) => ({
        id: opt.id,
        option_text: opt.option_text,
        is_correct: opt.is_correct === 1,
      }));

      questions.push({
        id: questionRow.id,
        question_text: questionRow.question_text,
        explanation: questionRow.explanation,
        options,
      });
    }

    lesson_parts.push({
      id: partRow.id,
      part_number: partRow.part_number,
      part_title: partRow.part_title,
      beginner_summary: partRow.beginner_summary,
      advanced_summary: partRow.advanced_summary,
      questions,
    });
  }

  // 5. Return reconstructed LearningModule
  return {
    id: moduleRow.id,
    title: moduleRow.title,
    lesson_parts,
  };
}

export async function saveQuizProgress(
  lessonPartId: number,
  isPassed: boolean,
  score: number
): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'INSERT OR REPLACE INTO quiz_progress (lesson_part_id, is_passed, score, synced) VALUES (?, ?, ?, 0)',
    [lessonPartId, isPassed ? 1 : 0, score]
  );
}
