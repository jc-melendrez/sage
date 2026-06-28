// services/chatService.ts
import firestore from '@react-native-firebase/firestore';

export function subscribeToGroupMessages(groupId: string, callback: (msgs: any[]) => void) {
  return firestore()
    .collection('studyGroups')
    .doc(groupId)
    .collection('messages')
    .orderBy('created_at', 'asc')
    .onSnapshot(snapshot => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      callback(messages);
    });
}

export async function sendMessage(groupId: string, senderUid: string, text: string) {
  await firestore()
    .collection('studyGroups')
    .doc(groupId)
    .collection('messages')
    .add({
      sender_uid: senderUid,
      text,
      created_at: firestore.FieldValue.serverTimestamp(),
      is_synced: true,
    });
}