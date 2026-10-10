/**
 * Read/unread state for the notification centre.
 *
 * The notification list is derived on the fly from activities, badges,
 * recommendations, quiz deadlines, class tasks and join requests -- there is
 * no server-side notification table and no read flag. So "read" is tracked
 * here as a set of notification ids the user has seen, plus the moment they
 * last pressed "mark all", persisted to AsyncStorage.
 *
 * Two rules keep the bell honest:
 *
 *  - Every write is a UNION with what is already stored. `markAllRead` used to
 *    REPLACE the set, which discarded anything marked individually before a
 *    re-fetch, and is why "Clear all" used to re-light the badge seconds later.
 *  - `clearedAt` covers ids that are not stable. A row that carries its own
 *    creation time counts as read for anything created before the clear, so a
 *    regenerated id for the same underlying record cannot resurrect it --
 *    while a genuinely new record (created after the clear) still does.
 *  - `hidden` is the "Clear all" set: ids the user has swept off the list
 *    once they were read. They stay hidden while unread rows and brand-new
 *    notifications keep showing.
 *
 * Ids are stable because every notification is built from a record id
 * (`rec-12`, `act-34`, `badge-5`, ...), which is what lets a newly generated
 * recommendation light the bell back up after the user cleared it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'sage.notifications.read.v1';

export interface NotificationKey {
  id: string;
  /**
   * Epoch ms the underlying record was created, when it has one. Omit it for
   * rows that represent a CHANGE in state rather than a creation (a deadline
   * moving inside a day, a pending join request): those must light the bell on
   * their new id, and a creation-time watermark would silence them.
   */
  createdAt?: number;
}

interface Stored {
  read: string[];
  clearedAt: number;
  hidden: string[];
}

function parse(raw: string | null): Stored {
  if (!raw) return { read: [], clearedAt: 0, hidden: [] };
  try {
    const value = JSON.parse(raw);
    // v1 stored a bare array of ids. Keep reading it, or upgrading the app
    // would re-light every badge the user had already cleared.
    if (Array.isArray(value)) {
      return { read: value.filter((v) => typeof v === 'string'), clearedAt: 0, hidden: [] };
    }
    return {
      read: Array.isArray(value?.read)
        ? value.read.filter((v: unknown) => typeof v === 'string')
        : [],
      clearedAt: typeof value?.clearedAt === 'number' ? value.clearedAt : 0,
      hidden: Array.isArray(value?.hidden)
        ? value.hidden.filter((v: unknown) => typeof v === 'string')
        : [],
    };
  } catch {
    // Corrupt storage should not brick the bell; start fresh.
    return { read: [], clearedAt: 0, hidden: [] };
  }
}

export function useNotificationReadState(keys: NotificationKey[]) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [clearedAt, setClearedAt] = useState(0);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        const parsed = parse(stored);
        setReadIds(new Set(parsed.read));
        setClearedAt(parsed.clearedAt);
        setHiddenIds(new Set(parsed.hidden));
      } catch {
        // Unread storage is a nicety, not a requirement.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: Set<string>, nextClearedAt: number, nextHidden: Set<string>) => {
    setReadIds(next);
    setClearedAt(nextClearedAt);
    setHiddenIds(nextHidden);
    try {
      // Bounded: ids for items that no longer exist are dead weight.
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          read: [...next].slice(-500),
          clearedAt: nextClearedAt,
          hidden: [...nextHidden].slice(-500),
        }),
      );
    } catch {
      // Ignore write failures; in-memory state still works this session.
    }
  }, []);

  /** Mark a single row read when the user taps it -- they have seen it. */
  const markRead = useCallback(
    (id: string) => {
      if (readIds.has(id)) return;
      const next = new Set(readIds);
      next.add(id);
      void persist(next, clearedAt, hiddenIds);
    },
    [readIds, clearedAt, hiddenIds, persist],
  );

  const markAllRead = useCallback(async () => {
    // Union, never replace: rows marked individually before this press are
    // still read afterwards even if they have since dropped off the feed.
    const next = new Set(readIds);
    for (const key of keys) next.add(key.id);
    await persist(next, Date.now(), hiddenIds);
  }, [keys, readIds, hiddenIds, persist]);

  const isUnread = useCallback(
    (id: string, createdAt?: number) =>
      hydrated
      && !readIds.has(id)
      && !(typeof createdAt === 'number' && createdAt > 0 && createdAt <= clearedAt),
    [readIds, hydrated, clearedAt],
  );

  /** True for ids swept off the list by "Clear all". */
  const isHidden = useCallback((id: string) => hydrated && hiddenIds.has(id), [hydrated, hiddenIds]);

  /**
   * "Clear all": sweep every row that is currently READ off the list. Unread
   * rows stay put, and brand-new notifications are never hidden. Hidden ids are
   * remembered so a re-fetch cannot resurrect a read row.
   */
  const clearRead = useCallback(async () => {
    if (!hydrated) return;
    const next = new Set(hiddenIds);
    for (const key of keys) {
      if (!isUnread(key.id, key.createdAt)) next.add(key.id);
    }
    if (next.size === hiddenIds.size) return;
    await persist(readIds, clearedAt, next);
  }, [hydrated, keys, isUnread, readIds, clearedAt, hiddenIds, persist]);

  // Stay at 0 until storage has loaded, otherwise the badge flashes a count
  // on every cold start and then drops to the real number.
  const unreadCount = useMemo(() => {
    if (!hydrated) return 0;
    return keys.reduce(
      (total, key) => (isUnread(key.id, key.createdAt) ? total + 1 : total),
      0,
    );
  }, [keys, hydrated, isUnread]);

  return { unreadCount, isUnread, isHidden, markRead, markAllRead, clearRead, hydrated };
}
