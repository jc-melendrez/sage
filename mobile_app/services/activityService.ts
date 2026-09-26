import { apiCall, apiUpload } from './apiClient';
import { invalidateCachePrefix } from './apiCache';

export type ActivityKind = 'quiz' | 'lesson' | 'game' | 'task';
export type ActivityStatus = 'draft' | 'published';

/** Materials an educator attaches to an activity (e.g. a worksheet). */
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
  /** The assignment instructions shown to students. */
  note: string;
  /** ISO datetime, or null when there is no deadline. */
  due_date: string | null;
  status: ActivityStatus;
  max_points: number;
  allow_multiple_files: boolean;
  created_at: string;
  submission_count?: number;
  graded_count?: number;
  attachments?: ClassActivityAttachment[];
}

export interface UploadFile {
  uri: string;
  name: string;
  mimeType?: string;
  /** Byte length, when the picker reported one. Used for display only. */
  size?: number;
}

export interface CreateActivityInput {
  kind: ActivityKind;
  title: string;
  ref_id?: number | null;
  note?: string;
  due_date?: string | null;
  status?: ActivityStatus;
  max_points?: number;
  allow_multiple_files?: boolean;
  attachments?: UploadFile[];
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Build a multipart body for an activity write, including any new materials.
 *
 * `isUpdate` matters for the nullable fields: on an update a blank value is
 * the only way to say "clear this", because omitting the key would leave the
 * stored value untouched. On a create there is nothing to clear, so blanks
 * stay omitted.
 */
function activityFormData(
  input: Partial<CreateActivityInput>,
  isUpdate = false,
): FormData {
  const form = new FormData();
  const append = (key: string, value: string | number | boolean | null | undefined) => {
    if (value === undefined || value === null) {
      if (isUpdate && value === null) form.append(key, '');
      return;
    }
    form.append(key, String(value));
  };

  append('kind', input.kind);
  append('title', input.title);
  append('ref_id', input.ref_id);
  append('note', input.note);
  append('due_date', input.due_date);
  append('status', input.status);
  append('max_points', input.max_points);
  append('allow_multiple_files', input.allow_multiple_files);

  for (const file of input.attachments ?? []) {
    form.append('attachments', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  }
  return form;
}

/** Cross-class activity feed for the educator (Activities tab + dashboard). */
export async function getActivities(): Promise<ClassActivity[]> {
  return apiCall<ClassActivity[]>('/users/activities/');
}

/** Activities for a single class. */
export async function getCourseActivities(courseId: number): Promise<ClassActivity[]> {
  return apiCall<ClassActivity[]>(`/users/courses/${courseId}/activities/`);
}

/** A single activity, for the educator's view/edit screen. */
export async function getActivity(activityId: number): Promise<ClassActivity> {
  return apiCall<ClassActivity>(`/users/activities/${activityId}/`, { noCache: true });
}

export async function createActivity(
  courseId: number,
  input: CreateActivityInput,
): Promise<ClassActivity> {
  const hasAttachments = !!input.attachments && input.attachments.length > 0;

  const created = hasAttachments
    ? await apiUpload<ClassActivity>(
        `/users/courses/${courseId}/activities/`,
        activityFormData(input),
        'POST'
      )
    : await apiCall<ClassActivity>(`/users/courses/${courseId}/activities/`, {
        method: 'POST',
        body: JSON.stringify(input),
      });

  invalidateCachePrefix('/activities');
  return created;
}

/** Partial update. New materials are appended to the existing ones. */
export async function updateActivity(
  activityId: number,
  input: Partial<CreateActivityInput>,
): Promise<ClassActivity> {
  const hasAttachments = !!input.attachments && input.attachments.length > 0;

  const updated = hasAttachments
    ? await apiUpload<ClassActivity>(
        `/users/activities/${activityId}/`,
        activityFormData(input, true),
        'PATCH'
      )
    : await apiCall<ClassActivity>(`/users/activities/${activityId}/`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });

  invalidateCachePrefix('/activities');
  return updated;
}

export async function deleteActivity(activityId: number): Promise<void> {
  await apiCall<void>(`/users/activities/${activityId}/`, { method: 'DELETE' });
  invalidateCachePrefix('/activities');
}

/** Remove one material; the activity's other materials are untouched. */
export async function deleteActivityAttachment(
  activityId: number,
  attachmentId: number,
): Promise<void> {
  await apiCall<void>(`/users/tasks/${activityId}/attachments/${attachmentId}/`, {
    method: 'DELETE',
  });
  invalidateCachePrefix('/activities');
}

/** Download one material's bytes (base64), for sharing out of the app. */
export async function getTaskAttachment(
  activityId: number,
  attachmentId: number,
): Promise<ClassActivityAttachment & { file_data: string }> {
  return apiCall<ClassActivityAttachment & { file_data: string }>(
    `/users/tasks/${activityId}/attachments/${attachmentId}/`
  );
}

export { MAX_FILE_SIZE };
