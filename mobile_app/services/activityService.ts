import { apiCall } from './apiClient';
import { API_BASE_URL } from '../config/api';
import { getToken } from './authService';
import { invalidateCachePrefix } from './apiCache';

export type ActivityKind = 'quiz' | 'lesson' | 'game' | 'task';
export type ActivityStatus = 'draft' | 'published';

export interface ClassActivityAttachment {
  id: number;
  activity: number;
  file_name: string;
  file_mime: string;
  file_size: number;
  created_at: string;
}

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
  max_points: number;
  created_at: string;
  submission_count?: number;
  attachments?: ClassActivityAttachment[];
}

export interface UploadFile {
  uri: string;
  name: string;
  mimeType?: string;
}

export interface CreateActivityInput {
  kind: ActivityKind;
  title: string;
  ref_id?: number | null;
  note?: string;
  due_date?: string | null;
  status?: ActivityStatus;
  max_points?: number;
  attachments?: UploadFile[];
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
  const hasAttachments = input.attachments && input.attachments.length > 0;

  if (hasAttachments) {
    const token = await getToken();
    const formData = new FormData();
    formData.append('kind', input.kind);
    formData.append('title', input.title);
    if (input.note) formData.append('note', input.note);
    if (input.due_date) formData.append('due_date', input.due_date);
    if (input.status) formData.append('status', input.status);
    if (input.max_points !== undefined) formData.append('max_points', String(input.max_points));

    for (const file of input.attachments!) {
      formData.append('attachments', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/octet-stream',
      } as any);
    }

    const response = await fetch(`${API_BASE_URL}/users/courses/${courseId}/activities/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create activity');
    invalidateCachePrefix('/activities');
    return data as ClassActivity;
  }

  return apiCall<ClassActivity>(`/users/courses/${courseId}/activities/`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((created) => {
    invalidateCachePrefix('/activities');
    return created;
  });
}

export async function updateActivity(
  activityId: number,
  input: Partial<CreateActivityInput>,
): Promise<ClassActivity> {
  return apiCall<ClassActivity>(`/users/activities/${activityId}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((updated) => {
    invalidateCachePrefix('/activities');
    return updated;
  });
}

export async function deleteActivity(activityId: number): Promise<void> {
  const token = await getToken();
  const response = await fetch(`${API_BASE_URL}/users/activities/${activityId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  invalidateCachePrefix('/activities');
  if (!response.ok && response.status !== 204) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete activity');
  }
}

export async function getTaskAttachment(
  activityId: number,
  attachmentId: number,
): Promise<ClassActivityAttachment & { file_data: string }> {
  return apiCall<ClassActivityAttachment & { file_data: string }>(
    `/users/tasks/${activityId}/attachments/${attachmentId}/`
  );
}