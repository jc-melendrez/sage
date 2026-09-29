import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getCurrentUser } from '@/services/authService';
import { getLanFinalStandings, lanGame } from '@/services/lanSession';
import TeamResultCard from '@/components/game/TeamResultCard';
import { sameTeamId, type TeamEntry, type TeamMember } from '@/types/game';

const PLACEMENT_XP: Record<number, number> = { 1: 100, 2: 60, 3: 40 };

function placementXpFor(rank: number) {
  return PLACEMENT_XP[rank] ?? 25;
}

export default function FinalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomCode: string; offline?: string; lan?: string; playerId?: string; quizTitle?: string; score?: string; correctCount?: string; totalQuestions?: string }>();
  const roomCode = params.roomCode;
  const isOffline = params.offline === 'true';
  const isLan = params.lan === 'true';
  const [players, setPlayers] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  // `members` and `contribution` are written by the server only at finish time
  // (see snapshot_team_results). Live team docs carry stats but no roster, so
  // the breakdown has to come from here and be merged onto the live entries.
  const [teamResults, setTeamResults] = useState<Record<string, TeamMember[]>>({});
  const podiumAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (isOffline || isLan) return;
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
            const sorted: any[] = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a: any, b: any) => b.score - a.score);
            const rank = sorted.findIndex(p => String(p.id) === String(user.id)) + 1;
            if (rank > 0) setMyRank(rank);
            const me = sorted.find((p: any) => String(p.id) === String(user.id));
            if (me?.teamId) setMyTeamId(String(me.teamId));
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (isOffline || isLan) return;
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
      .onSnapshot(snap => {
        const data = snap.data();
        setTeamMode(!!data?.teamMode);
        // The server keys members by `userId`; the client expects `id`, so
        // normalise here rather than patching every consumer.
        const byTeam: Record<string, TeamMember[]> = {};
        for (const result of data?.teamResults ?? []) {
          byTeam[String(result.teamId)] = (result.members ?? []).map((m: any) => ({
            id: String(m.userId ?? m.id ?? m.displayName),
            displayName: m.displayName ?? 'Player',
            score: m.score ?? 0,
            correctCount: m.correctCount ?? 0,
            answeredCount: m.answeredCount ?? 0,
            contribution: m.contribution ?? 0,
          }));
        }
        setTeamResults(byTeam);
      });
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
        const sorted = ((snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? []) as TeamEntry[])
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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

  // In team mode the player ranks with their team, not with themselves. The
  // individual score is still shown — inside the team card as a contribution.
  const rankOf = (t: TeamEntry) => teams.findIndex(x => x.id === t.id) + 1;
  const myTeamIndex = teams.findIndex(t => sameTeamId(t.id, myTeamId));
  const myTeam = myTeamIndex >= 0 ? teams[myTeamIndex] : null;
  const finalRank = isOffline
    ? 1
    : isLan
      ? (lanYouIndex >= 0 ? lanYouIndex + 1 : null)
      : teamMode
        ? (myTeamIndex >= 0 ? myTeamIndex + 1 : null)
        : myRank;

  const showPodium = teamMode ? teams.length >= 3 : playersList.length >= 3;
  const podiumSecond = teamMode ? teams[1] : playersList[1];
  const podiumFirst = teamMode ? teams[0] : playersList[0];
  const podiumThird = teamMode ? teams[2] : playersList[2];
  const podiumName = (t: any) => t?.displayName ?? t?.name ?? '?';
  const podiumScore = (t: any) => t?.score ?? 0;
  const podiumColor = (t: any) => (teamMode && t?.color) || '#2d2a6e';

  // Team mode ranks teams, not people. Teams below the podium are listed by
  // rank, and the player's own team gets an expanded card with the member
  // breakdown — but only when it is not already on the podium, which is what
  // made a top-three team appear twice.
  const listData = teamMode
    ? teams.filter(t => rankOf(t) > 3 && !sameTeamId(t.id, myTeamId))
    : showPodium ? playersList.slice(3) : playersList;
  // A team that is already visible on the podium does not need a second card.
  // Gated on showPodium because a 2-team room draws no podium, and suppressing
  // the card there would leave the player's own team off the screen entirely.
  // myTeam can be null when the room has no teamId for this player, so the
  // rank lookup has to be guarded before it dereferences anything.
  const onPodium = !!myTeam && showPodium && rankOf(myTeam) <= 3;
  const detailTeam = teamMode && myTeam && !onPodium ? myTeam : null;
  // Cards below the podium keep their true overall rank, which can be far
  // lower than their position in the filtered list.
  const listRank = (t: TeamEntry) => rankOf(t);


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
            ) : teamMode ? (
              <>{myTeam?.name ?? 'Your team'} placed <Text style={styles.youBannerRank}>#{finalRank}</Text> · +{placementXpFor(finalRank)} XP each</>
            ) : (
              <>You finished <Text style={styles.youBannerRank}>#{finalRank}</Text> · +{placementXpFor(finalRank)} XP</>
            )}
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
            {teamMode && podiumFirst?.maxMultiplier ? (
              <Text style={styles.podiumMult}>peak ×{podiumFirst.maxMultiplier}</Text>
            ) : null}
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
      {teamMode ? (
        <>
          {detailTeam && (
            <>
              <View style={styles.detailHead}>
                <Text style={styles.detailTitle}>Your team&rsquo;s breakdown</Text>
              </View>
              <TeamResultCard
                team={{ ...detailTeam, members: teamResults[detailTeam.id] }}
                rank={rankOf(detailTeam)}
                expanded
                isMyTeam
              />
            </>
          )}
          <FlatList
            data={listData}
            keyExtractor={i => String(i.id)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TeamResultCard team={item as TeamEntry} rank={listRank(item as TeamEntry)} expanded={false} isMyTeam={false} />
            )}
          />
        </>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={i => i.id}
          renderItem={({ item, index }) => {
            const rank = showPodium ? index + 4 : index + 1;
            return (
              <View style={styles.row}>
                <Text style={styles.medal}>{rank}.</Text>
                <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
                <Text style={styles.score}>{item.score} pts</Text>
              </View>
            );
          }}
        />
      )}
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
  podiumMult: { fontSize: 9, fontWeight: '700', color: '#aaa', marginBottom: 4 },
  podiumBar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  detailHead: { marginBottom: 8, marginTop: 4 },
  detailTitle: { color: '#7F77DD', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
});
