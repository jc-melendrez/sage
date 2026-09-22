// services/chatService.ts
import firestore from '@react-native-firebase/firestore';
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

export function subscribeToGroupMessages(groupId: string, callback: (msgs: any[]) => void) {
  return firestore()
    .collection('studyGroups')
    .doc(groupId)
    .collection('messages')
    .orderBy('created_at', 'asc')
    .onSnapshot(snapshot => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      callback(messages);
    });
}

export async function sendMessage(groupId: string, senderUid: string, text: string) {
  await firestore()
    .collection('studyGroups')
    .doc(groupId)
    .collection('messages')
    .add({
      sender_uid: senderUid,
      text,
      created_at: firestore.FieldValue.serverTimestamp(),
      is_synced: true,
    });
}

export async function getGroupRoster(groupId: string, token: string): Promise<GroupRoster> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/members/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load group members');
  return res.json();
}

export async function getGroupMembers(groupId: string, token: string): Promise<GroupMember[]> {
  const roster = await getGroupRoster(groupId, token);
  return roster.members;
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