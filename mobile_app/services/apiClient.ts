import { API_BASE_URL } from '../config/api';
import { getToken, refreshAccessToken, getCachedUserId } from './authService';
import { getCachedResponse, setCachedResponse, setCacheUserId, parseCached } from './apiCache';
import { cachePolicyFor, buildCacheKey } from './cachePolicy';

export interface ApiRequestOptions extends RequestInit {
  /** Bypass the HTTP cache for this request (pull-to-refresh, writes that must be live). */
  noCache?: boolean;
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const doFetch = async (tok: string | null) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    } as HeadersInit;
    return fetch(url, { ...options, headers });
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

  // 204 No Content has no body, so parsing it would throw. The DELETE
  // endpoints in the task/activity API answer with it.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return await response.json();
}

function revalidateInBackground(url: string, options: RequestInit, ttlSeconds: number, key: string) {
  (async () => {
    try {
      const fresh = await fetchJson(url, options);
      setCacheUserId(await getCachedUserId());
      setCachedResponse(key, JSON.stringify(fresh), ttlSeconds);
    } catch {
      // Stay on the stale copy; the next visit will revalidate again.
    }
  })();
}

export async function apiCall<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  const { noCache, ...rest } = options;
  const method = (rest.method || 'GET').toUpperCase();
  const url = `${API_BASE_URL}${endpoint}`;

  // Transparent, user-scoped, stale-while-revalidate GET caching.
  if (!noCache && method === 'GET') {
    setCacheUserId(await getCachedUserId());
    const policy = cachePolicyFor(url, method);
    if (policy) {
      const key = buildCacheKey(method, url);
      const cached = getCachedResponse(key);
      if (cached) {
        const isFresh = Date.now() - cached.fetchedAt < cached.ttlSeconds * 1000;
        if (isFresh) {
          const hit = parseCached<T>(cached.body);
          if (hit != null) return hit;
        } else {
          revalidateInBackground(url, rest, policy.ttlSeconds, key);
          const hit = parseCached<T>(cached.body);
          if (hit != null) return hit;
        }
      }
    }
  }

  const data = await fetchJson<T>(url, rest);

  if (!noCache && method === 'GET') {
    const policy = cachePolicyFor(url, method);
    if (policy) {
      setCacheUserId(await getCachedUserId());
      setCachedResponse(buildCacheKey(method, url), JSON.stringify(data), policy.ttlSeconds);
    }
  }

  return data;
}

/**
 * Multipart request used for every file upload.
 *
 * Deliberately does NOT set Content-Type — React Native's fetch has to add the
 * `multipart/form-data; boundary=...` header itself, and setting it by hand
 * produces a body the server cannot parse.
 */
export async function apiUpload<T>(
  endpoint: string,
  formData: FormData,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST',
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const doFetch = async (tok: string | null) =>
    fetch(url, {
      method,
      headers: tok ? { Authorization: `Bearer ${tok}` } : undefined,
      body: formData,
    });

  let response = await doFetch(await getToken());

  if (response.status === 401) {
    const result = await refreshAccessToken();
    if (!result.ok) {
      throw new Error(
        result.reason === 'expired'
          ? 'Session expired. Please log in again.'
          : 'Backend is still waking up — please try again.'
      );
    }
    response = await doFetch(result.access);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || error.detail || `API error: ${response.status}`);
  }

  // 204 No Content (deletes) has nothing to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}