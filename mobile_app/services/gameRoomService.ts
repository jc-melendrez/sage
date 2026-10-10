import firestore from '@react-native-firebase/firestore';
import { apiCall } from './apiClient';

/**
 * Take a player out of a game room.
 *
 * Leaving is more than dropping local state. The player has to come off their
 * team, their own player document has to go, and — when they were the host —
 * the room has to be handed to someone still present, or it sits permanently
 * unhosted and can never start again. The final screen used to just navigate
 * away, which left a ghost player in the roster and, for the host, a room no
 * one could restart.
 *
 * Best-effort throughout: a network failure must not trap someone who has
 * already pressed Leave. The room is cleaned up by the writes that do land,
 * and a leftover document for an offline player is harmless.
 */
export async function leaveGameRoom(
  roomCode: string | null | undefined,
  userId: string | number | null | undefined,
): Promise<void> {
  if (!roomCode || userId == null || userId === '') return;
  const id = String(userId);
  const roomRef = firestore().collection('gameRooms').doc(roomCode);
  const playerRef = roomRef.collection('players').doc(id);

  // Come off the team first, so a promoted player never sees a stale seat.
  try {
    const playerSnap = await playerRef.get();
    const myTeamId = playerSnap.data()?.teamId;
    if (myTeamId) {
      await roomRef
        .collection('teams')
        .doc(myTeamId)
        .update({ memberIds: firestore.FieldValue.arrayRemove(id) });
    }
  } catch {}

  await playerRef.delete().catch(() => {});

  // A no-op while the host is still present, so it is safe to call for a
  // non-host: only a departing host actually hands the room over.
  try {
    await apiCall('/game/host/claim/', {
      method: 'POST',
      body: JSON.stringify({ roomCode }),
    });
  } catch {}
}
