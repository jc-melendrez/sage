/**
 * Has the user opened the guided tutorial yet?
 *
 * There is no server-side "onboarding complete" flag, and the tutorial entry is
 * a single header icon that looks like every other utility button, so new
 * players miss it. The Home screen uses this to draw attention to that button
 * (pulse + badge) until it has been opened once, then stops -- the cue is a
 * first-run nudge, not a permanent nag.
 *
 * Persisted per-device in AsyncStorage, the same tradeoff the notification
 * read-state makes: a returning user on a new device is treated as new again.
 * The versioned key matches the `sage.<thing>.v1` convention so a future shape
 * change can be introduced without resurrecting the old flag.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'sage.tutorial.seen.v1';

export interface TutorialSeen {
  /**
   * `null` until storage has loaded. Callers should render the button in its
   * normal (always-on) style immediately, but only start the attention cue once
   * this reads `false` -- otherwise a returning user sees the pulse flash on
   * every cold start before storage catches up.
   */
  seen: boolean | null;
  markSeen: () => void;
}

export function useTutorialSeen(): TutorialSeen {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled) setSeen(stored === '1');
      } catch {
        // Unreadable storage is a nicety, not a requirement. Treat it as unseen
        // so the nudge still works; the next successful write fixes it.
        if (!cancelled) setSeen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = useCallback(() => {
    setSeen(true);
    AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {
      // In-memory state still suppresses the cue for this session.
    });
  }, []);

  return { seen, markSeen };
}
