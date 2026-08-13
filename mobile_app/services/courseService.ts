import { apiCall } from './apiClient';

export interface CourseStudent {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  level: number;
  current_xp: number;
  total_points: number;
  streak: number;
  courses_completed: number;
  study_hours: number;
  quizzes_taken: number;
  group_activities_count: number;
}

export interface CourseSummary {
  id: number;
  name: string;
  description: string | null;
  join_code: string;
  educator: {
    id: number;
    username: string;
    display_name: string;
  };
  student_count: number;
  study_group_id: number | null;
  created_at: string;
}

export interface CourseRoster extends CourseSummary {
  students: CourseStudent[];
}

export interface CreateCourseInput {
  name: string;
  description?: string;
}

export async function createCourse(input: CreateCourseInput): Promise<CourseSummary> {
  return apiCall<CourseSummary>('/users/courses/create/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getMyCourses(): Promise<CourseRoster[]> {
  return apiCall<CourseRoster[]>('/users/courses/mine/');
}

export async function getEnrolledCourses(): Promise<CourseSummary[]> {
  return apiCall<CourseSummary[]>('/users/courses/enrolled/');
}

export async function getCourse(courseId: number): Promise<CourseRoster> {
  return apiCall<CourseRoster>(`/users/courses/${courseId}/`);
}

export async function joinCourseByCode(joinCode: string): Promise<CourseRoster> {
  return apiCall<CourseRoster>('/users/courses/join/', {
    method: 'POST',
    body: JSON.stringify({ join_code: joinCode }),
  });
}

export async function addStudentToCourse(courseId: number, userId: number): Promise<CourseRoster> {
  return apiCall<CourseRoster>(`/users/courses/${courseId}/add-student/`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function removeStudentFromCourse(courseId: number, userId: number): Promise<CourseRoster> {
  return apiCall<CourseRoster>(`/users/courses/${courseId}/remove-student/`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}
