import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/** True once the device reports it has no reachable connection. `null` until
 * NetInfo's first check resolves, so a consumer never flashes "offline" while
 * the network state is still unknown. */
export function useNetworkStatus(): boolean | null {
  const [isOffline, setIsOffline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then(state => {
      if (mounted) {
        setIsOffline(state.isConnected === false || state.isInternetReachable === false);
      }
    });
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return isOffline;
}