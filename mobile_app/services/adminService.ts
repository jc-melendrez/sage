import { apiCall } from './apiClient';

export type Role = 'superadmin' | 'educator' | 'student';

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  role: Role;
  is_student: boolean;
  is_educator: boolean;
  level: number;
  current_xp: number;
  total_points: number;
  streak: number;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
}

export interface PlatformAnalytics {
  total_users: number;
  active_users: number;
  users_by_role: Record<Role, number>;
}

// ---------- Superadmin (global scope) ----------

export const superadminService = {
  analytics: () => apiCall<PlatformAnalytics>('/users/superadmin/analytics/'),

  listUsers: (params?: { role?: Role }) => {
    const qs = new URLSearchParams();
    if (params?.role) qs.set('role', params.role);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiCall<ManagedUser[]>(`/users/superadmin/users/${suffix}`);
  },

  createUser: (data: {
    username: string;
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    role: Role;
  }) =>
    apiCall<ManagedUser>('/users/superadmin/users/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (userId: number, data: Partial<{ first_name: string; last_name: string; email: string; role: Role; is_active: boolean }>) =>
    apiCall<ManagedUser>(`/users/superadmin/users/${userId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
