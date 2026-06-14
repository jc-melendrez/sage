import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';

const API_BASE_URL = 'http://192.168.1.16:8000/api';

export default function LobbyScreen() {
  const router = useRouter();
  const { roomCode, isHost, topic } = useLocalSearchParams<{ roomCode: string; isHost: string; topic: string }>();
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    getCurrentUser().then(u => setCurrentUserId(u?.id));
  }, []);

  useEffect(() => {
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

    // Listen for game start
    const roomUnsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .onSnapshot(snap => {
        if (snap.data()?.status === 'active') {
          router.replace({ pathname: '/game/question', params: { roomCode, isHost } });
        }
      });

    return () => { unsub(); roomUnsub(); };
  }, [roomCode]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/start/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lobby</Text>
      <Text style={styles.code}>Room Code: <Text style={styles.codeVal}>{roomCode}</Text></Text>
      <Text style={styles.topic}>Topic: {topic}</Text>
      <Text style={styles.waiting}>Waiting for players...</Text>
      <FlatList
        data={players}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <View style={styles.player}>
            <Text style={styles.playerName}>{item.displayName}</Text>
            {String(item.id) === String(currentUserId) && <Text style={styles.you}>(You)</Text>}
          </View>
        )}
        style={styles.list}
      />
      {isHost === 'true' && (
        <TouchableOpacity style={styles.btn} onPress={handleStart} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Start Game</Text>}
        </TouchableOpacity>
      )}
      {isHost !== 'true' && <Text style={styles.waiting}>Waiting for host to start...</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0c29', padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  code: { color: '#aaa', fontSize: 16, marginBottom: 4 },
  codeVal: { color: '#7F77DD', fontWeight: 'bold' },
  topic: { color: '#aaa', fontSize: 14, marginBottom: 20 },
  waiting: { color: '#aaa', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  list: { flex: 1, marginBottom: 20 },
  player: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1b4b', borderRadius: 10, padding: 14, marginBottom: 8 },
  playerName: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  you: { color: '#7F77DD', fontSize: 12 },
  btn: { backgroundColor: '#7F77DD', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});