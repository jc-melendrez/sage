import { apiCall } from './apiClient';
import { API_BASE_URL } from '../config/api';
import { getToken } from './authService';

export type ActivityKind = 'quiz' | 'lesson' | 'game';
export type ActivityStatus = 'draft' | 'published';

export interface ClassActivity {
  id: number;
  course: number;
  course_name: string;
  kind: ActivityKind;
  title: string;
  ref_id: number | null;
  note: string;
  due_date: string | null;
  status: ActivityStatus;
  created_at: string;
}

export interface CreateActivityInput {
  kind: ActivityKind;
  title: string;
  ref_id?: number | null;
  note?: string;
  due_date?: string | null;
  status?: ActivityStatus;
}

/** Cross-class activity feed for the educator (Activities tab + dashboard). */
export async function getActivities(): Promise<ClassActivity[]> {
  return apiCall<ClassActivity[]>('/users/activities/');
}

/** Activities for a single class. */
export async function getCourseActivities(courseId: number): Promise<ClassActivity[]> {
  return apiCall<ClassActivity[]>(`/users/courses/${courseId}/activities/`);
}

export async function createActivity(
  courseId: number,
  input: CreateActivityInput,
): Promise<ClassActivity> {
  return apiCall<ClassActivity>(`/users/courses/${courseId}/activities/`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateActivity(
  activityId: number,
  input: Partial<CreateActivityInput>,
): Promise<ClassActivity> {
  return apiCall<ClassActivity>(`/users/activities/${activityId}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteActivity(activityId: number): Promise<void> {
  const token = await getToken();
  const response = await fetch(`${API_BASE_URL}/users/activities/${activityId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 204) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete activity');
  }
}