import { apiCall } from './apiClient';

export interface StudyGroup {
  id: number;
  name: string;
  description: string;
  members_count: number;
  join_code: string;
  created_by: number;
}

export async function getUserGroups(): Promise<StudyGroup[]> {
  return apiCall<StudyGroup[]>('/users/groups/mine/');
}

export async function createGroup(name: string): Promise<{ message: string; group_id: string; join_code: string }> {
  return apiCall<{ message: string; group_id: string; join_code: string }>('/users/groups/create/', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function joinGroup(code: string): Promise<{ message: string; group_id: string; name: string }> {
  return apiCall<{ message: string; group_id: string; name: string }>('/users/groups/join/', {
    method: 'POST',
    body: JSON.stringify({ join_code: code }),
  });
}