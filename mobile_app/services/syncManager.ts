// services/syncManager.ts
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import firestore from '@react-native-firebase/firestore';
import { getPendingWrites, markSynced } from './offlineQueue';
import {
  getPendingOfflineGames,
  markOfflineGameSynced,
  getPendingQuizResults,
  markQuizResultSynced,
} from './offlineGameService';
import { getToken } from './authService';
import { API_BASE_URL } from '../config/api';

// Re-entrancy guard: NetInfo, AppState and startup can all fire at once, and
// overlapping flushes would double-POST the same rows.
let flushing = false;

// Bounded exponential backoff for a flush that could not finish. Without it a
// single failing pass (connected-but-no-internet is common on a captive/Wi-Fi
// handoff) left rows pending until the *next* connectivity transition -- and
// there may not be one, because `isConnected` never changed.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5000;
const MAX_RETRY_DELAY = 60000;

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    void flushPendingSync();
  }, retryDelay);
}

/** Replay queued Firestore writes. Returns false if anything is still pending. */
async function flushQueuedWrites(): Promise<boolean> {
  const pending = getPendingWrites();
  let clean = true;
  for (const item of pending) {
    try {
      const payload = JSON.parse(item.payload);
      if (item.operation === 'add') {
        await firestore().collection(item.collection).add(payload);
      } else if (item.operation === 'update') {
        const { id, ...data } = payload;
        await firestore().collection(item.collection).doc(id).update(data);
      }
      markSynced(item.id);
    } catch (err) {
      clean = false;
      console.error('Sync failed for item', item.id, err);
    }
  }
  return clean;
}

/** Replay offline/LAN game results. Returns false if anything is still pending. */
async function flushOfflineGames(): Promise<boolean> {
  const pending = getPendingOfflineGames();
  if (pending.length === 0) return true;
  const token = await getToken();
  if (!token) return false;
  let clean = true;
  for (const game of pending) {
    // A LAN session stores the full roster as JSON; send it through so the
    // activity row replays the online "Final standings". Solo rows have no
    // roster and omit the key, and the server falls back to the summary.
    let participants: unknown;
    if (game.participants) {
      try {
        participants = JSON.parse(game.participants);
      } catch {
        participants = undefined;
      }
    }
    try {
      const res = await fetch(`${API_BASE_URL}/game/offline-results/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          sessionKey: game.session_key,
          quizId: game.quiz_id,
          quizTitle: game.quiz_title,
          quizType: game.quiz_type,
          timePerQuestion: game.time_per_question,
          score: game.score,
          correctCount: game.correct_count,
          answeredCount: game.answered_count,
          totalQuestions: game.total_questions,
          completedAt: game.completed_at,
          ...(Array.isArray(participants) && participants.length ? { participants } : {}),
        }),
      });
      if (res.ok) markOfflineGameSynced(game.id);
      else {
        clean = false;
        console.error('Offline game sync rejected', res.status);
      }
    } catch (err) {
      clean = false;
      console.error('Offline game sync failed', game.id, err);
    }
  }
  return clean;
}

/** Replay queued practice-quiz completions. Returns false if anything is left. */
async function flushQuizResults(): Promise<boolean> {
  const pending = getPendingQuizResults();
  if (pending.length === 0) return true;
  const token = await getToken();
  if (!token) return false;
  let clean = true;
  for (const item of pending) {
    try {
      let body: object;
      try {
        body = JSON.parse(item.payload);
      } catch {
        // A corrupt row can never succeed; drop it rather than block the queue.
        markQuizResultSynced(item.id);
        continue;
      }
      const res = await fetch(`${API_BASE_URL}/users/me/complete-quiz/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) markQuizResultSynced(item.id);
      else {
        clean = false;
        console.error('Quiz result sync rejected', res.status);
      }
    } catch (err) {
      clean = false;
      console.error('Quiz result sync failed', item.id, err);
    }
  }
  return clean;
}

/**
 * One pass over every pending queue. Safe to call from anywhere and at any
 * frequency -- concurrent calls collapse into a single pass.
 */
export async function flushPendingSync(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const writes = await flushQueuedWrites();
    const games = await flushOfflineGames();
    const quizzes = await flushQuizResults();
    if (writes && games && quizzes) {
      retryDelay = 5000;
      clearRetry();
    } else {
      scheduleRetry();
    }
  } finally {
    flushing = false;
  }
}

/** Fire-and-forget flush, for callers that just queued something. */
export function requestSyncFlush() {
  void flushPendingSync();
}

export function startSyncManager() {
  // Treat "no internet" (not merely "no link") as offline: a Wi-Fi captive
  // portal reports isConnected=true but every POST fails, which is exactly the
  // state that used to strand the earlier offline games.
  const onNetwork = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
    if (state.isConnected === false || state.isInternetReachable === false) return;
    void flushPendingSync();
  };

  const unsubscribeNet = NetInfo.addEventListener(onNetwork);
  // Foregrounding is the most reliable "we may be back" signal and does not
  // depend on NetInfo firing while the app was backgrounded.
  const appSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') requestSyncFlush();
  });
  // Startup, in case the app was killed mid-session and relaunched online.
  requestSyncFlush();

  return () => {
    unsubscribeNet();
    appSub.remove();
    clearRetry();
  };
}
