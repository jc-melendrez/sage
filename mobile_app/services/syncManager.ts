// services/syncManager.ts
import NetInfo from '@react-native-community/netinfo';
import firestore from '@react-native-firebase/firestore';
import { getPendingWrites, markSynced } from './offlineQueue';

export function startSyncManager() {
  const unsubscribe = NetInfo.addEventListener(async state => {
    if (state.isConnected) {
      const pending = getPendingWrites();
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
          console.error('Sync failed for item', item.id, err);
        }
      }
    }
  });
  return unsubscribe;
}