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

export async function getGroupMembers(groupId: string, token: string): Promise<GroupMember[]> {
  const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/members/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load group members');
  return res.json();
}

export async function updateGroup(
  groupId: string,
  token: string,
  data: { name?: string; description?: string },
): Promise<{ id: string; name?: string; description?: string }> {
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