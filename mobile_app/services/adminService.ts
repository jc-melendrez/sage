import { apiCall } from './apiClient';

export type Role = 'superadmin' | 'admin' | 'educator' | 'student';

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  role: Role;
  school_id: number | null;
  is_student: boolean;
  is_educator: boolean;
  is_admin: boolean;
  level: number;
  current_xp: number;
  total_points: number;
  streak: number;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
}

export interface School {
  id: number;
  name: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  is_active: boolean;
  created_at: string;
  member_count: number;
}

export interface PlatformAnalytics {
  total_schools: number;
  active_schools: number;
  total_users: number;
  active_users: number;
  users_by_school: { school_id: number; name: string; members: number }[];
  users_by_role: Record<Role, number>;
}

export interface RoleChangeLogEntry {
  id: number;
  changed_by: number;
  changed_by_username: string;
  target_user: number;
  target_username: string;
  from_role: string;
  to_role: string;
  created_at: string;
}

// ---------- Superadmin (global scope) ----------

export const superadminService = {
  analytics: () => apiCall<PlatformAnalytics>('/users/superadmin/analytics/'),

  listSchools: () => apiCall<School[]>('/users/superadmin/schools/'),

  createSchool: (data: { name: string; address?: string; contact_email?: string; contact_phone?: string }) =>
    apiCall<School>('/users/superadmin/schools/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSchool: (schoolId: number) =>
    apiCall<School>(`/users/superadmin/schools/${schoolId}/`),

  createSchoolAdmin: (
    schoolId: number,
    data: { username: string; email: string; password: string; first_name?: string; last_name?: string }
  ) =>
    apiCall<ManagedUser>(`/users/superadmin/schools/${schoolId}/admins/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listUsers: (params?: { school?: number; role?: Role }) => {
    const qs = new URLSearchParams();
    if (params?.school) qs.set('school', String(params.school));
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
    school?: number | null;
  }) =>
    apiCall<ManagedUser>('/users/superadmin/users/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (userId: number, data: Partial<{ first_name: string; last_name: string; email: string; role: Role; school: number | null; is_active: boolean }>) =>
    apiCall<ManagedUser>(`/users/superadmin/users/${userId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// ---------- Admin (school-scoped) ----------

export const adminService = {
  listUsers: (schoolId: number) =>
    apiCall<ManagedUser[]>(`/users/schools/${schoolId}/users/`),

  createUser: (
    schoolId: number,
    data: { username: string; email: string; password?: string; first_name?: string; last_name?: string; role: 'student' | 'educator' }
  ) =>
    apiCall<ManagedUser>(`/users/schools/${schoolId}/users/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (schoolId: number, userId: number, data: Partial<{ first_name: string; last_name: string; email: string; is_active: boolean }>) =>
    apiCall<ManagedUser>(`/users/schools/${schoolId}/users/${userId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  changeRole: (schoolId: number, userId: number, role: Role) =>
    apiCall<ManagedUser>(`/users/schools/${schoolId}/users/${userId}/role/`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  roleLogs: (schoolId: number) =>
    apiCall<RoleChangeLogEntry[]>(`/users/schools/${schoolId}/role-logs/`),
};
