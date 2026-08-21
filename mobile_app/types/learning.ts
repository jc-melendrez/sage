// --- Learning Path Types (matches backend models) ---

export type NodeType = 'learn' | 'practice' | 'challenge' | 'group_activity' | 'review' | 'mastery';

export interface Topic {
  id: number;
  course: number;
  title: string;
  description: string;
  order: number;
  node_count: number;
  created_at: string;
}

export interface LearningNode {
  id: number;
  topic: number;
  node_type: NodeType;
  title: string;
  description: string;
  content_json: ContentJson;
  order: number;
  xp_reward: number;
  required_score: number;
  estimated_minutes: number;
  created_at: string;
  progress?: NodeProgress | null;
}

export interface NodeProgress {
  id: number;
  user: number;
  node: number;
  score: number;
  passed: boolean;
  completed_at: string | null;
  attempts: number;
  updated_at: string;
}

// --- Content block types for Learn nodes ---

export interface ConceptBlock {
  type: 'concept';
  icon?: string;
  title: string;
  content: string;
  visual?: string;
}

export interface ExampleBlock {
  type: 'example';
  icon?: string;
  title?: string;
  content: string;
  prompt?: string;
  expandable?: string;
}

export interface InteractionBlock {
  type: 'interaction';
  icon?: string;
  question: string;
  options: string[];
  correct_index: number;
  feedback_correct: string;
  feedback_incorrect: string;
}

export interface SummaryBlock {
  type: 'summary';
  icon?: string;
  points: string[];
}

export type LessonBlock = ConceptBlock | ExampleBlock | InteractionBlock | SummaryBlock;

// --- Content for Learn nodes ---

export interface LearnContent {
  subtitle?: string;
  estimated_minutes?: number;
  objectives?: string[];
  blocks: LessonBlock[];
}

// --- Content for Practice / Mastery nodes ---

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
}

export interface PracticeContent {
  questions: QuizQuestion[];
}

// --- Union type ---

export type ContentJson = LearnContent | PracticeContent | Record<string, never>;

// --- API response types ---

export interface CoursePathTopic {
  id: number;
  title: string;
  description: string;
  order: number;
  nodes: LearningNode[];
}

export interface NodeCompleteResponse {
  score: number;
  passed: boolean;
  attempts: number;
  xp: {
    xp: number;
    level: number;
    leveled_up: boolean;
    badges: { icon: string; name: string }[];
  } | null;
}

// --- Helpers ---

export function isLearnContent(json: ContentJson): json is LearnContent {
  return 'blocks' in json && Array.isArray((json as LearnContent).blocks);
}

export function isPracticeContent(json: ContentJson): json is PracticeContent {
  return 'questions' in json && Array.isArray((json as PracticeContent).questions);
}

export const NODE_TYPE_CONFIG: Record<NodeType, { icon: string; label: string; color: string }> = {
  learn: { icon: 'book', label: 'Learn', color: '#7C3AED' },
  practice: { icon: 'brain', label: 'Practice', color: '#3B82F6' },
  challenge: { icon: 'zap', label: 'Challenge', color: '#F59E0B' },
  group_activity: { icon: 'people', label: 'Group Activity', color: '#22D3EE' },
  review: { icon: 'refresh', label: 'Review', color: '#10B981' },
  mastery: { icon: 'trophy', label: 'Mastery', color: '#EAB308' },
};
