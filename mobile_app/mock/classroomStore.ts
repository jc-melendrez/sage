/**
 * In-memory mock store for the Classes → Weeks → Lessons feature.
 *
 * Powers BOTH the educator UI (create/manage classes) and the student UI
 * (Duolingo-style lesson path) from a single module-level singleton, so
 * educator edits show up on the student side immediately.
 *
 * NOTE: This is intentionally mock-only (UI-first). State resets on app
 * restart. Swap these functions for API calls when the backend exists.
 */

export type QuizQuestionType = 'Multiple Choice' | 'True/False' | 'Short Answer' | 'Fill-in-the-Blank';

export interface MockQuizQuestion {
  id: number;
  question: string;
  type: QuizQuestionType;
  options?: string[];
  correct_answer?: string;
}

export type WeekUnlockMode = 'date' | 'completion' | 'both';

export interface MockLesson {
  id: string;
  title: string;
  quiz: MockQuizQuestion[];
  passingScore: number; // percent needed to pass / unlock next
  xpReward: number;
}

export interface MockWeek {
  id: string;
  title: string;
  unlockMode: WeekUnlockMode;
  unlockDate?: string; // ISO date; only used when unlockMode is 'date' or 'both'
  lessons: MockLesson[];
}

export interface MockClassroom {
  id: string;
  name: string;
  subject: string;
  color: string;
  weeks: MockWeek[];
}

/* ------------------------------------------------------------------ */
/* Seed question builders                                             */
/* ------------------------------------------------------------------ */

const mc = (id: number, question: string, options: string[], correct_answer: string): MockQuizQuestion => ({
  id,
  question,
  type: 'Multiple Choice',
  options,
  correct_answer,
});

const tf = (id: number, question: string, correct_answer: string): MockQuizQuestion => ({
  id,
  question,
  type: 'True/False',
  options: ['True', 'False'],
  correct_answer,
});

/* ------------------------------------------------------------------ */
/* ID counters                                                        */
/* ------------------------------------------------------------------ */

let nextClassroomId = 100;
let nextWeekId = 1000;
let nextLessonId = 10000;

const nextClassroom = () => `${nextClassroomId++}`;
const nextWeek = () => `${nextWeekId++}`;
const nextLesson = () => `${nextLessonId++}`;

/* ------------------------------------------------------------------ */
/* Progress (in-memory per-lesson score map)                          */
/* ------------------------------------------------------------------ */

const progress: { [lessonId: string]: number } = {};

export function getProgress(): { [lessonId: string]: number } {
  return progress;
}

/* ------------------------------------------------------------------ */
/* Seeded "existing quizzes" bank (for the educator attach flow)      */
/* ------------------------------------------------------------------ */

export interface ExistingQuiz {
  id: string;
  title: string;
  questions: MockQuizQuestion[];
}

const EXISTING_QUIZZES: ExistingQuiz[] = [
  {
    id: 'eq-fractions',
    title: 'Fractions Basics',
    questions: [
      mc(1, 'What is 1/2 + 1/4?', ['3/4', '2/6', '1/6', '3/6'], '3/4'),
      mc(2, 'Which fraction equals 0.5?', ['1/3', '2/3', '1/2', '3/4'], '1/2'),
      mc(3, 'Simplify 4/8.', ['1/4', '1/2', '2/4', '3/8'], '1/2'),
      tf(4, '3/4 is greater than 2/3.', 'True'),
    ],
  },
  {
    id: 'eq-order',
    title: 'Order of Operations',
    questions: [
      mc(1, 'What is 2 + 3 × 4?', ['20', '14', '24', '12'], '14'),
      mc(2, 'What is (2 + 3) × 4?', ['20', '14', '24', '12'], '20'),
      mc(3, 'Evaluate 10 − 2².', ['6', '4', '8', '64'], '6'),
      tf(4, 'Parentheses are evaluated before exponents.', 'True'),
    ],
  },
  {
    id: 'eq-geometry',
    title: 'Intro to Geometry',
    questions: [
      mc(1, 'How many sides does a hexagon have?', ['5', '6', '7', '8'], '6'),
      mc(2, 'The sum of angles in a triangle is…', ['90°', '180°', '270°', '360°'], '180°'),
      mc(3, 'A quadrilateral has how many sides?', ['3', '4', '5', '6'], '4'),
      tf(4, 'All squares are rectangles.', 'True'),
    ],
  },
  {
    id: 'eq-algebra',
    title: 'Algebra Basics',
    questions: [
      mc(1, 'If x + 5 = 12, what is x?', ['5', '7', '12', '17'], '7'),
      mc(2, 'Solve 3x = 21.', ['5', '6', '7', '8'], '7'),
      mc(3, 'What is 2x + 3 when x = 4?', ['8', '11', '14', '24'], '11'),
      tf(4, 'x² means x multiplied by itself.', 'True'),
    ],
  },
];

export function getExistingQuizzes(): ExistingQuiz[] {
  return EXISTING_QUIZZES;
}

/* ------------------------------------------------------------------ */
/* Mock AI lesson generator                                           */
/* ------------------------------------------------------------------ */

export function generateMockQuiz(topic: string, difficulty: string): MockQuizQuestion[] {
  const d = difficulty.toLowerCase();
  const easy = d === 'easy';
  const hard = d === 'hard';

  const questions: MockQuizQuestion[] = [
    mc(1, `What is the main idea behind "${topic}"?`, ['Definitions and rules', 'Guess and check', 'Memorizing answers', 'Skipping steps'], 'Definitions and rules'),
    mc(2, `Which statement about "${topic}" is correct?`, ['It has no real-world use', 'It builds on earlier concepts', 'It is only for advanced students', 'It requires no practice'], 'It builds on earlier concepts'),
    mc(3, `A good first step when solving a "${topic}" problem is to…`, ['Identify what is given', 'Skip the question', 'Guess randomly', 'Use the answer key'], 'Identify what is given'),
    tf(4, `Practicing "${topic}" helps build strong foundations.`, 'True'),
  ];

  if (!easy) {
    questions.push(mc(5, `When applying "${topic}", you should always…`, ['Check your work', 'Never re-read', 'Ignore units', 'Work alone'], 'Check your work'));
  }
  if (hard) {
    questions.push(mc(6, `A challenge problem in "${topic}" often requires…`, ['Multiple steps', 'No thinking', 'A calculator only', 'Memorization'], 'Multiple steps'));
  }

  return questions.map((q, i) => ({ ...q, id: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Seed data                                                          */
/* ------------------------------------------------------------------ */

const week1Id = nextWeek();
const week2Id = nextWeek();
const week3Id = nextWeek();

const seedLessons = [
  { id: nextLesson(), title: 'Intro to Fractions', passingScore: 70, xpReward: 20, quiz: EXISTING_QUIZZES[0].questions },
  { id: nextLesson(), title: 'Simplifying Fractions', passingScore: 70, xpReward: 25, quiz: generateMockQuiz('Fractions', 'Medium') },
  { id: nextLesson(), title: 'Adding Fractions', passingScore: 70, xpReward: 30, quiz: generateMockQuiz('Fractions', 'Medium') },
  { id: nextLesson(), title: 'Comparing Fractions', passingScore: 70, xpReward: 30, quiz: generateMockQuiz('Fractions', 'Hard') },
  { id: nextLesson(), title: 'Fractions Checkpoint', passingScore: 80, xpReward: 50, quiz: generateMockQuiz('Fractions', 'Hard') },
];

const seedClassrooms: MockClassroom[] = [
  {
    id: nextClassroom(),
    name: 'Period 3 · Algebra I',
    subject: 'Algebra',
    color: '#7C3AED',
    weeks: [
      {
        id: week1Id,
        title: 'Week 1',
        unlockMode: 'completion',
        lessons: seedLessons,
      },
      {
        id: week2Id,
        title: 'Week 2',
        unlockMode: 'date',
        unlockDate: new Date(Date.now() - 86400000).toISOString(), // yesterday → open
        lessons: [
          { id: nextLesson(), title: 'Order of Operations Intro', passingScore: 70, xpReward: 25, quiz: EXISTING_QUIZZES[1].questions },
          { id: nextLesson(), title: 'PEMDAS Practice', passingScore: 70, xpReward: 30, quiz: generateMockQuiz('Order of Operations', 'Medium') },
          { id: nextLesson(), title: 'Parentheses First', passingScore: 75, xpReward: 35, quiz: generateMockQuiz('Order of Operations', 'Hard') },
        ],
      },
      {
        id: week3Id,
        title: 'Week 3',
        unlockMode: 'both',
        unlockDate: new Date(Date.now() + 86400000 * 3).toISOString(), // +3 days → locked
        lessons: [
          { id: nextLesson(), title: 'Intro to Geometry', passingScore: 70, xpReward: 30, quiz: EXISTING_QUIZZES[2].questions },
          { id: nextLesson(), title: 'Angles in Shapes', passingScore: 75, xpReward: 35, quiz: generateMockQuiz('Geometry', 'Medium') },
        ],
      },
    ],
  },
];

// Pre-complete the first lesson of Week 1 so the student path shows a mix
// of completed / unlocked / locked states on first load.
progress[seedClassrooms[0].weeks[0].lessons[0].id] = 90;

/* ------------------------------------------------------------------ */
/* Store CRUD                                                         */
/* ------------------------------------------------------------------ */

export function getClassrooms(): MockClassroom[] {
  return seedClassrooms;
}

export function getClassroom(id: string): MockClassroom | undefined {
  return seedClassrooms.find((c) => c.id === id);
}

export function createClassroom(input: { name: string; subject: string; color: string }): MockClassroom {
  const classroom: MockClassroom = {
    id: nextClassroom(),
    name: input.name.trim() || 'Untitled Class',
    subject: input.subject.trim() || 'General',
    color: input.color,
    weeks: [],
  };
  seedClassrooms.unshift(classroom);
  return classroom;
}

export function deleteClassroom(id: string): void {
  const idx = seedClassrooms.findIndex((c) => c.id === id);
  if (idx >= 0) seedClassrooms.splice(idx, 1);
}

export function addWeek(
  classroomId: string,
  input: { title: string; unlockMode: WeekUnlockMode; unlockDate?: string }
): MockWeek | undefined {
  const classroom = getClassroom(classroomId);
  if (!classroom) return undefined;
  const week: MockWeek = {
    id: nextWeek(),
    title: input.title.trim() || `Week ${classroom.weeks.length + 1}`,
    unlockMode: input.unlockMode,
    unlockDate: input.unlockMode === 'date' || input.unlockMode === 'both' ? input.unlockDate : undefined,
    lessons: [],
  };
  classroom.weeks.push(week);
  return week;
}

export function deleteWeek(classroomId: string, weekId: string): void {
  const classroom = getClassroom(classroomId);
  if (!classroom) return;
  classroom.weeks = classroom.weeks.filter((w) => w.id !== weekId);
}

export function addLesson(
  classroomId: string,
  weekId: string,
  input: { title: string; quiz: MockQuizQuestion[]; passingScore: number; xpReward: number }
): MockLesson | undefined {
  const classroom = getClassroom(classroomId);
  const week = classroom?.weeks.find((w) => w.id === weekId);
  if (!classroom || !week) return undefined;
  const lesson: MockLesson = {
    id: nextLesson(),
    title: input.title.trim() || 'Untitled Lesson',
    quiz: input.quiz,
    passingScore: input.passingScore,
    xpReward: input.xpReward,
  };
  week.lessons.push(lesson);
  return lesson;
}

export function deleteLesson(classroomId: string, weekId: string, lessonId: string): void {
  const classroom = getClassroom(classroomId);
  const week = classroom?.weeks.find((w) => w.id === weekId);
  if (!classroom || !week) return;
  week.lessons = week.lessons.filter((l) => l.id !== lessonId);
  delete progress[lessonId];
}

export function completeLesson(classroomId: string, weekId: string, lessonId: string, score: number): void {
  const classroom = getClassroom(classroomId);
  const lesson = classroom?.weeks.flatMap((w) => w.lessons).find((l) => l.id === lessonId);
  if (!classroom || !lesson) return;
  progress[lessonId] = Math.max(progress[lessonId] ?? 0, score);
}

/* ------------------------------------------------------------------ */
/* Unlock logic                                                       */
/* ------------------------------------------------------------------ */

export function isLessonCompleted(lesson: MockLesson): boolean {
  return (progress[lesson.id] ?? 0) >= lesson.passingScore;
}

export function isWeekUnlocked(classroom: MockClassroom, weekIndex: number): boolean {
  const week = classroom.weeks[weekIndex];
  if (!week) return false;
  if (weekIndex === 0) return true;

  const prevWeek = classroom.weeks[weekIndex - 1];
  const prevComplete =
    prevWeek.lessons.length > 0 && prevWeek.lessons.every((l) => isLessonCompleted(l));

  const datePassed = !week.unlockDate || new Date(week.unlockDate).getTime() <= Date.now();

  switch (week.unlockMode) {
    case 'date':
      return datePassed;
    case 'completion':
      return prevComplete;
    case 'both':
    default:
      return datePassed && prevComplete;
  }
}

export function isLessonUnlocked(classroom: MockClassroom, weekIndex: number, lessonIndex: number): boolean {
  if (!isWeekUnlocked(classroom, weekIndex)) return false;
  if (lessonIndex === 0) return true;
  const prev = classroom.weeks[weekIndex].lessons[lessonIndex - 1];
  return isLessonCompleted(prev);
}

export function getWeekUnlockLabel(week: MockWeek, weekIndex: number): string {
  if (weekIndex === 0) return 'Always open';
  switch (week.unlockMode) {
    case 'date':
      return week.unlockDate ? `Opens ${new Date(week.unlockDate).toLocaleDateString()}` : 'Date-based';
    case 'completion':
      return 'After previous week';
    case 'both':
    default:
      return week.unlockDate ? `After previous week + ${new Date(week.unlockDate).toLocaleDateString()}` : 'Completion + date';
  }
}
