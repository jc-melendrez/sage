import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Animated, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getCurrentUser, getToken } from '@/services/authService';
import { getLanFinalStandings, lanGame } from '@/services/lanSession';
import { API_BASE_URL } from '@/config/api';
import TeamResultCard from '@/components/game/TeamResultCard';
import SessionSummary, { type TeamNameLookup } from '@/components/game/SessionSummary';
import { getOfflineGameSession } from '@/services/offlineGameService';
import {
  buildBreakdown,
  mergeSettledRank,
  orderTeamsForResults,
} from '@/services/gameBreakdown';
import {
  sameTeamId,
  type GameQuestion,
  type PlayerEntry,
  type TeamEntry,
  type TeamMember,
} from '@/types/game';

const PLACEMENT_XP: Record<number, number> = { 1: 100, 2: 60, 3: 40 };

function placementXpFor(rank: number) {
  return PLACEMENT_XP[rank] ?? 25;
}

export default function FinalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomCode: string; offline?: string; lan?: string; playerId?: string; quizTitle?: string; score?: string; correctCount?: string; totalQuestions?: string; offlineId?: string }>();
  const roomCode = params.roomCode;
  const isOffline = params.offline === 'true';
  const isLan = params.lan === 'true';
  const [players, setPlayers] = useState<any[]>([]);
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  // `members` and `contribution` are written by the server only at finish time
  // (see snapshot_team_results). Live team docs carry stats but no roster, so
  // the breakdown has to come from here and be merged onto the live entries.
  const [teamResults, setTeamResults] = useState<Record<string, TeamMember[]>>({});
  // The same `teamResults` array, kept for its ranking fields. The settled
  // rankScore is what the placement XP was actually paid from, so the ordering
  // below follows it instead of recomputing and risking a different order.
  const [settledRank, setSettledRank] = useState<any[]>([]);
  const podiumAnim = useState(new Animated.Value(0))[0];

  // Only the user's own id is resolved here. Their rank and team used to be
  // read from a one-shot players.get() in the same effect, guarded by a silent
  // .catch(() => {}), so a failed lookup — or a players collection that had not
  // been written yet — left both null for the life of the screen. With fewer
  // than three teams there is no podium to fall back on, so the results came up
  // blank. Both are now derived from the live subscription below, which is
  // already fetching the same documents.
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // Who is allowed to reset the room. Read from the live room document rather
  // than from who created it on the client, because a host who left hands the
  // room over (HostClaimView) and the new host has to see the button too.
  const [isHost, setIsHost] = useState(false);
  const [rematching, setRematching] = useState(false);

  const startRematch = useCallback(async () => {
    try {
      const token = await getToken();
      setRematching(true);
      const res = await fetch(`${API_BASE_URL}/game/rematch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Back to the lobby with the SAME code -- that is the whole point of a
      // rematch, so the students never have to re-enter anything. `isHost` is
      // passed explicitly because the button is host-only, so the lobby can be
      // relied on for its host controls immediately rather than after it
      // re-derives that from Firestore.
      router.replace(`/game/lobby?roomCode=${roomCode}&isHost=true`);
    } catch (e: any) {
      Alert.alert('Rematch failed', e?.message ?? 'Could not start the rematch');
      setRematching(false);
    }
  }, [roomCode, router]);

  useEffect(() => {
    if (isOffline || isLan) return;
    let mounted = true;
    getCurrentUser()
      .then(user => {
        if (!mounted) return;
        if (user?.id) setMyUserId(String(user.id));
      })
      .catch(error => {
        // Loud on purpose: a silent catch here is what made the blank screen
        // undiagnosable.
        console.warn('[final] could not resolve the current user id', error);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (isOffline || isLan) return;
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        const sorted: any[] = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => b.score - a.score);
        setPlayers(sorted);

        // Derived live, so a late-arriving player document still resolves the
        // viewer's own rank and team without a manual refresh.
        if (myUserId) {
          const me = sorted.find((p: any) => String(p.id) === myUserId);
          const rank = sorted.findIndex((p: any) => String(p.id) === myUserId) + 1;
          if (rank > 0) setMyRank(rank);
          // A null/blank teamId means the player watched from the Spectators
          // column for the whole game. That is a legitimate result now that
          // spectating is the default, not a lookup failure.
          setMyTeamId(me?.teamId != null && me.teamId !== '' ? String(me.teamId) : null);
        }
      });
    const roomUnsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .onSnapshot(snap => {
        const data = snap.data();
        setTeamMode(!!data?.teamMode);
        setQuestions((data?.questions ?? []) as GameQuestion[]);
        setSettledRank(data?.teamResults ?? []);
        if (myUserId && data?.hostId != null) {
          setIsHost(String(data.hostId) === myUserId);
        }
        // The server keys members by `userId`; the client expects `id`, so
        // normalise here rather than patching every consumer.
        const byTeam: Record<string, TeamMember[]> = {};
        for (const result of data?.teamResults ?? []) {
          byTeam[String(result.teamId)] = (result.members ?? []).map((m: any) => ({
            id: String(m.userId ?? m.id ?? m.displayName),
            displayName: m.displayName ?? 'Player',
            avatar: m.avatar ?? undefined,
            score: m.score ?? 0,
            correctCount: m.correctCount ?? 0,
            answeredCount: m.answeredCount ?? 0,
            accuracy: m.accuracy ?? 0,
            agreement: m.agreement ?? 0,
            bestStreak: m.bestStreak ?? 0,
            isMvp: !!m.isMvp,
            earlyFinisher: !!m.earlyFinisher,
          }));
        }
        setTeamResults(byTeam);
      });
    return () => { unsub(); roomUnsub(); };
    // myUserId is a dependency so the subscription re-attaches once, and only
    // once, after the identity lookup lands. Without it the closure would keep
    // the initial null and never resolve the viewer's own row.
  }, [myUserId]);

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

  /* ── the shared breakdown ────────────────────────────────────────────────
     One derivation for all three modes. They differ only in where the
     questions and the per-player answer logs come from:
       online  — the room doc and each player doc's `answers` map
       offline — the SQLite row written when the practice run was saved
       LAN     — the local SQLite row for questions, plus the logs the host
                  relayed in the final leaderboard
     Anything missing degrades to an empty log, which renders the score-only
     screen this used to show. */
const localSession = isOffline || isLan
    ? getOfflineGameSession(Number(params.offlineId ?? 0))
    : { questions: [] as GameQuestion[], answerLog: {} };
  const sessionQuestions = isOffline || isLan ? localSession.questions : questions;

  // Memoised: rebuilt inline it would be a fresh array every render, which would
  // cascade into a fresh breakdown and a fresh rankedTeams on every render too.
  const sessionPlayers: PlayerEntry[] = useMemo(() => (isOffline
    ? [{
        id: 'me',
        displayName: 'You',
        score: Number(params.score ?? 0),
        correctCount: Number(params.correctCount ?? 0),
        // Counted from the log, not from `totalQuestions`: a run abandoned
        // early would otherwise report full attendance and drag the accuracy
        // tiles down with it.
        answeredCount: Object.keys(localSession.answerLog).length,
        streak: 0,
        isFinished: true,
        answers: localSession.answerLog,
      }]
    : isLan
      ? (getLanFinalStandings().map(p => ({
          id: p.id || 'me',
          displayName: p.name || 'You',
          score: Number(p.score ?? 0),
          correctCount: Number(p.correctCount ?? 0),
          answeredCount: Object.keys(p.answers ?? {}).length,
          streak: 0,
          isFinished: true,
          answers: p.answers,
        })) as unknown as PlayerEntry[])
      : (players as unknown as PlayerEntry[])),
  [isOffline, isLan, localSession.answerLog, params.score, params.correctCount, players]);

const breakdown = useMemo(() => buildBreakdown({
    questions: sessionQuestions,
    players: sessionPlayers,
    myUserId: isOffline
      ? 'me'
      : isLan
        ? (params.playerId || 'me')
        : myUserId,
  }),
  [sessionQuestions, sessionPlayers, isOffline, isLan, params.playerId, myUserId]);

  const teamNames: Record<string, TeamNameLookup> = useMemo(() => {
    const out: Record<string, TeamNameLookup> = {};
    for (const t of teams) out[String(t.id)] = { name: t.name, color: t.color };
    return out;
  }, [teams]);

  // Ranked by the settled score where the server published one, otherwise by
  // average per active member. Replaces the raw-score sort, which ranked a
  // three-person team and a one-person team by total and made the larger team
  // look like it was playing better.
  const rankedTeams = useMemo(
    () => orderTeamsForResults(mergeSettledRank(teams, settledRank), sessionPlayers),
    [teams, settledRank, sessionPlayers],
  );

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
  // Indexed into `rankedTeams`, not the raw subscription order, so every rank
  // on this screen comes from the same ordering the XP was paid on.
  const rankOf = (t: TeamEntry) => rankedTeams.findIndex(x => x.id === t.id) + 1;
  const myTeamIndex = rankedTeams.findIndex(t => sameTeamId(t.id, myTeamId));
  const myTeam = myTeamIndex >= 0 ? rankedTeams[myTeamIndex] : null;
  const finalRank = isOffline
    ? 1
    : isLan
      ? (lanYouIndex >= 0 ? lanYouIndex + 1 : null)
      : teamMode
        ? (myTeamIndex >= 0 ? myTeamIndex + 1 : null)
        : myRank;

  const showPodium = teamMode ? rankedTeams.length >= 3 : playersList.length >= 3;
  const podiumSecond = teamMode ? rankedTeams[1] : playersList[1];
  const podiumFirst = teamMode ? rankedTeams[0] : playersList[0];
  const podiumThird = teamMode ? rankedTeams[2] : playersList[2];
  const podiumName = (t: any) => t?.displayName ?? t?.name ?? '?';
  const podiumScore = (t: any) => t?.score ?? 0;
  const podiumColor = (t: any) => (teamMode && t?.color) || '#2d2a6e';

  // Teams that are not already represented elsewhere on the screen. This used
  // to filter to `rankOf(t) > 3`, which assumes a podium is being drawn: with
  // two teams (or a player who watched from the Spectators column, who has no
  // team of their own) that filter matched nothing, so the list was empty and
  // the screen showed a title and nothing else. Anything already on the podium
  // or expanded as the viewer's own team is dropped, so no team shows twice.
  const onPodium = !!myTeam && showPodium && rankOf(myTeam) <= 3;
  const detailTeam = teamMode && myTeam && !onPodium ? myTeam : null;
  const listData = teamMode
    ? rankedTeams.filter(t => !(showPodium && rankOf(t) <= 3) && !(detailTeam && sameTeamId(t.id, detailTeam.id)))
    : showPodium ? playersList.slice(3) : playersList;
  // Cards below the podium keep their true overall rank, which can be far
  // lower than their position in the filtered list.
  const listRank = (t: TeamEntry) => rankOf(t);


  return (
    // ScrollView rather than a bare View: the breakdown below is longer than
    // the leaderboard it now sits under, and without this the review was simply
    // unreachable on a long session.
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Game Over!</Text>
      <Text style={styles.subtitle}>{teamMode ? 'Team Battle Results' : isOffline ? 'Offline Practice Complete' : isLan ? 'Friend Game Results' : 'Final Leaderboard'}</Text>
      {teamMode && !myTeam && (
        // Spectating is the default now, so watching a whole game without
        // picking a team is an ordinary outcome. It used to produce no banner
        // and no team card, which read as a broken screen.
        <View style={styles.youBanner}>
          <Text style={styles.youBannerText}>
            <>You watched this game from the <Text style={styles.youBannerRank}>Spectators</Text> column, so you have no team rank. The final standings are below.</>
          </Text>
        </View>
      )}
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
          // The whole screen is a ScrollView now, so this list must not scroll
          // itself or RN warns about a VirtualizedList inside a plain
          // ScrollView and the inner gesture swallows the outer one.
          scrollEnabled={false}
          renderItem={({ item, index }) => {
            const rank = showPodium ? index + 4 : index + 1;
            const answered = item.answeredCount ?? 0;
            const accuracy = answered > 0
              ? Math.round(((item.correctCount ?? 0) / answered) * 100)
              : 0;
            return (
              <View style={styles.row}>
                <Text style={styles.medal}>{rank}.</Text>
                <View style={styles.rowMain}>
                  <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {accuracy}% · {item.correctCount ?? 0}/{answered}
                    {item.bestStreak ? ` · best ${item.bestStreak}` : ''}
                  </Text>
                </View>
                <Text style={styles.score}>{item.score} pts</Text>
              </View>
            );
          }}
        />
      )}

      {/* The one post-game review, shared by classic, team, online, offline and
          LAN. Renders its own empty state when no answers were logged, so a
          room saved before this existed still gets a working screen. */}
      <SessionSummary breakdown={breakdown} teams={teamNames} />

      <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(tabs)/games')}>
        <Text style={styles.btnText}>Back to Game Center</Text>
      </TouchableOpacity>

      {/* Only the host, and only for a real room -- offline and LAN sessions have
          no server-side room to reset. Everyone else just reads results. */}
      {isHost && !isOffline && !isLan && (
        <TouchableOpacity
          style={[styles.btn, styles.rematchBtn, rematching && { opacity: 0.6 }]}
          onPress={startRematch}
          disabled={rematching}
        >
          {rematching
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Play Again</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0c29' },
  content: { padding: 24, paddingTop: 60, paddingBottom: 40 },
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
  rowMain: { flex: 1, minWidth: 0 },
  rowMeta: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 },
  teamDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  score: { color: '#7F77DD', fontWeight: 'bold', fontSize: 16 },
  btn: { backgroundColor: '#7F77DD', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  rematchBtn: { backgroundColor: '#10B981', marginTop: 10 },
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
