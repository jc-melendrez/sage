import { getCacheUserId } from './apiCache';

export interface CachePolicy {
  ttlSeconds: number;
  mode: 'swr';
}

// Rarely-changing content. Matched against the absolute URL.
const POLICY_RULES: Array<{ matcher: RegExp; ttlSeconds: number }> = [
  // Courses: mine, enrolled, detail, path, nodes.
  { matcher: /\/api\/users\/courses/, ttlSeconds: 3600 },
  { matcher: /\/api\/users\/nodes\//, ttlSeconds: 3600 },
  // Quiz lists + quiz payloads.
  { matcher: /\/api\/ai\/quizzes/, ttlSeconds: 86400 },
  // Current user profile.
  { matcher: /\/api\/users\/me/, ttlSeconds: 300 },
  // Previously generated lesson content.
  { matcher: /\/api\/users\/\d+\/lessons/, ttlSeconds: 86400 },
];

// Volatile / user-scored data — never cache, even if it accidentally matches allowlist.
const NEVER_CACHE: Array<RegExp> = [
  /\/leaderboard/,
  /\/badges/,
  /\/activities/,
  /\/recommendations/,
  /\/groups/,
  /\/game\//,
  /\/sessions/,
  /\/analytics/,
];

export function cachePolicyFor(url: string, method: string): CachePolicy | null {
  if (method.toUpperCase() !== 'GET') return null;
  if (NEVER_CACHE.some((r) => r.test(url))) return null;
  for (const rule of POLICY_RULES) {
    if (rule.matcher.test(url)) return { ttlSeconds: rule.ttlSeconds, mode: 'swr' };
  }
  return null;
}

/** User-scoped cache key so accounts never share data. */
export function buildCacheKey(method: string, url: string): string {
  const userId = getCacheUserId();
  return `${method.toUpperCase()}|${userId != null ? `u${userId}` : 'anon'}|${url}`;
}