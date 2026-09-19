// services/syncManager.ts
import NetInfo from '@react-native-community/netinfo';
import firestore from '@react-native-firebase/firestore';
import { getPendingWrites, markSynced } from './offlineQueue';
import { getPendingOfflineGames, markOfflineGameSynced } from './offlineGameService';
import { getToken } from './authService';
import { API_BASE_URL } from '../config/api';

async function flushOfflineGames() {
  const pending = getPendingOfflineGames();
  if (pending.length === 0) return;
  const token = await getToken();
  if (!token) return;
  for (const game of pending) {
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
        }),
      });
      if (res.ok) markOfflineGameSynced(game.id);
      else console.error('Offline game sync rejected', res.status);
    } catch (err) {
      console.error('Offline game sync failed', game.id, err);
    }
  }
}

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
      await flushOfflineGames();
    }
  });
  return unsubscribe;
}