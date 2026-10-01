import { useCallback, useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, Platform, StatusBar, Animated, Image, Pressable, Share,
  BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { pfpSource } from '@/constants/pfps';
import { getLanClient, lanGame, getLastLanRoster, setLastLanRoster, setLanPlayerId } from '@/services/lanSession';
import type { LanMessage } from '@/services/lanProtocol';
import TeamColumns from '@/components/game/TeamColumns';
import type { PlayerEntry, RoomStatus, TeamEntry } from '@/types/game';

/**
 * busyTeamId sentinel for the spectator column. Team ids are numeric strings,
 * so a non-numeric key can never collide with a real one.
 */
const SPECTATOR_KEY = '__spectator__';

const COLORS = {
  bg: '#0f0c29',
  bgSecondary: '#1a1640',
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  cardBg: '#232052',
  purpleDeep: '#4C1D95',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  cardBorder: 'rgba(127, 119, 221, 0.3)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function LobbyScreen() {
  const router = useRouter();
  const { roomCode, isHost, topic, lan: lanParam, myId: myIdParam } = useLocalSearchParams<{ roomCode: string; isHost: string; topic: string; lan?: string; myId?: string }>();
  // LAN (offline hotspot) lobbies share this screen with online rooms.
  const isLAN = lanParam === 'true';
  const [myLanId, setMyLanId] = useState<string | null>(myIdParam || null);
  const [players, setPlayers] = useState<PlayerEntry[]>([]);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('waiting');
  // null means "the room document has not said yet". This is deliberately not
  // a plain boolean: the roster and the team columns are mutually exclusive, so
  // seeding false painted the PLAYERS roster on the first frame and then hid it
  // when the snapshot landed -- a visible flash for anyone opening a team room.
  //
  // LAN lobbies never get a room document (their subscription returns early), so
  // they are seeded with the answer instead of waiting: a LAN game is always
  // classic. Seeding from `isLAN` rather than in an effect keeps this correct on
  // the very first render.
  const [teamMode, setTeamMode] = useState<boolean | null>(isLAN ? false : null);
  const [loading, setLoading] = useState(false);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  // The teams row is a horizontally scrolling strip inside a vertically
  // scrolling lobby, so a newly added team can land completely off screen with
  // no other cue -- which is indistinguishable from "nothing happened". The
  // server echoes the new teamId, so we scroll it into view and pulse it.
  const [highlightTeamId, setHighlightTeamId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // A custom lobby creates the room before a quiz exists, so the host picks one
  // here. These track what the room document currently has.
  const [quizPending, setQuizPending] = useState(false);
  const [roomTopic, setRoomTopic] = useState(topic || '');
  const [roomQuestionCount, setRoomQuestionCount] = useState(0);
// Null means "the room document has no teamCount yet". Logged to diagnose the
// one-column report; the column list itself is driven by the teams collection.
const [roomTeamCount, setRoomTeamCount] = useState<number | null>(null);
  const [quizzes, setQuizzes] = useState<{ id: number; title: string; question_count?: number }[]>([]);
  const [showQuizPicker, setShowQuizPicker] = useState(false);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [hostId, setHostId] = useState<number | string | null>(null);
  // Auto-assign and the per-team "+" are separate actions from START, each with
  // their own in-flight flag so a double-tap cannot deal the roster twice.
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignDone, setAutoAssignDone] = useState(false);

  // Joiner countdown shown when the host starts the game
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const countdownAnim = useRef(new Animated.Value(1)).current;

  /* ── original effects (UNCHANGED) ── */
  useEffect(() => {
    getCurrentUser().then(u => setCurrentUserId(u?.id));
  }, []);

  /**
   * Leave the lobby, telling the server so the room does not keep a dead host.
   *
   * The Play tab stashes this room's code before pushing here, and START there
   * reuses any non-null room code. Walking out of the lobby used to be a bare
   * route pop, so the code survived and a later Classic game got sent to this
   * deferQuiz room instead of creating its own.
   */
  const exitToPlay = useCallback(() => {
    if (isLAN) { router.back(); return; }
    // replace, not push: the lobby was pushed on top of the Play screen, so
    // pushing it again would stack another Play screen on top of the lobby and
    // the next back press would return the student to the lobby they just left.
    //
    // The pathname is '/games', the Play tab -- NOT '/game'. Both render this
    // same component, but they are not the same screen: app/_layout.tsx
    // registers app/game/ as a root Stack *outside* the (tabs) group, so '/game'
    // has no Tabs ancestor and no bottom navigation bar came back with it.
    // '/games' is the tab route ((tabs)/games.tsx re-exports app/game/index.tsx),
    // so leaving through it keeps the student inside the tabs navigator.
    //
    // The `as any` that used to sit here suppressed exactly the typed-route
    // error that would have caught this, so it stays off.
    router.replace({ pathname: '/games', params: { leftLobby: '1' } });
  }, [isLAN, router]);

  // The phone's back gesture has to run the same cleanup as the on-screen
  // button, or it is a route pop that leaves the stale room code behind.
  useEffect(() => {
    if (isLAN) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitToPlay();
      return true;
    });
    return () => sub.remove();
  }, [exitToPlay, isLAN]);

  useEffect(() => {
    if (isLAN) return;
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        setPlayers((snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? []) as PlayerEntry[]);
      });

    // Listen for game start
    const roomUnsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .onSnapshot(snap => {
        const d = snap?.data();
        setRoomStatus(d?.status ?? 'waiting');
        setTeamMode(!!d?.teamMode);
        if (d?.topic) setRoomTopic(d.topic);
        setRoomQuestionCount(d?.questionCount ?? 0);
        setRoomTeamCount(d?.teamCount ?? null);
        setQuizPending(!!d?.quizPending);
        if (d?.status === 'active') {
          startJoinerCountdown();
        }
      });

    return () => { unsub(); roomUnsub(); };
  }, [roomCode, isLAN]);

  const startJoinerCountdown = () => {
    setShowCountdown(true);
    setCountdownValue(3);
    animateCountdownNumber(() => {
      setCountdownValue(2);
      animateCountdownNumber(() => {
        setCountdownValue(1);
        animateCountdownNumber(() => {
          setShowCountdown(false);
          router.replace({
            pathname: '/game/question',
            params: {
              roomCode,
              isHost,
              ...(isLAN ? { lan: 'true' } : {}),
            },
          } as any);
        });
      });
    });
  };

  const animateCountdownNumber = (callback: () => void) => {
    countdownAnim.setValue(0.4);
    Animated.spring(countdownAnim, { toValue: 1, friction: 5, tension: 45, useNativeDriver: true })
      .start(() => setTimeout(callback, 250));
  };

  /* ── teams subscription (team mode only) ── */
  useEffect(() => {
    // `!== true` rather than `!teamMode`, so the listener waits for the room
    // document to actually confirm team mode instead of attaching on the
    // unknown first frame and detaching again.
    if (teamMode !== true) {
      setTeams([]);
      return;
    }
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .collection('teams')
      .onSnapshot(snap => {
        const docs = snap?.docs ?? [];
        setTeams(docs.map(d => ({ id: d.id, ...d.data() })) as TeamEntry[]);

        // A team-mode room whose teams subcollection is empty has nothing to
        // tap and nothing to name, and the host is the only one who can fix it.
        // Creating the first team here saves the room from needing a re-share.
        if (docs.length === 0 && isHostUserRef.current) {
          post('teams/add/', { roomCode }).catch(() => {});
        }
      });
    return () => unsub();
  }, [teamMode, roomCode, roomTeamCount]);

  /* ── live hostId, so a promoted host actually gains the host controls ── */
  useEffect(() => {
    if (isLAN) return;
    // This used to be a one-shot get(). That froze the host identity at mount,
    // so when the original host left and someone else took over, this screen
    // carried on showing the departed host's controls to everyone.
    const unsub = firestore().collection('gameRooms').doc(roomCode)
      .onSnapshot(s => setHostId(s.data()?.hostId ?? null));
    return () => unsub();
  }, [roomCode, isLAN]);

  // Read by the teams subscription above, which is created before the room
  // document has delivered hostId -- a captured isHostUser there would still be
  // false forever and the empty-room repair would never run.
  const isHostUserRef = useRef(false);
  useEffect(() => {
    isHostUserRef.current =
      hostId != null && currentUserId != null
      && String(hostId) === String(currentUserId);
  }, [hostId, currentUserId]);

  /**
   * Ask the server to hand the room over when its host is no longer in it.
   *
   * The host's own leave is a bare Firestore delete with no server call, so
   * this listener is the only thing that notices when they close the app
   * without leaving. It is safe to call from every client: the server elects
   * the same person deterministically and no-ops while a host is still there.
   */
  useEffect(() => {
    if (isLAN) return;
    if (hostId == null || players.length === 0) return;
    const hostStillHere = players.some(p => String(p.id) === String(hostId));
    if (hostStillHere) return;
    post('host/claim/', { roomCode }).catch(() => {});
  }, [hostId, players, roomCode, isLAN]);

  /* ── LAN mode: roster + game start come from the LAN client, not Firestore ── */
  const lanStartedRef = useRef(false);
  // LAN rooms have no teams and no scoring, so the roster is stored in a
  // slimmer shape and widened to PlayerEntry here rather than making every
  // online field optional across the game screens.
  const asLobbyPlayer = (p: { id: string; name: string; avatar?: string; connected: boolean }): PlayerEntry => ({
    id: p.id, displayName: p.name, avatar: p.avatar,
    score: 0, answeredCount: 0, streak: 0, isFinished: false, teamId: null,
  });

  useEffect(() => {
    if (!isLAN) return;
    const client = getLanClient();
    if (!client) return;
    // Seed with the latest roster so players who joined before this screen
    // mounted (e.g. between welcome and navigation) are visible immediately.
    const seed = getLastLanRoster();
    if (seed.length > 0) {
      setPlayers(seed.map(asLobbyPlayer));
    }
    client.onEvent = (msg: LanMessage) => {
      if (msg.t === 'welcome') {
        setMyLanId(msg.playerId);
        setLanPlayerId(msg.playerId);
      } else if (msg.t === 'roster') {
        const connected = msg.players.filter(p => p.connected);
        setLastLanRoster(connected);
        setPlayers(connected.map(asLobbyPlayer));
      } else if (msg.t === 'quiz') {
        lanGame.quiz = msg.quiz;
        lanGame.order = msg.order ?? lanGame.order;
        lanGame.timePerQuestion = msg.timePerQuestion ?? lanGame.timePerQuestion;
        setRoomStatus('active');
        if (!lanStartedRef.current) {
          lanStartedRef.current = true;
          startJoinerCountdown();
        }
      } else if (msg.t === 'error') {
        Alert.alert('LAN Error', msg.message || 'Unexpected error');
        router.back();
      } else if (msg.t === 'end') {
        if (!lanStartedRef.current) {
          Alert.alert('Game Ended', msg.reason || 'The host ended the game');
          router.back();
        }
      }
    };
    return () => {
      client.onEvent = () => {};
    };
  }, [isLAN]);

  /* ── UI-only animation refs ── */
  const headerAnim = useRef(new Animated.Value(0)).current;
  const codeAnim = useRef(new Animated.Value(0)).current;
  const rosterAnim = useRef(new Animated.Value(0)).current;
  const ctaAnim = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    headerAnim.setValue(0); codeAnim.setValue(0); rosterAnim.setValue(0); ctaAnim.setValue(0);
    Animated.stagger(90, [
      Animated.spring(headerAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.spring(codeAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.spring(rosterAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.timing(ctaAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(livePulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(livePulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  const startGame = async (allowUnassigned: boolean) => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/start/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // `force` used to be how leftovers got dealt, which welded "assign the
        // roster" onto "begin the game". allowUnassigned instead starts the game
        // and leaves anyone without a team in the spectators, which is the state
        // the host confirmed in the dialog.
        body: JSON.stringify(allowUnassigned ? { roomCode, allowUnassigned: 'true' } : { roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = () => {
    if (unassigned.length === 0) { startGame(false); return; }
    // No "auto-assign & start" option any more. Assignment is the button below
    // this one; if the host wants it they press it first, and get to see the
    // split before committing to it.
    Alert.alert(
      'Start anyway?',
      `${unassigned.length} ${unassigned.length === 1 ? 'player has' : 'players have'} not picked a team. They will stay in the spectators.`,
      [
        { text: 'Wait', style: 'cancel' },
        { text: 'Start', onPress: () => startGame(true) },
      ],
    );
  };

  const isHostUser =
    hostId != null && currentUserId != null && String(hostId) === String(currentUserId)
      // The route param is only a fallback for the moment before the room
      // listener delivers. Deriving this from it alone meant a host who left
      // mid-game left everyone else stuck with stale host controls, and a
      // promoted host saw no controls at all.
      || (hostId == null && isHost === 'true');
  const unassigned = teamMode ? players.filter(p => !p.teamId) : [];
  const playerCount = players.length;
  const ghostSeats = Math.max(0, 4 - playerCount);
  const codeChars = (roomCode || '').split('');

  /**
   * Deal everyone into evenly-sized teams.
   *
   * Deliberately its own request, not the `force` flag on /game/start/: auto
   * assign used to live only inside start, which meant tidying the roster and
   * beginning the game were the same irreversible action.
   */
  const doAutoAssign = async () => {
    if (autoAssigning) return;
    setAutoAssigning(true);
    setAutoAssignDone(false);
    try {
      await post('teams/auto-assign/', { roomCode });
      setAutoAssignDone(true);
    } catch (e: any) {
      Alert.alert('Could not auto-assign', e?.message || 'Try again');
    } finally {
      setAutoAssigning(false);
    }
  };

  /* ── host quiz selection (custom lobby) ── */
  const openQuizPicker = async () => {
    setShowQuizPicker(true);
    if (quizzes.length > 0) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/quizzes/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const list = Array.isArray(data) ? data : (data.results ?? []);
        setQuizzes(list);
      }
    } catch {
      // The picker renders an empty-state message if this fails; not worth an
      // interrupting alert on top of whatever else the host is doing.
    }
  };

  const chooseQuiz = async (quizId: number) => {
    setSavingQuiz(true);
    try {
      await post('set-quiz/', { roomCode, quizId });
      // The room document is the source of truth, so let the snapshot above
      // clear quizPending rather than guessing at it locally.
      setShowQuizPicker(false);
    } catch (e: any) {
      Alert.alert('Could Not Set Quiz', e.message);
    } finally {
      setSavingQuiz(false);
    }
  };

  const copyInvite = async () => {
    try {
      await Clipboard.setStringAsync((roomCode || '').toUpperCase());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      Alert.alert('Copy Failed', 'Could not copy the room code.');
    }
  };

  const shareInvite = async () => {
    try {
      const code = (roomCode || '').toUpperCase();
      await Share.share({
        message: `Join my SAGE game! Room code: ${code}`,
      });
    } catch {
      // The user dismissing the share sheet is not an error.
    }
  };

  /* ── team assignment ── */
  const myPlayer = players.find(p => String(p.id) === String(currentUserId));
  const myTeamId = myPlayer?.teamId ?? null;
  const sortedTeams = [...teams].sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
  const allAssigned = !teamMode || (players.length > 0 && players.every(p => p.teamId));
  const myTeam = sortedTeams.find(t => String(t.id) === String(myTeamId));

  const post = async (path: string, body: Record<string, unknown>) => {
    const token = await getToken();
    const res = await fetch(`${API_BASE_URL}/game/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  // teamId null means "go back to the spectators". First pick needs no
  // ceremony; leaving or switching teams does, since it silently changes who
  // you are answering for.
  const handlePickTeam = (teamId: string | null) => {
    if (roomStatus === 'active' || !currentUserId) return;

    if (teamId == null) {
      const current = myTeam;
      if (!current) return;
      Alert.alert(
        'Leave team',
        `Go back to the spectators instead of playing for ${current.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', onPress: () => doAssign(null) },
        ],
      );
      return;
    }

    const target = sortedTeams.find(t => String(t.id) === String(teamId));
    const current = myTeam;
    if (!target || String(target.id) === String(myTeamId)) return;
    if (!current) { doAssign(teamId); return; }
    Alert.alert(
      'Switch team',
      `Move from ${current.name} to ${target.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => doAssign(teamId) },
      ],
    );
  };

  // Team assignment goes through the server, not a client-side Firestore
  // batch: capacity is a race otherwise, and a full team would happily
  // accept a write that the roster then over-reports.
  const doAssign = async (teamId: string | null) => {
    // Team ids are numeric strings, so this sentinel can never collide with a
    // real one; it just marks the spectator column as the busy one.
    setBusyTeamId(teamId == null ? SPECTATOR_KEY : String(teamId));
    try {
      // Sent as a real null, not String(null). The server reads teamId: null as
      // "go back to the spectators"; the string "null" would look for a team
      // with that id and 404.
      await post('teams/assign/', { roomCode, teamId });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to join team');
    } finally {
      setBusyTeamId(null);
    }
  };

  // Lets the host decide how many teams the class needs while students are
  // still arriving, instead of guessing before the room is created.
  const doAddTeam = async () => {
    // Logged rather than silently ignored: a guard that returns without a trace
    // is how "+ TEAM did nothing" became unreproducible from a bug report.
    if (addingTeam) {
      console.warn('[lobby] addTeam ignored: already in flight');
      return;
    }
    if (!roomCode) {
      console.warn('[lobby] addTeam ignored: no roomCode');
      Alert.alert('Could not add team', 'No room to add a team to.');
      return;
    }
    setAddingTeam(true);
    try {
      const data = await post('teams/add/', { roomCode });
      const newId = data?.teamId != null ? String(data.teamId) : null;
      console.log('[lobby] addTeam ok', { teamId: newId, teamCount: data?.teamCount });
      setHighlightTeamId(newId);
      // Bring the new column on screen, then drop the pulse so the room looks
      // settled again. The teams listener paints the column separately, so a
      // short scroll-to-end is enough to reveal it.
      scrollRef.current?.scrollToEnd({ animated: true });
    } catch (e: any) {
      console.warn('[lobby] addTeam failed', e?.message);
      Alert.alert('Could not add team', e?.message || 'Try again');
    } finally {
      setAddingTeam(false);
    }
  };

  // Clear the pulse once, from a single timer, rather than per-render.
  useEffect(() => {
    if (highlightTeamId == null) return;
    const t = setTimeout(() => setHighlightTeamId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightTeamId]);

  const doRename = async (teamId: string, name: string) => {
    try {
      await post('teams/rename/', { roomCode, teamId, name });
    } catch (e: any) {
      Alert.alert('Rename failed', e?.message || 'Could not rename team');
    }
  };

  return (
    <LinearGradient
      colors={[COLORS.bg, COLORS.bgSecondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── header ── */}
        <Animated.View
          style={[styles.header, {
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
          }]}
        >
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={exitToPlay}
              hitSlop={10}
              style={styles.backBtn}
              accessibilityLabel="Back to Play"
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.kicker}>LOBBY</Text>
            <Text style={styles.title} numberOfLines={1}>{topic || 'Quiz Battle'}</Text>
          </View>
          <View style={styles.countPill}>
            <Ionicons name="people" size={14} color={COLORS.accent} />
            <Text style={styles.countPillText}>{playerCount}</Text>
          </View>
        </Animated.View>

        {/* ── room code hero card ── */}
        <Animated.View
          style={[styles.codeCard, {
            opacity: codeAnim,
            transform: [{ translateY: codeAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          }]}
        >
          <View style={styles.cardEdge} />
          <View style={styles.codeTopRow}>
            <View style={styles.codeTab}><Text style={styles.codeTabText}>ROOM CODE</Text></View>
            <View style={styles.openPill}>
              <Animated.View
                style={[styles.openDot, {
                  opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                  transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) }],
                }]}
              />
              <Text style={styles.openText}>OPEN</Text>
            </View>
          </View>

          <View style={styles.codeChips}>
            {codeChars.map((ch, i) => (
              <View key={i} style={styles.codeChip}>
                <Text style={styles.codeChipText}>{ch}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.codeHint}>Send this code to friends so they can join the battle</Text>

          {/* Copy/share were missing: the code was on screen but the host had to
              read it out loud, which is the whole friction point of a lobby. */}
          {!isLAN && (
            <View style={styles.codeActions}>
              <TouchableOpacity style={styles.codeAction} onPress={copyInvite}>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={COLORS.accent} />
                <Text style={styles.codeActionText}>{copied ? 'Copied' : 'Copy code'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.codeAction} onPress={shareInvite}>
                <Ionicons name="share-social-outline" size={15} color={COLORS.purpleLight} />
                <Text style={styles.codeActionText}>Share invite</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>

        {/* ── quiz selection (custom lobby) ── */}
        {!isLAN && (isHostUser || quizPending) && (
          <Animated.View
            style={[styles.quizCard, {
              opacity: rosterAnim,
              transform: [{ translateY: rosterAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            }]}
          >
            <View style={styles.quizCardTop}>
              <View style={styles.quizIconWrap}>
                <Ionicons name="document-text-outline" size={16} color={COLORS.purpleLight} />
              </View>
              <View style={styles.quizInfo}>
                <Text style={styles.quizKicker}>QUIZ</Text>
                <Text style={styles.quizTitle} numberOfLines={1}>
                  {quizPending ? 'No quiz chosen yet' : (roomTopic || 'Quiz Battle')}
                </Text>
                {!quizPending && roomQuestionCount > 0 && (
                  <Text style={styles.quizSub}>{roomQuestionCount} questions</Text>
                )}
              </View>
            </View>

            {isHostUser && (
              <TouchableOpacity
                style={[styles.quizAction, (savingQuiz || loading) && styles.quizActionDisabled]}
                onPress={openQuizPicker}
                disabled={savingQuiz || loading}
              >
                {savingQuiz ? (
                  <ActivityIndicator size="small" color={COLORS.textPrimary} />
                ) : (
                  <Ionicons name={quizPending ? 'add' : 'swap-horizontal'} size={15} color={COLORS.textPrimary} />
                )}
                <Text style={styles.quizActionText}>{quizPending ? 'Choose a quiz' : 'Change quiz'}</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* ── teams (team mode) ── */}
        {teamMode === true && (
          <Animated.View
            style={{
              opacity: rosterAnim,
              transform: [{ translateY: rosterAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            }}
          >
            <View style={styles.rosterHead}>
              <Text style={styles.rosterKicker}>TEAMS</Text>
              {allAssigned ? (
                <View style={styles.waitingTag}>
                  <View style={[styles.waitingDot, { backgroundColor: COLORS.success }]} />
                  <Text style={styles.waitingTagText}>All players assigned</Text>
                </View>
              ) : (
                <View style={styles.waitingTag}>
                  <View style={styles.waitingDot} />
                  <Text style={styles.waitingTagText}>Tap a team, or stay in the spectators</Text>
                </View>
              )}
            </View>

            <TeamColumns
              teams={sortedTeams}
              players={players}
              myId={currentUserId != null ? String(currentUserId) : null}
              myTeamId={myTeamId != null ? String(myTeamId) : null}
              locked={roomStatus === 'active' || roomStatus === 'finished'}
              canRename={isHostUser || myTeamId != null}
              busyTeamId={busyTeamId}
              onJoin={handlePickTeam}
              onRename={doRename}
              canAddTeam={isHostUser}
              onAddTeam={doAddTeam}
              addingTeam={addingTeam}
              highlightTeamId={highlightTeamId}
            />
          </Animated.View>
        )}

        {/* ── roster ──
            Classic mode only. In team mode every player is already accounted
            for twice over -- once in the spectators bar if they have not picked
            a team, once inside their team's column if they have -- so a third
            flat list of the same people just made the screen longer and the
            columns harder to reach. */}
        {teamMode === false && (
        <Animated.View
          style={{
            opacity: rosterAnim,
            transform: [{ translateY: rosterAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          }}
        >
          <View style={styles.rosterHead}>
            <Text style={styles.rosterKicker}>PLAYERS</Text>
            <View style={styles.waitingTag}>
              <Animated.View
                style={[styles.waitingDot, {
                  opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                }]}
              />
              <Text style={styles.waitingTagText}>Waiting for players...</Text>
            </View>
          </View>

          {players.map((item) => {
            const isYou = isLAN
              ? String(item.id) === String(myLanId)
              : String(item.id) === String(currentUserId);
            const isHostRow = hostId != null && String(item.id) === String(hostId);
            const teamInfo = teamMode ? teams.find(t => t.id === item.teamId) : null;
            const initial = (item.displayName || '?').charAt(0).toUpperCase();
            return (
              <View key={item.id} style={[styles.playerCard, isYou && styles.playerCardYou]}>
                {isYou && <View style={styles.playerCardEdge} />}
                <View style={[styles.avatar, isYou && styles.avatarYou]}>
                  {pfpSource(item.avatar) ? (
                    <Image source={pfpSource(item.avatar)!} style={styles.avatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.avatarText, isYou && styles.avatarTextYou]}>{initial}</Text>
                  )}
                </View>
                <View style={styles.playerInfo}>
                  <View style={styles.playerNameRow}>
                    <Text style={styles.playerName} numberOfLines={1}>{item.displayName}</Text>
                    {isYou && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
                  </View>
                  <View style={styles.playerSubRow}>
                    <Text style={styles.playerSub}>
                      {isHostRow ? 'Host' : 'Player'} · Ready
                    </Text>
                    {teamInfo && <View style={[styles.playerTeamDot, { backgroundColor: teamInfo.color }]} />}
                    {teamInfo && (
                      <Text style={styles.playerSub}>
                        {` · ${teamInfo.name}`}
                      </Text>
                    )}
                    {teamMode && !teamInfo && (
                      <Text style={[styles.playerSub, { color: COLORS.warning }]}> · Pick a team</Text>
                    )}
                  </View>
                </View>
                {isHostRow && <Text style={styles.crown}>👑</Text>}
                <View style={[styles.readyDot, teamMode && !item.teamId && { backgroundColor: COLORS.warning }]} />
              </View>
            );
          })}

          {/* ghost seats fill the empty middle */}
          {Array.from({ length: ghostSeats }).map((_, i) => (
            <Animated.View
              key={`ghost-${i}`}
              style={[styles.ghostSeat, {
                opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.75] }),
              }]}
            >
              <View style={styles.ghostAvatar}>
                <Ionicons name="person" size={18} color={COLORS.textMuted} />
              </View>
              <Text style={styles.ghostText}>Waiting for player...</Text>
            </Animated.View>
          ))}
        </Animated.View>
        )}
      </ScrollView>

      {/* ── bottom CTA bar (safe-area fixed) ── */}
      <Animated.View
        style={[styles.bottomBar, {
          opacity: ctaAnim,
          transform: [{ translateY: ctaAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }]}
      >
        {isHostUser ? (
          <View style={styles.hostActions}>
            <TouchableOpacity
              style={styles.startWrap}
              onPress={handleStart}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <View style={styles.startInnerDisabled}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : (
                <LinearGradient
                  colors={[COLORS.accent, '#06B6D4']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.startInner}
                >
                  <Ionicons name="play" size={18} color={COLORS.bg} style={{ marginRight: 8 }} />
                  <Text style={styles.startText}>Start Game</Text>
                  <Text style={styles.startCount}> · {playerCount} {playerCount === 1 ? 'player' : 'players'}</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>

            {/* The server refuses to start a room with no questions, so say so
                here rather than letting the press 400. */}
            {quizPending && (
              <Text style={styles.hostHint}>Pick a quiz before you start</Text>
            )}

            {/* Auto-assign is its own action, below START, and never starts the
                game. It only appears once there is a quiz to start, because
                before that there is no game to be ready for.

                Shuffling is deliberately NOT gated on unassigned.length: it
                redistributes every player evenly, so hiding it once the roster
                happens to be full would remove the only way to fix a lopsided
                split the host has already done by hand. */}
            {!quizPending && (
              <TouchableOpacity
                onPress={doAutoAssign}
                disabled={autoAssigning || players.length === 0}
                activeOpacity={0.8}
                style={[styles.autoAssign, players.length === 0 && { opacity: 0.5 }]}
                accessibilityLabel={`Auto-assign ${players.length} players`}
              >
                {autoAssigning ? (
                  <ActivityIndicator size="small" color={COLORS.textSecondary} />
                ) : (
                  <>
                    <Ionicons name="shuffle" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
                    <Text style={styles.autoAssignText}>
                      Auto-assign {players.length} {players.length === 1 ? 'player' : 'players'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {autoAssignDone && unassigned.length === 0 && !quizPending && (
              <Text style={styles.autoAssignDone}>Teams assigned · press Start when ready</Text>
            )}
          </View>
        ) : (
          <View style={styles.waitBar}>
            <Animated.View
              style={[styles.waitBarDot, {
                opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }],
              }]}
            />
            <Text style={styles.waitBarText}>
                {teamMode && !allAssigned ? 'Pick a team if you want one, or wait in the spectators' : 'Waiting for host to start...'}
            </Text>
          </View>
        )}
      </Animated.View>

      {/* Host quiz picker. Plain RN Modal: the existing <Modal> screens in this
          app put flex:1 content inside a non-transparent sheet, which clips to
          nothing useful. */}
      {showQuizPicker && (
        <View style={styles.pickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowQuizPicker(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Choose a quiz</Text>
            <ScrollView style={styles.pickerList} showsVerticalScrollIndicator={false}>
              {quizzes.length === 0 && (
                <Text style={styles.pickerEmpty}>
                  No quizzes yet. Create one and it will show up here.
                </Text>
              )}
              {quizzes.map(q => (
                <TouchableOpacity
                  key={q.id}
                  style={styles.pickerRow}
                  onPress={() => chooseQuiz(q.id)}
                  disabled={savingQuiz}
                >
                  <View style={styles.pickerRowInfo}>
                    <Text style={styles.pickerRowTitle} numberOfLines={1}>{q.title}</Text>
                    {!!q.question_count && (
                      <Text style={styles.pickerRowSub}>{q.question_count} questions</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pickerClose} onPress={() => setShowQuizPicker(false)}>
              <Text style={styles.pickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Joiner countdown overlay */}
      {showCountdown && (
        <View style={styles.countdownOverlay}>
          <Animated.View style={{ opacity: countdownAnim, transform: [{ scale: countdownAnim }] }}>
            <Text style={styles.countdownText}>{countdownValue}</Text>
          </Animated.View>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 24 },

  /* ── header ── */
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 },
  headerLeft: { flex: 1, paddingRight: 12 },
  // The lobby used to have no way out but the phone's back gesture, which is
  // exactly the gesture that left the Play tab pointing at a dead room.
  backBtn: { marginBottom: 6, alignSelf: 'flex-start' },
  kicker: {
    fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 2.5,
    color: COLORS.accent, marginBottom: 4,
  },
  title: { fontSize: 26, fontFamily: FONTS.black, color: COLORS.textPrimary, letterSpacing: -0.5 },
  countPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(34,211,238,0.1)', borderWidth: 1, borderColor: 'rgba(34,211,238,0.25)',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, marginTop: 2,
  },
  countPillText: { fontSize: 14, fontFamily: FONTS.extraBold, color: COLORS.accent },

  /* ── room code card ── */
  codeCard: {
    backgroundColor: COLORS.cardBg, borderRadius: 24, padding: 22,
    borderWidth: 1, borderColor: COLORS.cardBorder,
    position: 'relative', overflow: 'hidden', marginBottom: 26,
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45, shadowRadius: 24, elevation: 14,
  },
  cardEdge: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  codeTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  codeTab: { backgroundColor: COLORS.purplePrimary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  codeTabText: { color: COLORS.accent, fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(16,185,129,0.12)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
  },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  openText: { color: '#34D399', fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1 },

  codeChips: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
  codeChip: {
    width: 46, height: 58, borderRadius: 14,
    borderWidth: 2, borderColor: 'rgba(34,211,238,0.35)',
    backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: 'rgba(34,211,238,0.2)', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5, shadowRadius: 6, elevation: 3,
  },
  codeChipText: { fontSize: 26, fontFamily: FONTS.black, color: COLORS.textPrimary },
  codeHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', lineHeight: 17 },

  /* -- invite actions -- */
  codeActions: {
    flexDirection: 'row', gap: 10, marginTop: 14, justifyContent: 'center',
  },
  codeAction: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: 'rgba(34, 211, 238, 0.10)',
    borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.28)',
  },
  codeActionText: {
    fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textPrimary,
  },

  /* -- quiz selection card -- */
  quizCard: {
    backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: COLORS.cardBorder, gap: 12,
  },
  quizCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quizIconWrap: {
    width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.16)',
  },
  quizInfo: { flex: 1 },
  quizKicker: {
    fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 1,
  },
  quizTitle: {
    fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginTop: 2,
  },
  quizSub: {
    fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2,
  },
  quizAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 14,
    backgroundColor: COLORS.purplePrimary,
  },
  quizActionDisabled: { opacity: 0.6 },
  quizActionText: {
    fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textPrimary,
  },

  /* -- quiz picker sheet -- */
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 2, 15, 0.72)',
    justifyContent: 'flex-end',
    zIndex: 200,
    elevation: 200,
  },
  pickerSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34,
    borderTopWidth: 1, borderColor: COLORS.cardBorder,
    maxHeight: '78%',
  },
  pickerHandle: {
    width: 40, height: 4, borderRadius: 2, alignSelf: 'center',
    backgroundColor: COLORS.surfaceLight, marginBottom: 14,
  },
  pickerTitle: {
    fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 12,
  },
  pickerList: { flexGrow: 0 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: COLORS.cardBg, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  pickerRowInfo: { flex: 1 },
  pickerRowTitle: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  pickerRowSub: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  pickerEmpty: {
    fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted,
    textAlign: 'center', paddingVertical: 28, lineHeight: 20,
  },
  pickerClose: { marginTop: 10, alignItems: 'center', paddingVertical: 12 },
  pickerCloseText: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.textMuted },

  /* ── team cards ── */
  teamCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 14,
    borderWidth: 1.5, marginBottom: 10, position: 'relative', overflow: 'hidden',
  },
  teamDot: { width: 14, height: 14, borderRadius: 7 },
  teamInfo: { flex: 1 },
  teamName: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary, flexShrink: 1 },
  teamScoreCol: { alignItems: 'center' },
  teamScore: { fontSize: 15, fontFamily: FONTS.extraBold, color: COLORS.textPrimary },
  teamScoreLabel: { fontSize: 9, fontFamily: FONTS.extraBold, letterSpacing: 1, color: COLORS.textMuted, marginTop: 2 },
  joinChip: {
    backgroundColor: 'rgba(34,211,238,0.12)', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(34,211,238,0.35)',
    paddingHorizontal: 10, paddingVertical: 5,
  },
  joinChipYou: { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.4)' },
  joinChipFull: { backgroundColor: 'rgba(148,163,184,0.1)', borderColor: 'rgba(148,163,184,0.25)' },
  joinChipText: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.accent },
  joinChipTextYou: { color: '#34D399' },
  playerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerTeamDot: { width: 8, height: 8, borderRadius: 4 },

  /* ── roster ── */
  rosterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  rosterKicker: { fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 2, color: COLORS.textSecondary },
  waitingTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waitingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.warning },
  waitingTagText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textMuted },

  playerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: 'rgba(127,119,221,0.18)',
    marginBottom: 10, position: 'relative', overflow: 'hidden',
  },
  playerCardYou: { borderColor: 'rgba(34,211,238,0.4)' },
  playerCardEdge: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
    backgroundColor: 'rgba(34,211,238,0.5)',
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarYou: { backgroundColor: COLORS.accent },
  avatarText: { fontSize: 18, fontFamily: FONTS.black, color: '#fff' },
  avatarTextYou: { color: COLORS.bg },
  avatarImage: {
    width: 46, height: 46, borderRadius: 23,
  },
  playerInfo: { flex: 1 },
  playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  playerName: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary, flexShrink: 1 },
  youPill: {
    backgroundColor: 'rgba(34,211,238,0.15)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  youPillText: { fontSize: 9, fontFamily: FONTS.extraBold, letterSpacing: 1, color: COLORS.accent },
  playerSub: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },
  crown: { fontSize: 18 },
  readyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },

  ghostSeat: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: 'rgba(127,119,221,0.15)',
    borderStyle: 'dashed',
  },
  ghostAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(127,119,221,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  ghostText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted },

  /* ── bottom bar ── */
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(127,119,221,0.12)',
    backgroundColor: 'rgba(15,12,41,0.6)',
  },
  startWrap: {
    borderRadius: 16, overflow: 'hidden',
    shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  startInner: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  startInnerDisabled: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surfaceLight },
  startText: { color: COLORS.bg, fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  startTextDisabled: { color: COLORS.textMuted, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.2, textAlign: 'center' },
  startCount: { color: 'rgba(15,12,41,0.7)', fontSize: 14, fontFamily: FONTS.bold },
  // START and AUTO-ASSIGN stack in one column: starting and assigning are two
  // decisions, and the host has to be able to make them in either order.
  hostActions: { gap: 8 },
  hostHint: {
    fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.textMuted,
    textAlign: 'center', marginTop: 2,
  },
  autoAssign: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.32)',
    backgroundColor: 'rgba(148,163,184,0.10)',
  },
  autoAssignText: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textSecondary },
  autoAssignDone: {
    fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.success,
    textAlign: 'center', marginTop: 2,
  },

  waitBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 16, paddingVertical: 16,
    borderWidth: 1, borderColor: 'rgba(127,119,221,0.18)',
  },
  waitBarDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.warning },
  waitBarText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textSecondary },
  countdownOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,12,41,0.95)',
    justifyContent: 'center', alignItems: 'center',
  },
  countdownText: {
    fontSize: 120, fontFamily: FONTS.black, color: 'white',
    textShadowColor: COLORS.purplePrimary, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
});