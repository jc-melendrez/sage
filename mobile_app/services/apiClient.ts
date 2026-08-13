import { API_BASE_URL } from '../config/api';
import { getToken, refreshAccessToken } from './authService';

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const doFetch = async (tok: string | null) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    } as HeadersInit;
    return fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  };

  let token = await getToken();
  let response = await doFetch(token);

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await doFetch(newToken);
    } else {
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || error.detail || `API error: ${response.status}`);
  }

  return await response.json();
}