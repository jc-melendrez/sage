// services/generatedCoursesService.ts
// Local persistence for AI-generated lesson-courses (activities tab).
// Backend only stores scores (LessonProgress); course content lives on-device.

import * as FileSystem from 'expo-file-system/legacy';

export interface GeneratedLevel {
  level_id: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  content: string;
  quiz: {
    question: string;
    options: string[];
    correct_answer: number | string;
  }[];
  passing_score: number;
}

export interface GeneratedCourse {
  course_title: string;
  subject: string;
  user_id?: number;
  levels: GeneratedLevel[];
}

const FILE_URI = `${FileSystem.documentDirectory}sage_generated_courses.json`;

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidCourse(value: unknown): value is GeneratedCourse {
  if (!isNonNullObject(value)) return false;
  if (typeof value.course_title !== 'string') return false;
  if (!Array.isArray(value.levels)) return false;
  return value.levels.every(
    (l) => isNonNullObject(l) && typeof l.level_id === 'number' && typeof l.content === 'string' && Array.isArray(l.quiz),
  );
}

export async function loadGeneratedCourses(): Promise<GeneratedCourse[]> {
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(FILE_URI, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidCourse);
  } catch (err) {
    console.error('Failed to load generated courses:', err);
    return [];
  }
}

export async function saveGeneratedCourses(courses: GeneratedCourse[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE_URI, JSON.stringify(courses), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    console.error('Failed to save generated courses:', err);
  }
}

export async function addGeneratedCourse(course: GeneratedCourse): Promise<void> {
  const existing = await loadGeneratedCourses();
  // One course per subject+title identity; replace on regenerate
  const next = [course, ...existing.filter((c) => c.course_title !== course.course_title)];
  await saveGeneratedCourses(next);
}
