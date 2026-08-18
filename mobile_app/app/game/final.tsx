import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getCurrentUser } from '@/services/authService';

const PLACEMENT_XP: Record<number, number> = { 1: 100, 2: 60, 3: 40 };

function placementXpFor(rank: number) {
  return PLACEMENT_XP[rank] ?? 25;
}

export default function FinalScreen() {
  const router = useRouter();
  const { roomCode } = useLocalSearchParams<{ roomCode: string }>();
  const [players, setPlayers] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  const podiumAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then(user => {
        if (!user?.id || !mounted) return;
        firestore()
          .collection('gameRooms').doc(roomCode)
          .collection('players')
          .get()
          .then(snap => {
            if (!mounted) return;
            const sorted = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a: any, b: any) => b.score - a.score);
            const rank = sorted.findIndex(p => String(p.id) === String(user.id)) + 1;
            if (rank > 0) setMyRank(rank);
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

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
    const roomUnsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .onSnapshot(snap => setTeamMode(!!snap.data()?.teamMode));
    return () => { unsub(); roomUnsub(); };
  }, []);

  useEffect(() => {
    if (!teamMode) {
      setTeams([]);
      return;
    }
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('teams')
      .onSnapshot(snap => {
        const sorted = (snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? [])
          .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
        setTeams(sorted);
      });
    return () => unsub();
  }, [teamMode]);

  useEffect(() => {
    if (teamMode ? teams.length === 0 : players.length === 0) return;
    Animated.spring(podiumAnim, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [teamMode, players.length > 0, teams.length > 0]);

  const showPodium = teamMode ? teams.length >= 3 : players.length >= 3;
  const podiumSecond = teamMode ? teams[1] : players[1];
  const podiumFirst = teamMode ? teams[0] : players[0];
  const podiumThird = teamMode ? teams[2] : players[2];
  const podiumName = (t: any) => t?.displayName ?? t?.name ?? '?';
  const podiumScore = (t: any) => t?.score ?? 0;
  const podiumColor = (t: any) => (teamMode && t?.color) || '#2d2a6e';

  const teamOf = (player: any) => (teamMode ? teams.find(t => t.id === player.teamId) ?? null : null);

  const listData = teamMode ? players : showPodium ? players.slice(3) : players;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Game Over!</Text>
      <Text style={styles.subtitle}>{teamMode ? 'Team Battle Results' : 'Final Leaderboard'}</Text>
      {myRank !== null && (
        <View style={styles.youBanner}>
          <Text style={styles.youBannerText}>
            You finished <Text style={styles.youBannerRank}>#{myRank}</Text> · +{placementXpFor(myRank)} XP
          </Text>
        </View>
      )}
      {showPodium && (
        <Animated.View
          style={[
            styles.podiumRow,
            { opacity: podiumAnim, transform: [{ scale: podiumAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] },
          ]}
        >
          <View style={[styles.podiumCol, styles.podiumSecond]}>
            <Text style={styles.podiumMedal}>🥈</Text>
            <Text style={styles.podiumName} numberOfLines={1}>{podiumName(podiumSecond)}</Text>
            <Text style={[styles.podiumScore, { color: podiumColor(podiumSecond) }]}>{podiumScore(podiumSecond)}</Text>
            <View style={[styles.podiumBar, { height: 60, backgroundColor: podiumColor(podiumSecond) }]} />
          </View>

          <View style={[styles.podiumCol, styles.podiumFirst]}>
            <Text style={styles.crown}>👑</Text>
            <Text style={styles.podiumMedal}>🥇</Text>
            <Text style={styles.podiumName} numberOfLines={1}>{podiumName(podiumFirst)}</Text>
            <Text style={[styles.podiumScore, { color: podiumColor(podiumFirst) }]}>{podiumScore(podiumFirst)}</Text>
            <View style={[styles.podiumBar, { height: 90, backgroundColor: podiumColor(podiumFirst) }]} />
          </View>

          <View style={[styles.podiumCol, styles.podiumThird]}>
            <Text style={styles.podiumMedal}>🥉</Text>
            <Text style={styles.podiumName} numberOfLines={1}>{podiumName(podiumThird)}</Text>
            <Text style={[styles.podiumScore, { color: podiumColor(podiumThird) }]}>{podiumScore(podiumThird)}</Text>
            <View style={[styles.podiumBar, { height: 40, backgroundColor: podiumColor(podiumThird) }]} />
          </View>
        </Animated.View>
      )}
      <FlatList
        data={listData}
        keyExtractor={i => i.id}
        renderItem={({ item, index }) => {
          const rank = teamMode ? index + 1 : showPodium ? index + 4 : index + 1;
          const team = teamOf(item);
          return (
            <View style={styles.row}>
              <Text style={styles.medal}>{rank}.</Text>
              <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
              {team && <View style={[styles.teamDot, { backgroundColor: team.color }]} />}
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
  youBanner: {
    backgroundColor: '#2d2a6e',
    borderWidth: 1,
    borderColor: '#7F77DD',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  youBannerText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  youBannerRank: { color: '#7F77DD', fontWeight: 'bold' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1b4b', borderRadius: 12, padding: 14, marginBottom: 8 },
  medal: { fontSize: 20, marginRight: 12 },
  name: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  teamDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
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
  podiumScore: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  podiumBar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
});
