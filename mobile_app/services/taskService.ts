import { apiCall, apiUpload } from './apiClient';
import { invalidateCachePrefix } from './apiCache';
import { createActivity, ActivityStatus, UploadFile } from './activityService';

/** One file inside a student's turn-in. */
export interface TaskSubmissionFile {
  id: number;
  file_name: string;
  file_mime: string;
  file_size: number;
  created_at: string;
}

/** A student's turn-in: the container that carries the files and the grade. */
export interface TaskSubmission {
  id: number;
  activity: number;
  student_id: number;
  student_name: string;
  /** The student's own note to their educator. */
  description: string;
  files: TaskSubmissionFile[];
  /** True when the turn-in landed after the assignment's due date. */
  is_late: boolean;
  submitted_at: string;
  score?: number | null;
  feedback?: string;
  graded_at?: string | null;
  graded_by?: number | null;
  max_points?: number;
}

/** Adds the educator's display name, returned on the graded payload. */
export interface TaskSubmissionFull extends TaskSubmission {
  graded_by_name?: string | null;
}

export interface CreateTaskInput {
  title: string;
  note?: string;
  due_date?: string | null;
  status?: ActivityStatus;
  max_points?: number;
  allow_multiple_files?: boolean;
}

export interface GradeSubmissionInput {
  score: number | null;
  feedback?: string;
}

export { UploadFile };

/** Create a task-kind class activity (reuses the activity API). */
export async function createTask(courseId: number, input: CreateTaskInput) {
  return createActivity(courseId, { kind: 'task', ...input });
}

/** The current student's turn-in for a task, or null if they have not turned in. */
export async function getMySubmission(activityId: number): Promise<TaskSubmissionFull | null> {
  return apiCall<TaskSubmissionFull | null>(`/users/tasks/${activityId}/submit/`);
}

/** Educator: all student turn-ins for a task (metadata only, no file bytes). */
export async function getTaskSubmissions(activityId: number): Promise<TaskSubmission[]> {
  return apiCall<TaskSubmission[]>(`/users/tasks/${activityId}/submissions/`);
}

/** Educator: fetch one turn-in (still metadata only; bytes are per-file). */
export async function getTaskSubmission(
  activityId: number,
  submissionId: number,
): Promise<TaskSubmissionFull> {
  return apiCall<TaskSubmissionFull>(`/users/tasks/${activityId}/submissions/${submissionId}/`);
}

function fileBlobs(files: UploadFile[]): Blob[] {
  return files.map(
    (file) =>
      ({
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/octet-stream',
      }) as unknown as Blob
  );
}

/**
 * Student: add files to their turn-in.
 *
 * The first upload creates the turn-in and returns 201; later uploads extend
 * it and return 200, so adding a second file never discards the first.
 */
export async function submitTaskFiles(
  activityId: number,
  files: UploadFile[],
  description?: string,
): Promise<TaskSubmissionFull> {
  const formData = new FormData();
  if (description) formData.append('description', description);
  for (const blob of fileBlobs(files)) {
    formData.append('file', blob);
  }

  const submission = await apiUpload<TaskSubmissionFull>(
    `/users/tasks/${activityId}/submit/`,
    formData,
    'POST'
  );
  invalidateCachePrefix('/activities');
  return submission;
}

/** Student: back-compat wrapper for the old single-file call. */
export async function submitTask(
  activityId: number,
  file: UploadFile,
  description?: string,
): Promise<TaskSubmissionFull> {
  return submitTaskFiles(activityId, [file], description);
}

/** Student: edit the note attached to their turn-in. */
export async function updateMySubmissionNote(
  activityId: number,
  description: string,
): Promise<TaskSubmissionFull> {
  return apiCall<TaskSubmissionFull>(`/users/tasks/${activityId}/submit/`, {
    method: 'PATCH',
    body: JSON.stringify({ description }),
  });
}

/** Student: discard the whole turn-in. */
export async function deleteMySubmission(activityId: number): Promise<void> {
  await apiCall<void>(`/users/tasks/${activityId}/submit/`, { method: 'DELETE' });
  invalidateCachePrefix('/activities');
}

/** Download one submitted file's bytes (base64), for viewing/sharing. */
export async function getTaskSubmissionFile(
  activityId: number,
  fileId: number,
): Promise<TaskSubmissionFile & { file_data: string }> {
  return apiCall<TaskSubmissionFile & { file_data: string }>(
    `/users/tasks/${activityId}/submissions/files/${fileId}/`
  );
}

/**
 * Remove one file from a turn-in. When it was the last file the server also
 * clears the turn-in, so the student shows up as "not turned in" again.
 */
export async function deleteTaskSubmissionFile(
  activityId: number,
  fileId: number,
): Promise<void> {
  await apiCall<void>(`/users/tasks/${activityId}/submissions/files/${fileId}/`, {
    method: 'DELETE',
  });
  invalidateCachePrefix('/activities');
}

/** Educator: grade a turn-in. Pass `score: null` to clear the grade. */
export async function gradeTaskSubmission(
  activityId: number,
  submissionId: number,
  input: GradeSubmissionInput,
): Promise<TaskSubmissionFull> {
  const updated = await apiCall<TaskSubmissionFull>(
    `/users/tasks/${activityId}/submissions/${submissionId}/grade/`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
  invalidateCachePrefix('/activities');
  return updated;
}
