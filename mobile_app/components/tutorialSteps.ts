/**
 * Step data for the guided tutorial.
 *
 * Each topic is a short tour: navigate to a screen, highlight one control,
 * read a sentence, press Proceed. `targetId` must match a ref registered with
 * `useTutorialTarget(id)` on the screen named by `route`.
 *
 * Targets are deliberately on-screen controls only. Everything behind a
 * <Modal> in this app (the quiz generator, the join dialogs) paints in its own
 * native window, above any overlay this tutorial can draw, so a step that
 * pointed inside one would highlight nothing. Those steps point at the button
 * that OPENS the dialog instead.
 */

export interface TutorialStep {
  /** Navigate before highlighting, so the target exists to be measured. */
  route?: string;
  params?: Record<string, string>;
  /** Ref id registered with `useTutorialTarget` on that screen. */
  targetId: string;
  title: string;
  body: string;
}

export interface TutorialTopic {
  key: string;
  label: string;
  icon: string;
  steps: TutorialStep[];
}

export const TUTORIAL_TOPICS: TutorialTopic[] = [
  {
    key: 'course',
    label: 'Join Course',
    icon: 'book-outline',
    steps: [
      {
        route: '/(tabs)/activities',
        params: { tab: 'lessons' },
        targetId: 'activities-join-course',
        title: 'Join a course',
        body: 'Tap “Join class” and enter the code your educator gave you. That code links your progress, quizzes and XP to their class.',
      },
      {
        targetId: 'activities-tabs',
        title: 'See your class',
        body: 'Courses, Quizzes and Groups sit right here. Assigned material shows up under Courses as soon as your educator publishes it.',
      },
    ],
  },
  {
    key: 'quiz',
    label: 'Generate Quiz',
    icon: 'rocket-outline',
    steps: [
      {
        route: '/(tabs)/activities',
        params: { tab: 'quizzes' },
        targetId: 'activities-tabs',
        title: 'Your quizzes live here',
        body: 'Switch between Courses, Quizzes and Groups with this row. Quizzes holds everything you generate or are assigned.',
      },
      {
        targetId: 'activities-fab',
        title: 'Upload material',
        body: 'Tap + and paste text or upload a file. SAGE writes the questions for you instead of you writing them.',
      },
      {
        targetId: 'activities-quiz-card',
        title: 'Pick a type and save',
        body: 'MCQ, True/False, Identification or Fill-in-the-Blank — chosen before you generate. The finished quiz lands in this list, ready to practise or share.',
      },
    ],
  },
  {
    key: 'group',
    label: 'Join Group',
    icon: 'people-outline',
    steps: [
      {
        route: '/(tabs)/activities',
        params: { tab: 'groups' },
        targetId: 'activities-join-group',
        title: 'Join a group',
        body: 'Enter the group code to connect with classmates. Codes come from whoever created the group.',
      },
      {
        targetId: 'activities-create-group',
        title: 'Chat and learn',
        body: 'Create your own group and share the code. Everyone in it can trade resources and work together in real time.',
      },
    ],
  },
  {
    key: 'game',
    label: 'Play a Game',
    icon: 'game-controller-outline',
    steps: [
      {
        route: '/(tabs)/games',
        targetId: 'game-actions',
        title: 'Host or join',
        body: 'Create a room and invite the class, or type someone else’s room code to drop straight into their game.',
      },
      {
        targetId: 'game-actions',
        title: 'Play together',
        body: 'Answer in classic mode or team mode — team play has the whole room voting on one answer. The host starts the round from here.',
      },
    ],
  },
  {
    key: 'practice',
    label: 'Practice Quizzes',
    icon: 'school-outline',
    steps: [
      {
        route: '/(tabs)/activities',
        params: { tab: 'quizzes' },
        targetId: 'activities-quiz-card',
        title: 'Find a quiz',
        body: 'Browse everything available to you and open one to practise on your own, any time.',
      },
      {
        targetId: 'activities-tabs',
        title: 'Review mistakes',
        body: 'Every question shows its explanation after you answer, so a wrong guess turns into something you remember.',
      },
    ],
  },
];

export function getTutorialTopic(key: string | null): TutorialTopic | null {
  if (!key) return null;
  return TUTORIAL_TOPICS.find((t) => t.key === key) ?? null;
}
