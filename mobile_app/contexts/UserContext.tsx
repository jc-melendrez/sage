import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentUser } from '../services/authService';
import { onCacheInvalidated } from '../services/apiCache';

export type CurrentUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  avatar?: string;
  role?: string;
  xp?: number;
  [key: string]: unknown;
};

interface UserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  /** Force a live refetch of the profile. */
  refreshUser: () => Promise<CurrentUser | null>;
  /**
   * Publish a profile the app already knows to be fresh (e.g. right after a
   * PATCH) so every mounted surface updates without a round trip.
   */
  setUser: (user: CurrentUser | null) => void;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refreshUser: async () => null,
  setUser: () => {},
});

/**
 * Single source of truth for the signed-in profile.
 *
 * Before this, ~20 screens each called `getCurrentUser()` into their own state.
 * Saving a new name or avatar wrote the fresh row to the HTTP cache, but every
 * screen that was already mounted kept rendering the value it had fetched
 * earlier, so the old name/avatar survived a save until the app was restarted.
 */
export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const profile = (await getCurrentUser()) as CurrentUser | null;
      if (mountedRef.current) setUserState(profile);
      return profile;
    } catch {
      // Offline / backend waking up. Keep the last known profile rather than
      // blanking the avatar and name across the whole app.
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  // A writer that invalidates the profile (e.g. `updateProfile`) tells us, and
  // we re-read so every surface converges on one value.
  useEffect(() => {
    return onCacheInvalidated((prefix) => {
      if (prefix.startsWith('/users/me')) void refreshUser();
    });
  }, [refreshUser]);

  const value = useMemo<UserContextValue>(
    () => ({ user, loading, refreshUser, setUser: setUserState }),
    [user, loading, refreshUser],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useCurrentUser(): UserContextValue {
  return useContext(UserContext);
}
