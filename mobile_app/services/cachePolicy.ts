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
  // Dashboard reads — short SWR so recs/activities/badges paint instantly
  // but still revalidate in the background. Covers both the student
  // per-user endpoints and the educator cross-class feed.
  { matcher: /\/api\/users\/\d+\/recommendations/, ttlSeconds: 180 },
  { matcher: /\/api\/users\/\d+\/activities/, ttlSeconds: 180 },
  { matcher: /\/api\/users\/activities/, ttlSeconds: 180 },
  { matcher: /\/api\/users\/\d+\/badges/, ttlSeconds: 180 },
  // The study-group list in the Activities tab — SWR so the tab paints
  // instantly on every visit and revalidates in the background. Groups are
  // invalidated explicitly after create/join/leave/update writes.
  { matcher: /\/api\/users\/groups\/mine\/?$/, ttlSeconds: 180 },
];

// Truly volatile / user-scored data — never cache, even if it accidentally matches allowlist.
// NOTE: the broad /groups/ rule was narrowed to PREFIXED per-group sub-resources
// (chat history, members, attachments, presigned links) so the group *list*
// below can enjoy SWR caching without leaking stale per-group payloads.
const NEVER_CACHE: Array<RegExp> = [
  /\/leaderboard/,
  /\/groups\/\d+\//,
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