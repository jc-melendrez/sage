import { apiCall } from './apiClient';
import { API_BASE_URL } from '../config/api';
import { getToken } from './authService';
import { invalidateCachePrefix } from './apiCache';
import { createActivity, ActivityStatus } from './activityService';

export interface TaskSubmission {
  id: number;
  activity: number;
  student_id: number;
  student_name: string;
  file_name: string;
  file_mime: string;
  file_size: number;
  submitted_at: string;
}

/** Full submission payload — includes file_bytes as base64. */
export interface TaskSubmissionFull extends TaskSubmission {
  file_data: string;
}

export interface CreateTaskInput {
  title: string;
  note?: string;
  due_date?: string | null;
  status?: ActivityStatus;
}

export interface UploadFile {
  uri: string;
  name: string;
  mimeType?: string;
}

/** Create a task-kind class activity (reuses the activity API). */
export async function createTask(
  courseId: number,
  input: CreateTaskInput,
) {
  return createActivity(courseId, { kind: 'task', ...input });
}

/** The current student's submission for a task, or null if none exists yet. */
export async function getMySubmission(activityId: number): Promise<TaskSubmissionFull | null> {
  return apiCall<TaskSubmissionFull | null>(`/users/tasks/${activityId}/submit/`);
}

/** Educator: all student submissions for a task (metadata only). */
export async function getTaskSubmissions(activityId: number): Promise<TaskSubmission[]> {
  return apiCall<TaskSubmission[]>(`/users/tasks/${activityId}/submissions/`);
}

/** Educator: fetch one submission including the file bytes (base64). */
export async function getTaskSubmissionFile(
  activityId: number,
  submissionId: number,
): Promise<TaskSubmissionFull> {
  return apiCall<TaskSubmissionFull>(`/users/tasks/${activityId}/submissions/${submissionId}/`);
}

/** Student: upload (or replace) their submission file. */
export async function submitTask(
  activityId: number,
  file: UploadFile,
): Promise<TaskSubmissionFull> {
  const token = await getToken();
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || 'application/octet-stream',
  } as any);

  const response = await fetch(`${API_BASE_URL}/users/tasks/${activityId}/submit/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Submission failed');
  invalidateCachePrefix('/activities');
  return data as TaskSubmissionFull;
}