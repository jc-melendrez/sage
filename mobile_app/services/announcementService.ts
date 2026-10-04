import { apiCall } from './apiClient';
import { invalidateCachePrefix } from './apiCache';

export interface AnnouncementAuthor {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  role?: string;
}

export interface Announcement {
  id: number;
  author: AnnouncementAuthor | null;
  title: string;
  message: string;
  is_scheduled: boolean;
  /** ISO timestamp. Set only while `is_scheduled`. */
  scheduled_at: string | null;
  published_at: string;
  courses: number[];
  course_names: string[];
  /** Distinct students across every targeted class. */
  recipient_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAnnouncementInput {
  message: string;
  title?: string;
  course_ids: number[];
  is_scheduled?: boolean;
  /** ISO timestamp. Required by the API when `is_scheduled`. */
  scheduled_at?: string | null;
}

export async function getAnnouncements(): Promise<Announcement[]> {
  return apiCall<Announcement[]>('/users/announcements/');
}

export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  const created = await apiCall<Announcement>('/users/announcements/create/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  // The history list re-reads straight after sending, so it must not be
  // answered from the pre-send cached copy.
  invalidateCachePrefix('/users/announcements');
  return created;
}

/** True while a scheduled announcement is still waiting for its moment. */
export function isPending(announcement: Announcement, now: number = Date.now()): boolean {
  return (
    announcement.is_scheduled &&
    !!announcement.scheduled_at &&
    new Date(announcement.scheduled_at).getTime() > now
  );
}

/** "2h ago" for sent, "Scheduled for Fri 18 Jul" while still pending. */
export function formatAnnouncementTime(announcement: Announcement, now: number = Date.now()): string {
  if (isPending(announcement, now)) {
    return `Scheduled for ${formatDate(announcement.scheduled_at!)}`;
  }
  return relativeTime(announcement.published_at || announcement.created_at, now);
}

function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The recipient line on a history row: one class, a couple of classes, or a
 * count when the audience is large enough that naming them all is noise.
 */
export function formatAudience(announcement: Announcement): string {
  const names = announcement.course_names ?? [];
  if (names.length === 0) {
    return announcement.recipient_count === 1 ? '1 student' : `${announcement.recipient_count} students`;
  }
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(' & ');
  return `${names[0]} +${names.length - 1} more`;
}