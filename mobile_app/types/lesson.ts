export interface Lesson {
  id?: number;
  user_id: number;
  title: string;
  subject: string;
  sections: Section[];
  learning_objectives: string[];
  estimated_duration: string;
  created_at?: string;
}

export interface Section {
  title: string;
  content: string;
  key_concepts: string[];
}