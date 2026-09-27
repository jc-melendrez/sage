/**
 * Read/unread state for the notification centre.
 *
 * The notification list is derived on the fly from activities, badges,
 * recommendations and quiz deadlines -- there is no server-side notification
 * table and no read flag. So "read" is tracked here as a set of notification
 * ids the user has seen, persisted to AsyncStorage.
 *
 * Ids are stable because every notification is built from a record id
 * (`rec-12`, `act-34`, `badge-5`, ...), which is what lets a newly generated
 * recommendation light the bell back up after the user cleared it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'sage.notifications.read.v1';

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  } catch {
    // Corrupt storage should not brick the bell; start fresh.
    return [];
  }
}

export function useNotificationReadState(itemIds: string[]) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled) setReadIds(new Set(parse(stored)));
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

  const persist = useCallback(async (next: Set<string>) => {
    setReadIds(next);
    try {
      // Bounded: ids for items that no longer exist are dead weight.
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next].slice(-500)));
    } catch {
      // Ignore write failures; in-memory state still works this session.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    await persist(new Set(itemIds));
  }, [itemIds, persist]);

  const isUnread = useCallback(
    (id: string) => hydrated && !readIds.has(id),
    [readIds, hydrated],
  );

  // Stay at 0 until storage has loaded, otherwise the badge flashes a count
  // on every cold start and then drops to the real number.
  const unreadCount = useMemo(
    () => (hydrated ? itemIds.reduce((total, id) => (readIds.has(id) ? total : total + 1), 0) : 0),
    [itemIds, readIds, hydrated],
  );

  return { unreadCount, isUnread, markAllRead, hydrated };
}
