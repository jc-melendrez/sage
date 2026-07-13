import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';

export default function FinalScreen() {
  const router = useRouter();
  const { roomCode } = useLocalSearchParams<{ roomCode: string }>();
  const [players, setPlayers] = useState<any[]>([]);
  const podiumAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        const sorted = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => b.score - a.score);
        setPlayers(sorted);
      });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (players.length === 0) return;
    Animated.spring(podiumAnim, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [players.length > 0]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Game Over!</Text>
      <Text style={styles.subtitle}>Final Leaderboard</Text>
      {players.length >= 3 && (
        <Animated.View
          style={[
            styles.podiumRow,
            { opacity: podiumAnim, transform: [{ scale: podiumAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] },
          ]}
        >
          <View style={[styles.podiumCol, styles.podiumSecond]}>
            <Text style={styles.podiumMedal}>🥈</Text>
            <Text style={styles.podiumName} numberOfLines={1}>{players[1].displayName}</Text>
            <Text style={styles.podiumScore}>{players[1].score}</Text>
            <View style={[styles.podiumBar, { height: 60 }]} />
          </View>

          <View style={[styles.podiumCol, styles.podiumFirst]}>
            <Text style={styles.crown}>👑</Text>
            <Text style={styles.podiumMedal}>🥇</Text>
            <Text style={styles.podiumName} numberOfLines={1}>{players[0].displayName}</Text>
            <Text style={styles.podiumScore}>{players[0].score}</Text>
            <View style={[styles.podiumBar, { height: 90 }]} />
          </View>

          <View style={[styles.podiumCol, styles.podiumThird]}>
            <Text style={styles.podiumMedal}>🥉</Text>
            <Text style={styles.podiumName} numberOfLines={1}>{players[2].displayName}</Text>
            <Text style={styles.podiumScore}>{players[2].score}</Text>
            <View style={[styles.podiumBar, { height: 40 }]} />
          </View>
        </Animated.View>
      )}
      <FlatList
        data={players.length >= 3 ? players.slice(3) : players}
        keyExtractor={i => i.id}
        renderItem={({ item, index }) => {
          const rank = players.length >= 3 ? index + 4 : index + 1;
          return (
            <View style={styles.row}>
              <Text style={styles.medal}>{rank}.</Text>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.score}>{item.score} pts</Text>
            </View>
          );
        }}
      />
      <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.btnText}>Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0c29', padding: 24, paddingTop: 60 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 4 },
  subtitle: { color: '#aaa', textAlign: 'center', marginBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1b4b', borderRadius: 12, padding: 14, marginBottom: 8 },
  first: { backgroundColor: '#2d2a6e', borderWidth: 1, borderColor: '#7F77DD' },
  medal: { fontSize: 20, marginRight: 12 },
  name: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  score: { color: '#7F77DD', fontWeight: 'bold', fontSize: 16 },
  btn: { backgroundColor: '#7F77DD', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginBottom: 28, gap: 8 },
  podiumCol: { alignItems: 'center', width: 96 },
  podiumFirst: {},
  podiumSecond: {},
  podiumThird: {},
  crown: { fontSize: 22, marginBottom: -4 },
  podiumMedal: { fontSize: 24 },
  podiumName: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 4 },
  podiumScore: { color: '#7F77DD', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  podiumBar: { width: '100%', backgroundColor: '#2d2a6e', borderTopLeftRadius: 8, borderTopRightRadius: 8, borderWidth: 1, borderColor: '#7F77DD' },
});