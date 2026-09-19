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
    const result = await refreshAccessToken();
    if (result.ok) {
      response = await doFetch(result.access);
    } else if (result.reason === 'expired') {
      throw new Error('Session expired. Please log in again.');
    } else {
      throw new Error('Backend is still waking up — please pull to retry.');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || error.detail || `API error: ${response.status}`);
  }

  return await response.json();
}