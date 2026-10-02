/**
 * Client-side half of the AI quota (see backend_api/core/users/ai_usage.py).
 *
 * The backend already refuses an over-budget request with a 429. This exists so
 * the app does not *make* the refused request in the first place, and so the
 * message the user sees explains a daily budget rather than showing a raw
 * network error.
 *
 * Deliberately not built around a remaining-quota counter. Surfacing "17 of 50
 * points left" invites the question of what a point is worth, and the weight
 * table behind it is a tuning guess. A silent budget that only speaks up when it
 * runs out is the honest version.
 *
 * The cooldown is stored per user and per action, because one exhausted action
 * must not disable the others: hitting the lesson cap should not also block
 * chat for the rest of the day.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AiAction = 'chat' | 'chat_image' | 'recommend' | 'game' | 'quiz' | 'topic' | 'lesson';

const KEY_PREFIX = 'ai_limits_v1:';

/**
 * Thrown when the server answers 429.
 *
 * A distinct class rather than a message check on Error, so a screen can tell
 * "you are out of AI allowance" apart from "the network is down" and offer the
 * right recovery. The backend's own wording is preferred when present.
 */
export class RateLimitError extends Error {
  /** Seconds until the limit resets, from Retry-After. Undefined if absent. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof RateLimitError;
}

/** Cooldown key. Scoped per user so switching accounts cannot inherit one. */
function keyFor(userId: string | number | null | undefined, action: AiAction) {
  return `${KEY_PREFIX}${userId ?? 'anon'}:${action}`;
}

/**
 * Seconds the user has to wait before `action` is worth trying again.
 *
 * 0 means "try it" -- i.e. no known cooldown.
 */
export async function cooldownRemaining(
  userId: string | number | null | undefined,
  action: AiAction,
): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, action));
    if (!raw) return 0;
    const until = Number(raw);
    if (!Number.isFinite(until)) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  } catch {
    // Storage failure must not block a request the server would have allowed.
    return 0;
  }
}

async function setCooldown(
  userId: string | number | null | undefined,
  action: AiAction,
  seconds: number,
) {
  try {
    await AsyncStorage.setItem(keyFor(userId, action), String(Date.now() + seconds * 1000));
  } catch {
    // Same reasoning as above: the worst case is one extra rejected request.
  }
}

async function clearCooldown(userId: string | number | null | undefined, action: AiAction) {
  try {
    await AsyncStorage.removeItem(keyFor(userId, action));
  } catch {
    /* ignore */
  }
}

/**
 * Shortest sensible server wait.
 *
 * The burst throttles answer in seconds; the daily budget answers "until
 * midnight", which can be hours. Applying an hours-long cooldown after a
 * 10-second burst limit would be wrong in the other direction, so a missing or
 * implausibly small Retry-After falls back to one minute rather than trusting it.
 */
export function normalizeRetryAfter(header: string | null | undefined): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  return Math.min(seconds, 24 * 60 * 60);
}

/**
 * Run an AI request, translating 429 into a `RateLimitError` and remembering the
 * cooldown so the next attempt on this action is skipped without a round trip.
 */
export async function withAiLimit<T>(params: {
  userId?: string | number | null;
  action: AiAction;
  run: () => Promise<T>;
}): Promise<T> {
  const { userId, action, run } = params;
  const waiting = await cooldownRemaining(userId, action);
  if (waiting > 0) {
    throw new RateLimitError(limitMessage(waiting), waiting);
  }

  try {
    return await run();
  } catch (err) {
    if (err instanceof RateLimitError) {
      await noteRateLimit(userId, action, err.retryAfterSeconds);
      throw err;
    }
    throw err;
  }
}

/**
 * Record a cooldown after a 429 seen outside `withAiLimit`.
 *
 * For screens that issue their own `fetch` (chat, and every generation form)
 * rather than going through the shared client, so they can record the refusal
 * without restructuring their request into a wrapper.
 */
export async function noteRateLimit(
  userId: string | number | null | undefined,
  action: AiAction,
  retryAfterSeconds?: number,
): Promise<void> {
  await setCooldown(userId, action, retryAfterSeconds ?? 60);
}

/**
 * Clear a cooldown once the wait has passed.
 *
 * Called by the screens when their timer expires so a stale entry does not
 * outlive the limit it recorded.
 */
export async function clearExpiredCooldown(
  userId: string | number | null | undefined,
  action: AiAction,
) {
  if ((await cooldownRemaining(userId, action)) === 0) {
    await clearCooldown(userId, action);
  }
}

/**
 * User-facing text.
 *
 * Past an hour the useful information is "come back later", not a precise
 * countdown nobody can act on, so this avoids pretending to be a clock.
 */
export function limitMessage(seconds: number): string {
  if (seconds < 60) return `Easy there — try again in ${seconds}s.`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `You've hit the AI rate limit. Try again in ${minutes} min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `You've used today's AI allowance. It resets in about ${hours}h.`;
  return "You've used today's AI allowance. It resets tomorrow.";
}