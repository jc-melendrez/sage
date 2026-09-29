import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getCurrentUser, getToken } from '@/services/authService';
import { getLanFinalStandings, lanGame } from '@/services/lanSession';
import { API_BASE_URL } from '@/config/api';

/** What the server says this player was actually paid for the game.
 *
 * The previous version computed XP from a hardcoded rank table
 * (`{1:100, 2:60, 3:40}`), which duplicated `GAME_PLACEMENT_XP` on the
 * backend and had already drifted from it, and it rendered the amount
 * unconditionally -- so a game that awarded nothing still claimed a payout.
 * Now the number comes from `/game/finish/`, and `pending` is an honest
 * "not settled yet" rather than a guess: a player who finishes before the
 * last player is paid by that player's request, which happens after this
 * screen is already up. */
type PlacementAward = {
  rank: number;
  xp: number | null;
  level: number | null;
  leveledUp: boolean;
  badges: any[];
  settled: boolean;
  pending: boolean;
};

export default function FinalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomCode: string; offline?: string; lan?: string; playerId?: string; quizTitle?: string; score?: string; correctCount?: string; totalQuestions?: string }>();
  const roomCode = params.roomCode;
  const isOffline = params.offline === 'true';
  const isLan = params.lan === 'true';
  const isOnline = !isOffline && !isLan;
  const [players, setPlayers] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  const [award, setAward] = useState<PlacementAward | null>(null);
  const podiumAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (!isOnline) return;
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
    if (!isOnline) return;
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

  /* ── placement award: read the real payout, retry while it is unsettled ──
   * A player who finishes before the last player has no award at that moment;
   * the last player's /game/finish/ settles the room and pays everyone. So the
   * read is retried over a few seconds rather than rendering a number that was
   * never granted, and stops as "pending" if it never arrives instead of
   * inventing an amount. */
  useEffect(() => {
    if (!isOnline || !roomCode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const MAX_ATTEMPTS = 6;

    const readAward = async () => {
      attempt += 1;
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_BASE_URL}/game/finish/?roomCode=${encodeURIComponent(roomCode)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          if (data.rank) setMyRank(data.rank);
          const settled: PlacementAward = {
            rank: data.rank ?? 0,
            xp: data.placementPending ? null : (data.placementXp ?? 0),
            level: data.level ?? null,
            leveledUp: !!data.leveledUp,
            badges: data.badges ?? [],
            settled: !!data.settled,
            pending: !!data.placementPending,
          };
          setAward(settled);
          if (!settled.pending) return;
        }
      } catch {
        // Offline or server unreachable: fall through to the retry ladder.
      }
      if (cancelled || attempt >= MAX_ATTEMPTS) return;
      // 0.6s, 1.2s, 1.8s, 2.4s, 3.0s.
      timer = setTimeout(readAward, 600 * attempt);
    };

    readAward();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isOnline, roomCode]);

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

  const offlinePlayers = isOffline
    ? [{ id: 'me', displayName: 'You', score: Number(params.score ?? 0) }]
    : null;
  const lanRows = isLan
    ? getLanFinalStandings().map(p => ({
        id: p.id || 'me',
        displayName: p.name || 'You',
        score: Number(p.score ?? 0),
      }))
    : [];
  const playersList = isOffline ? offlinePlayers! : isLan ? lanRows : players;

  useEffect(() => {
    if (teamMode ? teams.length === 0 : playersList.length === 0) return;
    Animated.spring(podiumAnim, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [teamMode, playersList.length > 0, teams.length > 0]);

  const lanMyId = params.playerId || '';
  const lanYouIndex = isLan
    ? lanRows.findIndex(
        p => (lanMyId && p.id === lanMyId) || (!lanMyId && p.displayName === lanGame.playerName)
      )
    : -1;
  const lanMyScore = lanYouIndex >= 0 ? lanRows[lanYouIndex].score : 0;
  const finalRank = isOffline ? 1 : isLan ? (lanYouIndex >= 0 ? lanYouIndex + 1 : null) : myRank;
  const showPodium = teamMode ? teams.length >= 3 : playersList.length >= 3;
  const podiumSecond = teamMode ? teams[1] : playersList[1];
  const podiumFirst = teamMode ? teams[0] : playersList[0];
  const podiumThird = teamMode ? teams[2] : playersList[2];
  const podiumName = (t: any) => t?.displayName ?? t?.name ?? '?';
  const podiumScore = (t: any) => t?.score ?? 0;
  const podiumColor = (t: any) => (teamMode && t?.color) || '#2d2a6e';

  const teamOf = (player: any) => (teamMode ? teams.find(t => t.id === player.teamId) ?? null : null);

  const listData = teamMode ? playersList : showPodium ? playersList.slice(3) : playersList;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Game Over!</Text>
      <Text style={styles.subtitle}>{teamMode ? 'Team Battle Results' : isOffline ? 'Offline Practice Complete' : isLan ? 'Friend Game Results' : 'Final Leaderboard'}</Text>
      {finalRank !== null && (
        <View style={styles.youBanner}>
          <Text style={styles.youBannerText}>
            {isOffline ? (
              <>You scored <Text style={styles.youBannerRank}>{Number(params.score ?? 0).toLocaleString()}</Text> pts · saved locally</>
            ) : isLan ? (
              <>You finished <Text style={styles.youBannerRank}>#{finalRank}</Text> with <Text style={styles.youBannerRank}>{lanMyScore.toLocaleString()}</Text> pts · saved locally</>
            ) : award?.xp != null ? (
              <>
                You finished <Text style={styles.youBannerRank}>#{finalRank}</Text> ·{' '}
                <Text style={styles.youBannerRank}>+{award.xp.toLocaleString()} XP</Text>
                {award.leveledUp && award.level ? ` · Level ${award.level}!` : ''}
              </>
            ) : (
              // No amount is shown until the server reports one. The room is
              // settled by the last player's request, so "pending" is the
              // truthful state for anyone who finished earlier.
              <>You finished <Text style={styles.youBannerRank}>#{finalRank}</Text> · XP pending…</>
            )}
          </Text>
          {award && award.badges.length > 0 && (
            <Text style={styles.badgeLine}>
              {award.badges.map((b: any) => b.icon ? `${b.icon} ${b.name}` : b.name).join('   ')}
            </Text>
          )}
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
  badgeLine: { color: '#F59E0B', fontSize: 13, fontWeight: '700', marginTop: 6 },
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
