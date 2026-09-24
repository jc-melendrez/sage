// services/chatService.ts
import { API_BASE_URL } from '@/config/api';

export interface GroupMember {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar: string;
  role: string;
  level: number;
  firebase_uid: string;
  is_admin: boolean;
  is_you: boolean;
}

export interface JoinRequestMember {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  role: string;
  level: number;
  firebase_uid: string;
}

export interface GroupRoster {
  privacy: 'open' | 'private';
  members: GroupMember[];
  join_requests: JoinRequestMember[];
}

export interface Attachment {
  key?: string;      // S3 object key once uploaded; missing on an unsent echo
  url?: string;      // local file:// URI used only while previewing an unsent echo
  name: string;
  mime: string;
  size: number;
}

export interface LocalAttachment {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

export function safeFileName(name: string): string {
  const base = (name || 'file').split('/').pop() || 'file';
  return base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim() || 'file';
}

export async function uploadGroupAttachment(
  groupId: string,
  token: string,
  file: LocalAttachment,
): Promise<Attachment> {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mime,
  } as any);
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/attachments/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to upload file');
  }
  return res.json();
}

export async function getAttachmentLink(groupId: string, token: string, key: string): Promise<string> {
  // Encode per segment so the S3 key's slashes stay intact in the URL path.
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/attachments/${encodedKey}/link/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load attachment link');
  }
  const data = await res.json();
  return data.url;
}

export async function getGroupRoster(groupId: string, token: string): Promise<GroupRoster> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/members/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load group members');
  return res.json();
}

export async function updateGroup(
  groupId: string,
  token: string,
  data: { name?: string; description?: string; privacy?: 'open' | 'private' },
): Promise<{ id: string; name?: string; description?: string; privacy?: string }> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update group');
  }
  return res.json();
}

export async function removeGroupMember(groupId: string, token: string, firebaseUid: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/remove-member/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ firebase_uid: firebaseUid }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to remove member');
  }
}

export async function handleJoinRequest(
  groupId: string,
  token: string,
  firebaseUid: string,
  action: 'approve' | 'reject',
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/join-requests/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, firebase_uid: firebaseUid }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update request');
  }
}

export async function leaveGroup(groupId: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/leave/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to leave group');
  }
}