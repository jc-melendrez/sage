import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/educatorTheme';
import { StudentSummary } from '@/components/educator/StudentRow';

export const CLASS_LABEL = 'Period 3 · Algebra I';

export const ROSTER: StudentSummary[] = [
  { id: '1', name: 'Amara Chen', level: 12, xp: 840, nextLevelXp: 1000, streak: 14, status: 'onTrack', lastActive: 'today' },
  { id: '2', name: 'Diego Ramos', level: 9, xp: 220, nextLevelXp: 800, streak: 0, status: 'atRisk', lastActive: '6 days ago' },
  { id: '3', name: 'Priya Nair', level: 15, xp: 960, nextLevelXp: 1200, streak: 22, status: 'onTrack', lastActive: 'today' },
  { id: '4', name: 'Owen Blake', level: 7, xp: 310, nextLevelXp: 700, streak: 1, status: 'needsAttention', lastActive: '2 days ago' },
  { id: '5', name: 'Sofia Reyes', level: 11, xp: 705, nextLevelXp: 900, streak: 9, status: 'onTrack', lastActive: 'today' },
];

export interface QuizResult {
  id: string;
  title: string;
  score: number;
  date: string;
}

export interface BadgeItem {
  id: string;
  emoji: string;
  name: string;
  earned: boolean;
}

export interface TimelineEvent {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  time: string;
  color: string;
}

export interface StudentDetail {
  completionRate: number;
  studyHours: number;
  aiSessions: number;
  quizHistory: QuizResult[];
  badges: BadgeItem[];
  timeline: TimelineEvent[];
}

export const STUDENT_DETAILS: Record<string, StudentDetail> = {
  '1': {
    completionRate: 92,
    studyHours: 8.2,
    aiSessions: 15,
    quizHistory: [
      { id: 'q1', title: 'Fractions Quiz', score: 92, date: 'Jul 12' },
      { id: 'q2', title: 'Order of Operations', score: 88, date: 'Jul 8' },
      { id: 'q3', title: 'Intro to Algebra', score: 95, date: 'Jul 2' },
    ],
    badges: [
      { id: 'b1', emoji: '🔥', name: 'First Streak', earned: true },
      { id: 'b2', emoji: '📚', name: 'Bookworm', earned: true },
      { id: 'b3', emoji: '🏆', name: 'Top Scorer', earned: true },
    ],
    timeline: [
      { id: 't1', icon: 'checkmark-done' as const, text: 'Completed "Fractions Quiz" — 92%', time: 'Yesterday', color: COLORS.success },
      { id: 't2', icon: 'chatbubbles' as const, text: 'Asked AI Assistant about simplifying fractions', time: '2 days ago', color: COLORS.accent },
      { id: 't3', icon: 'flame' as const, text: 'Hit a 14-day study streak', time: '3 days ago', color: COLORS.warning },
    ],
  },
  '2': {
    completionRate: 64,
    studyHours: 11.5,
    aiSessions: 27,
    quizHistory: [
      { id: 'q1', title: 'Fractions Quiz', score: 58, date: 'Jul 12' },
      { id: 'q2', title: 'Order of Operations', score: 71, date: 'Jul 8' },
      { id: 'q3', title: 'Intro to Algebra', score: 44, date: 'Jul 2' },
    ],
    badges: [
      { id: 'b1', emoji: '🔥', name: 'First Streak', earned: true },
      { id: 'b2', emoji: '📚', name: 'Bookworm', earned: true },
      { id: 'b3', emoji: '🏆', name: 'Top Scorer', earned: false },
    ],
    timeline: [
      { id: 't1', icon: 'chatbubbles' as const, text: 'Asked AI Assistant for help on fractions', time: 'Yesterday', color: COLORS.accent },
      { id: 't2', icon: 'close-circle' as const, text: 'Scored 58% on Fractions Quiz', time: '2 days ago', color: COLORS.danger },
      { id: 't3', icon: 'time' as const, text: 'Missed daily streak check-in', time: '3 days ago', color: COLORS.warning },
    ],
  },
  '3': {
    completionRate: 98,
    studyHours: 14.2,
    aiSessions: 31,
    quizHistory: [
      { id: 'q1', title: 'Fractions Quiz', score: 100, date: 'Jul 12' },
      { id: 'q2', title: 'Order of Operations', score: 94, date: 'Jul 8' },
      { id: 'q3', title: 'Intro to Algebra', score: 96, date: 'Jul 2' },
    ],
    badges: [
      { id: 'b1', emoji: '🔥', name: 'First Streak', earned: true },
      { id: 'b2', emoji: '📚', name: 'Bookworm', earned: true },
      { id: 'b3', emoji: '🏆', name: 'Top Scorer', earned: true },
    ],
    timeline: [
      { id: 't1', icon: 'trophy' as const, text: 'Earned the "Streak Master" badge', time: 'Yesterday', color: COLORS.warning },
      { id: 't2', icon: 'checkmark-done' as const, text: 'Scored 100% on Fractions Quiz', time: '2 days ago', color: COLORS.success },
      { id: 't3', icon: 'people' as const, text: 'Led the Algebra Basics study group', time: '3 days ago', color: COLORS.purpleVibrant },
    ],
  },
  '4': {
    completionRate: 41,
    studyHours: 5.0,
    aiSessions: 8,
    quizHistory: [
      { id: 'q1', title: 'Fractions Quiz', score: 45, date: 'Jul 12' },
      { id: 'q2', title: 'Order of Operations', score: 52, date: 'Jul 8' },
      { id: 'q3', title: 'Intro to Algebra', score: 39, date: 'Jul 2' },
    ],
    badges: [
      { id: 'b1', emoji: '🔥', name: 'First Streak', earned: true },
      { id: 'b2', emoji: '📚', name: 'Bookworm', earned: false },
      { id: 'b3', emoji: '🏆', name: 'Top Scorer', earned: false },
    ],
    timeline: [
      { id: 't1', icon: 'warning' as const, text: 'Asked AI for the answer instead of working through it', time: 'Yesterday', color: COLORS.danger },
      { id: 't2', icon: 'close-circle' as const, text: 'Scored 45% on Fractions Quiz', time: '2 days ago', color: COLORS.danger },
      { id: 't3', icon: 'time' as const, text: 'Missed 2 assignments this week', time: '3 days ago', color: COLORS.warning },
    ],
  },
  '5': {
    completionRate: 88,
    studyHours: 10.4,
    aiSessions: 21,
    quizHistory: [
      { id: 'q1', title: 'Fractions Quiz', score: 90, date: 'Jul 12' },
      { id: 'q2', title: 'Order of Operations', score: 85, date: 'Jul 8' },
      { id: 'q3', title: 'Intro to Algebra', score: 91, date: 'Jul 2' },
    ],
    badges: [
      { id: 'b1', emoji: '🔥', name: 'First Streak', earned: true },
      { id: 'b2', emoji: '📚', name: 'Bookworm', earned: true },
      { id: 'b3', emoji: '🏆', name: 'Top Scorer', earned: false },
    ],
    timeline: [
      { id: 't1', icon: 'chatbubbles' as const, text: 'Practiced word problems with the AI Assistant', time: 'Yesterday', color: COLORS.accent },
      { id: 't2', icon: 'checkmark-done' as const, text: 'Scored 90% on Fractions Quiz', time: '2 days ago', color: COLORS.success },
      { id: 't3', icon: 'flame' as const, text: 'Hit a 9-day study streak', time: '3 days ago', color: COLORS.warning },
    ],
  },
};

export function getStudentDetail(id: string) {
  const summary = ROSTER.find((s) => s.id === id) ?? ROSTER[0];
  const detail = STUDENT_DETAILS[summary.id] ?? STUDENT_DETAILS[ROSTER[0].id];
  return { ...summary, ...detail };
}
