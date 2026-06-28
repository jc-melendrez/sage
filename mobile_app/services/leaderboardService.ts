// services/leaderboardService.ts
import firestore from '@react-native-firebase/firestore';

export function subscribeToLeaderboard(callback: (data: any[]) => void) {
  return firestore()
    .collection('users')
    .orderBy('total_points', 'desc')
    .limit(20)
    .onSnapshot(snapshot => {
      const leaders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      callback(leaders);
    });
}
