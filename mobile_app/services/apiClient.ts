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