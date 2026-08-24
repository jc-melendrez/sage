import { apiCall } from './apiClient';
import { API_BASE_URL } from '../config/api';
import { getToken } from './authService';
import { CoursePathTopic, LearningNode, NodeCompleteResponse, NodeType, ContentJson, Topic } from '@/types/learning';

export interface CourseStudent {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  level: number;
  current_xp: number;
  total_points: number;
  streak: number;
  courses_completed: number;
  study_hours: number;
  quizzes_taken: number;
  group_activities_count: number;
}

export interface CourseSummary {
  id: number;
  name: string;
  description: string | null;
  join_code: string;
  educator: {
    id: number;
    username: string;
    display_name: string;
  };
  student_count: number;
  study_group_id: number | null;
  created_at: string;
}

export interface CourseRoster extends CourseSummary {
  students: CourseStudent[];
}

export interface CreateCourseInput {
  name: string;
  description?: string;
}

export async function createCourse(input: CreateCourseInput): Promise<CourseSummary> {
  return apiCall<CourseSummary>('/users/courses/create/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getMyCourses(): Promise<CourseRoster[]> {
  return apiCall<CourseRoster[]>('/users/courses/mine/');
}

export async function getEnrolledCourses(): Promise<CourseSummary[]> {
  return apiCall<CourseSummary[]>('/users/courses/enrolled/');
}

export async function getCourse(courseId: number): Promise<CourseRoster> {
  return apiCall<CourseRoster>(`/users/courses/${courseId}/`);
}

export async function joinCourseByCode(joinCode: string): Promise<CourseRoster> {
  return apiCall<CourseRoster>('/users/courses/join/', {
    method: 'POST',
    body: JSON.stringify({ join_code: joinCode }),
  });
}

export async function addStudentToCourse(courseId: number, userId: number): Promise<CourseRoster> {
  return apiCall<CourseRoster>(`/users/courses/${courseId}/add-student/`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function removeStudentFromCourse(courseId: number, userId: number): Promise<CourseRoster> {
  return apiCall<CourseRoster>(`/users/courses/${courseId}/remove-student/`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

// --- Learning Path ---

export async function getCoursePath(courseId: number): Promise<CoursePathTopic[]> {
  return apiCall<CoursePathTopic[]>(`/users/courses/${courseId}/path/`);
}

export async function getNode(nodeId: number): Promise<LearningNode> {
  return apiCall<LearningNode>(`/users/nodes/${nodeId}/`);
}

export async function completeNode(nodeId: number, score: number): Promise<NodeCompleteResponse> {
  return apiCall<NodeCompleteResponse>(`/users/nodes/${nodeId}/complete/`, {
    method: 'POST',
    body: JSON.stringify({ score }),
  });
}

export async function createTopic(courseId: number, data: { title: string; description?: string; order: number }): Promise<Topic> {
  return apiCall<Topic>(`/users/courses/${courseId}/topics/create/`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createNode(topicId: number, data: {
  node_type: NodeType;
  title: string;
  description?: string;
  content_json: ContentJson;
  order: number;
  xp_reward?: number;
  required_score?: number;
  estimated_minutes?: number;
}): Promise<LearningNode> {
  return apiCall<LearningNode>(`/users/topics/${topicId}/nodes/create/`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface GenerateTopicResponse {
  title: string;
  description: string;
  nodes: {
    node_type: NodeType;
    title: string;
    description: string;
    content_json: ContentJson;
    xp_reward: number;
    required_score: number;
    estimated_minutes: number;
  }[];
}

export async function generateTopic(
  courseId: number,
  file: { uri: string; name: string; mimeType?: string },
  options?: { instructions?: string; difficulty?: string; node_count?: number },
): Promise<GenerateTopicResponse> {
  const token = await getToken();
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || 'application/pdf',
  } as any);
  if (options?.instructions) formData.append('instructions', options.instructions);
  if (options?.difficulty) formData.append('difficulty', options.difficulty);
  if (options?.node_count) formData.append('node_count', String(options.node_count));

  const response = await fetch(`${API_BASE_URL}/users/courses/${courseId}/generate-topic/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Generation failed');
  return data as GenerateTopicResponse;
}
