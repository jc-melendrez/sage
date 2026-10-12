import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Platform, 
  StatusBar,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Alert,
  Animated,
  TextInput,
  Image,
} from 'react-native';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '@/config/api';
import { getToken, getCurrentUser } from '@/services/authService';
import NetInfo from '@react-native-community/netinfo';
import firestore from '@react-native-firebase/firestore';
import { cacheQuizzes, getCachedQuizzes, createOfflineGame } from '@/services/offlineGameService';
import * as Clipboard from 'expo-clipboard';
import { LanClientSession } from '@/services/lanClient';
import { lanGame, setLanClient, setLanHost, resetLanState, getLanClient, getLanHostServer, getLanHostInfo, setLanHostInfo, setLastLanRoster, setLanPlayerId, getLanPlayerId, setLanTeams } from '@/services/lanSession';
import { LanHostServer, makeOrder } from '@/services/lanHost';
import { LanMessage, LanPlayer, generateRoomCode } from '@/services/lanProtocol';
import { startScanning, stopScanning, startAdvertising, stopAdvertising, DiscoveredRoom } from '@/services/lanDiscovery';
import { buildQuestions } from '@/services/offlineEngine';
import { pfpSource } from '@/constants/pfps';
import JoinCodeInput, { JOIN_CODE_LENGTH, joinCodeToString } from '@/components/JoinCodeInput';
import { useCurrentUser } from '@/contexts/UserContext';
import { useTutorialTarget } from '@/components/TutorialSpotlight';
import { initialsOf } from '@/services/courseRoster';
import { leaveGameRoom } from '@/services/gameRoomService';

/** Deadline for a Play-screen POST; mirrors the one in game/lobby.tsx. */
const POST_TIMEOUT_MS = 45000;

// 🎨 SAGE Design System Colors
const COLORS = {
  bg: '#baaeda',
  bgSecondary: '#dad6e7',
  surface: '#FFFFFF',
  surfaceDim: '#F3F4F6',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#1F2937',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  border: 'rgba(44, 29, 0, 0.1)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

interface Quiz {
  id: number;
  title: string;
  quiz_type?: string;
  questions?: any[];
}

/**
 * Game modes the Play screen offers, in display order.
 *
 * Module scope so the array identity is stable across renders — it is a plain
 * constant, not something that has to be rebuilt from props or state.
 */
const GAME_MODES = [
  {
    id: 'classic',
    title: 'CLASSIC BATTLE',
    description: 'Host or join a room! Compete in real-time quiz battles with friends.',
    icon: 'game-controller' as const,
    active: true,
  },
  {
    id: 'group',
    title: 'GROUP MODE',
    description: 'Split into teams! Host or join a room and battle team vs team in real-time.',
    icon: 'people' as const,
    active: true,
  },
  {
    id: 'flashcards',
    title: 'SOLO MODE',
    description: 'Flip through flashcards and master any quiz at your own pace.',
    icon: 'albums' as const,
    active: true,
  },
  {
    id: 'time-attack',
    title: 'TIME ATTACK',
    description: 'Beat the clock! Answer as many questions as possible in 60 seconds.',
    icon: 'timer' as const,
    active: false,
  },
  {
    id: 'solo-practice',
    title: 'SOLO PRACTICE',
    description: 'Practice at your own pace. Master any topic with unlimited questions.',
    icon: 'person' as const,
    active: false,
  },
];

/**
 * Modes an educator gets. They run a class from the TV, so the two modes that
 * put a live room on screen are the whole job; the rest are a student playing.
 *
 * The unlisted modes are filtered out of the list rather than flipped to
 * `active: false`, which would render them greyed out behind a "SOON" badge and
 * imply the feature is coming for educators too.
 */
const EDUCATOR_GAME_MODES = new Set(['classic', 'group']);

export default function GameCenterScreen() {
  const router = useRouter();
  const {
    leftLobby: leftLobbyParam,
    courseId: courseIdParam,
    courseName: courseNameParam,
    rematchRoom: rematchRoomParam,
    rematchHost: rematchHostParam,
  } = useLocalSearchParams<{
    leftLobby?: string;
    courseId?: string;
    courseName?: string;
    rematchRoom?: string;
    rematchHost?: string;
  }>();
  const insets = useSafeAreaInsets();

  // Highlighted by the guided tutorial — the INVITE/JOIN/START bar is the one
  // control the "Play a Game" tour points at.
  const gameActionsTargetRef = useTutorialTarget('game-actions');

  /**
   * Educators reach this same screen to host, so the role decides what the
   * screen offers rather than which screen they land on: `app/(tabs)/games.tsx`
   * is a one-line re-export of this file, and /game is a root-stack screen, so
   * both roles share one Game Center.
   *
   * Gated on `loading` so a not-yet-resolved profile renders the student layout
   * for a frame instead of hiding the role-specific controls and then revealing
   * them. `is_educator` is the legacy flag the custom user model derives from
   * `role`, and is what app/settings.tsx and app/(tabs)/profile.tsx read.
   */
  const { user: currentProfile, loading: profileLoading } = useCurrentUser();
  const isEducator = !profileLoading
    && (currentProfile?.role === 'educator'
      || currentProfile?.role === 'superadmin'
      || !!currentProfile?.is_educator);

  /**
   * Set when an educator opens this screen from inside one of their classes
   * (`/game?courseId=12&courseName=Biology`).
   *
   * The picker is then LOCKED to that course: only its quizzes load, and the
   * room is archived under it so the game shows up in the class's Games tab.
   * There is deliberately no way to switch courses from here -- a game
   * archived under the wrong class is worse than no archive at all.
   *
   * Parsed with Number.isFinite because expo-router hands back whatever is in
   * the URL: a hand-typed `?courseId=Biology` would otherwise become NaN and
   * quietly produce `/ai/quizzes/?course=NaN`.
   */
  const parsedCourseId = Number(courseIdParam);
  const courseId = Number.isFinite(parsedCourseId) && parsedCourseId > 0
    ? parsedCourseId
    : null;
  const courseName = courseId ? (courseNameParam || null) : null;

  // --- State ---
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [timePerQuestion, setTimePerQuestion] = useState('15');
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [usingCachedQuizzes, setUsingCachedQuizzes] = useState(false);
  
  // Modal States
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [showQuizDropdown, setShowQuizDropdown] = useState(false);
  const [teamCount, setTeamCount] = useState(2);
  const [teamCountDraft, setTeamCountDraft] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState<string[]>(() => Array(JOIN_CODE_LENGTH).fill(''));
  const [joining, setJoining] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomTopic, setRoomTopic] = useState<string>('');
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string>('');
  const [currentUserInitial, setCurrentUserInitial] = useState<string>('');

  // Joined room state
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [roomMode, setRoomMode] = useState<'classic' | 'group' | null>(null);
  // The mode a LAN joiner is locked into. The online twin of `roomMode`, driven
  // by the host's `mode` broadcast (and the `welcome` teamMode), so a joiner's
  // mode card re-tints live when the host switches classic <-> group.
  const [lanMode, setLanMode] = useState<'classic' | 'group' | null>(null);
  const [roomHostId, setRoomHostId] = useState<number | string | null>(null);
  // The mode-config list is a different ScrollView from the preset list, and
  // the custom team-count field is the last thing in it -- so that field is the
  // one that has to be scrolled back into view when it takes focus.
  const modesScrollRef = useRef<ScrollView>(null);
  const [lanName, setLanName] = useState('Player');
  const lanRoomsRef = useRef<DiscoveredRoom[]>([]);
  const lanHostRef = useRef<LanHostServer | null>(null);
  const lanPlayerCountRef = useRef(0);
  const [lanPlayerCount, setLanPlayerCount] = useState(0);
  const [lanJoined, setLanJoined] = useState<LanPlayer[]>([]);
  const [isJoinedLan, setIsJoinedLan] = useState(() => {
    const c = getLanClient();
    return !!c && c.connected && !lanGame.quiz;
  });
  const myLanIdRef = useRef<string | null>(null);
  const lanNavPushedRef = useRef(false);
  // The host pressed START in group play: the room document's `lobbyOpen` (or a
  // LAN `lobby` message) has pulled this screen toward /game/lobby. Latched so
  // the re-firing room listener does not navigate a second time.
  const wentToLobbyRef = useRef(false);
  // Bumped every time a group lobby create starts, so a create that resolves
// after the host has already changed their mind cannot navigate or write state.
const lobbyTokenRef = useRef(0);
  const lanClientMsgRef = useRef<(msg: LanMessage) => void>(() => {});
  const lanHostMsgRef = useRef<(msg: LanMessage) => void>(() => {});

  const onLanHostMessage = (msg: LanMessage) => {
    if (msg.t === 'roster') {
      const connected = msg.players.filter(p => p.connected);
      lanPlayerCountRef.current = connected.length;
      setLanPlayerCount(connected.length);
      setLanJoined(connected);
      setLastLanRoster(connected);
    } else if (msg.t === 'teams') {
      setLanTeams(msg.teams);
    } else if (msg.t === 'error') {
      Alert.alert('LAN Error', msg.message || 'Unexpected error');
    }
  };
  lanHostMsgRef.current = onLanHostMessage;

  // When the JOIN modal opens, listen for LAN rooms on the hotspot so a
  // typed code can join an offline game the same way an online one does.
  useEffect(() => {
    if (!showJoinModal) return;
    const ok = startScanning(rooms => {
      lanRoomsRef.current = rooms;
    });
    if (!ok) lanRoomsRef.current = [];
    (async () => {
      const user = await getCurrentUser();
      if (user?.first_name) setLanName(user.first_name);
    })();
    return () => {
      stopScanning();
      lanRoomsRef.current = [];
    };
  }, [showJoinModal]);

  // Clean up the LAN host server and any joined client when Game Center unmounts.
  useEffect(() => {
    return () => {
      lanHostRef.current?.stop();
      lanHostRef.current = null;
      setLanHost(null);
      getLanClient()?.disconnect();
      setLanClient(null);
      setLanJoined([]);
      stopAdvertising();
    };
  }, []);

  // Countdown State
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const animateNumber = useCallback((callback: () => void) => {
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.5);

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 40, useNativeDriver: true })
    ]).start(() => {
      setTimeout(callback, 200); // Small pause between numbers
    });
  }, [fadeAnim, scaleAnim]);

  // Latch for the joined-player countdown below. Firestore re-fires the room
  // listener on every document update, and status stays 'active' for the whole
  // game, so the naive "if active, count down" restarted the 3-2-1 from 3 on
  // each one and issued a second navigation to the question screen.
  const countdownStartedRef = useRef(false);

  const startJoinedCountdown = useCallback((code: string) => {
    setShowCountdown(true);
    setCountdownValue(3);

    animateNumber(() => {
      setCountdownValue(2);
      animateNumber(() => {
        setCountdownValue(1);
        animateNumber(() => {
          setShowCountdown(false);
          router.replace({
            pathname: '/game/question' as any,
            params: { roomCode: code, isHost: 'false' }
          });
        });
      });
    });
  }, [animateNumber, router]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return () => unsub();
  }, []);

  // Read the avatar/initial off the shared profile context instead of a one-shot
  // getCurrentUser() local state, so saving a new name or avatar in edit-profile
  // (which publishes setUser) is reflected here the moment the Play tab mounts.
  useEffect(() => {
    if (currentProfile) {
      setCurrentUserId(currentProfile.id ?? null);
      setCurrentUserAvatar(currentProfile.avatar ?? '');
      const name =
        [currentProfile.first_name, currentProfile.last_name].filter(Boolean).join(' ') ||
        currentProfile.username ||
        '?';
      setCurrentUserInitial(initialsOf(name));
    } else {
      setCurrentUserId(null);
      setCurrentUserAvatar('');
      setCurrentUserInitial('?');
    }
  }, [currentProfile]);

  // Listen for players joining the online room so the top avatar slots update live.
  useEffect(() => {
    if (!roomCode) {
      setRoomPlayers([]);
      return;
    }
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        setRoomPlayers(snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? []);
      });
    return () => unsub();
  }, [roomCode]);

  // Room doc listener for joined players — mode, status, hostId.
  //
  // `mode` is the source of truth (falling back to `teamMode` only for an older
  // room that predates the field). Reading `teamMode` first made the derivation
  // sticky: once a group room existed, switching back to classic never cleared
  // the card because `teamMode` is not deleted, only set false.
  useEffect(() => {
    if (!joinedRoom || !roomCode) return;
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .onSnapshot(snap => {
        if (!snap.exists) {
          // Room deleted — reset joined state
          countdownStartedRef.current = false;
          wentToLobbyRef.current = false;
          setJoinedRoom(false);
          setRoomCode(null);
          setRoomMode(null);
          return;
        }
        const d = snap.data();
        if (!d) return;
        const nextMode: 'classic' | 'group' =
          d.mode != null
            ? (d.mode === 'group' ? 'group' : 'classic')
            : (d.teamMode ? 'group' : 'classic');
        setRoomMode(nextMode);
        setRoomHostId(d.hostId ?? null);
        if (d.status !== 'active') {
          // Room went back to the lobby (reset, rematch) -- the next run counts
          // down again.
          countdownStartedRef.current = false;
        }
        if (nextMode === 'group') {
          // The host pressed START and opened the lobby: follow them in so the
          // joiner picks a team from the same screen the host sees. The lobby
          // owns the countdown from there.
          if (d.lobbyOpen && !wentToLobbyRef.current) {
            wentToLobbyRef.current = true;
            router.push({ pathname: '/game/lobby', params: { roomCode, isHost: 'false' } } as any);
          }
        } else if (d.status === 'active' && !countdownStartedRef.current) {
          countdownStartedRef.current = true;
          startJoinedCountdown(roomCode);
        }
      });
    return () => unsub();
  }, [joinedRoom, roomCode, startJoinedCountdown, router]);

  const fetchQuizzes = useCallback(async () => {
    setLoadingQuizzes(true);
    try {
      const token = await getToken();
      // A course-scoped picker asks the server for exactly that course's
      // quizzes. `course` is the filter the backend already supports on
      // /ai/quizzes/ (used by the course Quizzes tab), so there is no new
      // endpoint here.
      const query = courseId ? `?course=${courseId}` : '';
      const res = await fetch(`${API_BASE_URL}/ai/quizzes/${query}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setQuizzes(data);
          setUsingCachedQuizzes(false);
          if (!courseId) {
            // Never cache a course-locked list into the shared flat cache, and
            // never repopulate it from one: see the fallback below.
            cacheQuizzes(data);
          }
          // No implicit "pick the first one for you" — the selector has to say
          // which quiz is being played, otherwise the host starts a game on a
          // quiz nobody chose. The guard in startGame reports it instead.
          //
          // Reconciled only against a list we actually trust. This used to
          // null the selection on *any* response missing the quiz, and since
          // useFocusEffect refetches every time the screen regains focus,
          // leaving a group lobby and coming back could drop a valid pick on a
          // transient failure — which is what made Start then report "no quiz
          // selected" for a quiz the student had in fact chosen.
          setSelectedQuiz(prev => (!prev || data.some(q => q.id === prev.id) ? prev : null));
          setLoadingQuizzes(false);
          return;
        }
      }
    } catch (error) {
      console.error("Failed to load quizzes", error);
    }
    // Fall through to the cache. Whatever the student had selected is still
    // valid, so it is left alone rather than thrown away with the list.
    //
    // NOT done when courseId is set. The cache is one flat list of every quiz
    // the user owns or is shared into, with no course on any entry, so falling
    // back to it would silently widen a picker the host was told was locked to
    // their class -- and the game would then be archived under that class while
    // running a quiz from another one. An empty list is the honest answer here.
    if (courseId) {
      setQuizzes([]);
      setUsingCachedQuizzes(false);
      setLoadingQuizzes(false);
      return;
    }
    const cached = getCachedQuizzes();
    if (cached.length > 0) {
      setQuizzes(cached);
      setUsingCachedQuizzes(true);
    }
    setLoadingQuizzes(false);
  }, [courseId]);

  useFocusEffect(
    useCallback(() => {
      fetchQuizzes();
    }, [fetchQuizzes])
  );

  /**
   * Coming back from a lobby the host abandoned.
   *
   * START below treats any non-null room code as "reuse this room". The lobby
   * returns with leftLobby=1 (from its back button and its hardware-back
   * handler) precisely so that code is dropped instead of quietly hijacking
   * whatever the student starts next.
   */
  useEffect(() => {
    if (leftLobbyParam !== '1') return;
    lobbyTokenRef.current += 1;
    setRoomCode(null);
    setRoomTopic('');
    setRoomMode(null);
    setRoomHostId(null);
    setRoomPlayers([]);
    setSelectedMode(null);
    setIsCreatingRoom(false);
    router.setParams({ leftLobby: undefined });
  }, [leftLobbyParam, router]);

  /**
   * Coming back from a completed game's "Play Again".
   *
   * The rematch endpoint has already reset the room to 'waiting' and kept the
   * whole roster, so this only has to adopt the same code again: the host's
   * START reuses it (the `!roomCode` branch in handleStartPress is skipped).
   * Both roles land on the Play tab so the host can re-pick the mode -- exactly
   * like a classic rematch -- so the mode is read back off the room rather than
   * assumed to be classic. `rematchHost` keeps the two roles apart -- the host
   * stays out of `joinedRoom` so START is on screen.
   */
  useEffect(() => {
    if (!rematchRoomParam) return;
    lobbyTokenRef.current += 1;
    const code = rematchRoomParam;
    setRoomCode(code);
    setRoomTopic('');
    setJoinedRoom(rematchHostParam !== '1');
    setActiveTab('presets');
    wentToLobbyRef.current = false;
    router.setParams({ rematchRoom: undefined, rematchHost: undefined });
    firestore()
      .collection('gameRooms')
      .doc(code)
      .get()
      .then(snap => {
        const d = snap.data();
        const m: 'classic' | 'group' =
          d?.mode === 'group' || (d?.mode == null && d?.teamMode) ? 'group' : 'classic';
        setRoomMode(m);
        setSelectedMode(m);
      })
      .catch(() => {
        setRoomMode('classic');
        setSelectedMode('classic');
      });
  }, [rematchRoomParam, rematchHostParam, router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchQuizzes();
    } finally {
      setRefreshing(false);
    }
  }, [fetchQuizzes]);

  // --- Handlers ---
  
  // 1. Handle Mode Click -> select a mode and, on a live room, reconfigure it.
  //
  // The mode is no longer baked once: a host who changes their mind after
  // students have joined reconfigures the same room instead of orphaning the
  // code they typed. Online that is POST /game/mode/; over LAN the host server
  // reconfigures and broadcasts `mode` so joiners' cards re-tint live.
  const handleModePress = (modeId: string) => {
    if (modeId === 'flashcards') {
      router.push('/flashcards');
      return;
    }
    if (modeId !== 'classic' && modeId !== 'group') {
      Alert.alert('Coming Soon', 'This mode is under development!');
      return;
    }

    setSelectedMode(modeId);
    setActiveTab('custom');

    const lanHost = lanHostRef.current;
    if (lanHost) {
      lanHost.setMode(modeId, teamCount);
      setLanMode(modeId);
      return;
    }
    if (roomCode && !joinedRoom) {
      post('mode/', {
        roomCode,
        mode: modeId,
        ...(modeId === 'group' ? { teamCount } : {}),
      })
        .then(() => setRoomMode(modeId))
        .catch((e: any) => Alert.alert('Error', e?.message || 'Could not change the game mode'));
    }
  };

  /**
   * Returns the chosen quiz when mode + quiz are both set, or null after
   * showing an alert that names the missing pieces. A single generic "select
   * a mode and quiz" message was unhelpful because you could not tell which
   * one was the problem.
   *
   * Returning the quiz also narrows the type for the callers below, which
   * would otherwise need their own `if (!selectedQuiz)` just to satisfy TS.
   */
  const requirePlaySelections = (): Quiz | null => {
    const missing: string[] = [];
    if (!selectedMode) missing.push('a game mode (Classic or Teams)');
    if (!selectedQuiz) missing.push('a quiz');
    if (missing.length === 0) return selectedQuiz;
    Alert.alert(
      missing.length === 2 ? 'Nothing Selected Yet' : 'Almost There',
      `Please choose ${missing.join(' and ')} before starting a game.`,
    );
    return null;
  };

  /**
   * Creates the online room for `quiz` and adopts it as the screen's current
   * room, so a later START reuses the code the educator already shared.
   *
   * The mode is written to the room document because that document — not this
   * component — is what joined players read to know what they joined.
   */
  const createOnlineRoom = async (quiz: Quiz) => {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}/game/create/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        quizId: quiz.id,
        timePerQuestion: parseInt(timePerQuestion) || 15,
        teamMode: selectedMode === 'group' ? 'true' : 'false',
        // Players choose their own team in the lobby. Auto-assign stays
        // available as a "let the host decide" option, not the default.
        autoAssignTeams: 'false',
        ...(selectedMode === 'group' ? { teamCount } : {}),
        // Files the game under a class. The server ignores this for a student
        // and 403s another educator, so it is safe to always send.
        ...(courseId ? { courseId } : {}),
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create room');

    setRoomCode(data.roomCode);
    setRoomTopic(data.topic || quiz.title);
    firestore()
      .collection('gameRooms')
      .doc(data.roomCode)
      .update({ mode: selectedMode === 'group' ? 'group' : 'classic' })
      .catch(() => {});
    return { code: data.roomCode as string, topic: data.topic || quiz.title };
  };

  /**
   * An educator has no LAN or offline-solo path on this screen, so a dropped
   * connection cannot fall back to anything: both would end in a hotspot game
   * the class cannot see. Fail with a reason instead of letting the room-create
   * fetch throw "Network request failed".
   *
   * Returns true when it has already reported the problem, so callers can
   * `if (blockEducatorOffline()) return;`.
   *
   * Only `isOffline` counts, not `usingCachedQuizzes`: that flag also trips
   * when the quiz list fell back to cache while still online, and an online
   * educator can host perfectly well off the cached list.
   */
  const blockEducatorOffline = () => {
    if (!isEducator || !isOffline) return false;
    Alert.alert(
      'No Connection',
      'Hosting a game needs an internet connection. Reconnect and try again.',
    );
    return true;
  };

  /**
   * Hands the educator off to /educator/host-session, which is the screen that
   * owns the Start and End controls, the TV link, and the teacher-only powerup
   * pool.
   *
   * Deliberately does NOT call /game/start/ the way the student host path does.
   * Starting here would collapse the invite-then-start window this screen exists
   * to provide: the educator would land on an already-active room with nobody in
   * it, and host-session would have nothing left to manage.
   *
   * Group mode routes here too rather than to /game/lobby — host-session already
   * renders team standings and offers to auto-assign anyone who never picked a
   * team. Routing it to the lobby instead would put the educator in a screen
   * whose back button returns to '/games', which the root layout then bounces
   * to /educator/dashboard (app/_layout.tsx:126-128) mid-game.
   */
  const startEducatorSession = async () => {
    const quiz = requirePlaySelections();
    if (!quiz) return;

    setIsCreatingRoom(true);
    try {
      const { code, topic } = roomCode
        ? { code: roomCode, topic: roomTopic }
        : await createOnlineRoom(quiz);
      router.push({
        pathname: '/educator/host-session',
        params: { roomCode: code, topic },
      } as any);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not open the host session');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // 2. Handle Invite Press -> Create Room (if needed) & Show Code Modal
  const handleInvitePress = async () => {
    const quiz = requirePlaySelections();
    if (!quiz) return;
    if (blockEducatorOffline()) return;

    if ((isOffline || usingCachedQuizzes) && !isEducator) {
      // A host left over from a finished session is not reusable: its server was
      // stopped, so it holds no listener. Drop it so a fresh one is created (and
      // the port is released) instead of advertising a dead room.
      const existingHost = lanHostRef.current;
      if (existingHost && !existingHost.isAlive) {
        try {
          existingHost.stop();
        } catch {}
        lanHostRef.current = null;
      }
      if (!lanHostRef.current) {
        setLanJoined([]);
        const code = generateRoomCode();
        let hostName = 'Host';
        let hostAvatar = currentUserAvatar;
        try {
          const user = await getCurrentUser();
          if (user?.first_name) hostName = user.first_name;
          hostAvatar = user?.avatar ?? currentUserAvatar;
        } catch {}
        const host = new LanHostServer(code, { name: hostName || 'Host', avatar: hostAvatar });
        host.onMessage(msg => lanHostMsgRef.current(msg));
        try {
          host.start();
        } catch {}
        lanHostRef.current = host;
        startAdvertising(code, selectedQuiz?.title || 'LAN Quiz', () => lanPlayerCountRef.current);
        setRoomCode(code);
        setRoomTopic(selectedQuiz?.title || 'LAN Quiz');
      }
      setShowInviteModal(true);
      return;
    }
    // If room already exists, just show the modal
    if (roomCode) {
      setShowInviteModal(true);
      return;
    }

    setIsCreatingRoom(true);
    try {
      await createOnlineRoom(quiz);
      setShowInviteModal(true); // Show the code immediately
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // 3. Handle Start Press -> Start Game & Countdown
  const handleStartPress = async () => {
    // Educators hand off to host-session instead of starting the game here.
    // First, because the LAN/offline branch below would otherwise send an
    // offline educator into a solo game; second, because starting here would
    // skip the invite-then-start window host-session is built around.
    if (isEducator) {
      if (blockEducatorOffline()) return;
      await startEducatorSession();
      return;
    }

    // Offline/LAN GROUP: team rooms belong to the lobby, exactly like the
    // online Play tab. Without this the group selection fell straight into the
    // solo countdown (offline) or a teamless LAN broadcast, so the team boxes
    // never appeared. Classic offline/LAN keep their existing behavior below.
    if (selectedMode === 'group' && (isOffline || usingCachedQuizzes)) {
      await startLanGroupLobby();
      return;
    }

    const host = lanHostRef.current;
    // If players have joined over LAN, START must always broadcast to them,
    // regardless of the internet/offline state toggling between INVITE and START.
    const lanHostActive = host !== null && host.playerCount > 0;
    if (lanHostActive || isOffline || usingCachedQuizzes) {
      if (!host) {
        console.log('[game/index] START path: offline-solo (no LAN host)');
        startOfflineGame();
        return;
      }
      console.log(`[game/index] START path: lan-broadcast (players=${host.playerCount})`);
      const quiz = requirePlaySelections();
      if (!quiz) return;
      const count = buildQuestions(quiz).length;
      if (count === 0) {
        Alert.alert('Empty Quiz', 'That quiz has no valid questions.');
        return;
      }
      let hostName = 'Host';
      try {
        const user = await getCurrentUser();
        if (user?.first_name) hostName = user.first_name;
      } catch {}
      const time = parseInt(timePerQuestion, 10) || 15;
      const order = makeOrder(count);
      host.setQuiz(quiz, order, time);
      setLanHost(host);
      lanGame.quiz = quiz;
      lanGame.order = order;
      lanGame.timePerQuestion = time;
      lanGame.playerName = hostName;
      lanGame.playerAvatar = currentUserAvatar;
      lanGame.role = 'student';
      lanGame.selfPlay = true;
      lanGame.hostIp = '';
      lanGame.roomCode = roomCode || '';
      stopAdvertising();
      // The host must be registered as a player BEFORE the game starts, or the
      // server rejects its own hello as "already started" and the host never
      // shows up on the leaderboard. On a rematch the host is already seated --
      // resetForRematch keeps the roster -- so re-join only when there is no live
      // self-client, otherwise the host would appear twice.
      if (!getLanClient()?.connected) {
        let hostJoined = false;
        const client = new LanClientSession(msg => {
          if (msg.t === 'welcome') {
            hostJoined = true;
            setLanPlayerId(msg.playerId);
          }
        });
        setLanClient(client);
        try {
          await client.connect('127.0.0.1');
          client.join(lanGame.roomCode, hostName, currentUserAvatar);
          const deadline = Date.now() + 3000;
          while (!hostJoined && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 25));
          }
        } catch {}
      }
      host.startGame();
      router.push({ pathname: '/game/question', params: { lan: 'true', roomCode: lanGame.roomCode } } as any);
      return;
    }

    /**
     * Create a room for `quiz` and start it.
     *
     * The room is created with the quiz already attached (unlike the custom
     * lobby's `deferQuiz` room), so the host can pick a quiz and press START
     * from this screen in one go. Team rooms carry `teamCount` so the server
     * builds the right number of teams.
     */
    const createRoomFor = async (quiz: Quiz, teamCountVal: number) => {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/create/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          quizId: quiz.id,
          timePerQuestion: parseInt(timePerQuestion) || 15,
          teamMode: selectedMode === 'group' ? 'true' : 'false',
          autoAssignTeams: 'false',
          ...(selectedMode === 'group' ? { teamCount: teamCountVal } : {}),
          ...(courseId ? { courseId } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create room');
      setRoomCode(data.roomCode);
      setRoomTopic(data.topic || quiz.title);
      return data.roomCode as string;
    };

    const createAndStartFor = async (quiz: Quiz, teamCountVal: number) => {
      setIsCreatingRoom(true);
      try {
        const code = await createRoomFor(quiz, teamCountVal);
        await startGameSequence(code);
      } catch (error: any) {
        Alert.alert("Error", error.message);
        setIsCreatingRoom(false);
      }
    };

    if (!roomCode) {
      // If no room exists, create one first silently
      const quiz = requirePlaySelections();
      if (!quiz) return;

      // For group mode, also require team count selection
      if (selectedMode === 'group' && teamCount == null) {
        Alert.alert('Almost There', 'Please choose the number of teams before starting a game.');
        return;
      }

      // Teams deliberately do NOT start here. Creating the room is only the
      // first half; the host still has to put people on seats in the lobby, and
      // that window closes on its own timer. Starting immediately meant the
      // team boxes existed for a single frame and no one ever picked one.
      if (selectedMode === 'group') {
        setIsCreatingRoom(true);
        try {
          const code = await createRoomFor(quiz, teamCount);
          // Signal open-lobby so joiners waiting on the Play tab follow the
          // host into /game/lobby and pick their teams there.
          firestore()
            .collection('gameRooms')
            .doc(code)
            .update({ mode: 'group', lobbyOpen: true })
            .catch(() => {});
          router.push({
            pathname: '/game/lobby',
            params: { roomCode: code, isHost: 'true', topic: quiz.title, myId: String(currentUserId ?? '') },
          } as any);
        } catch (error: any) {
          Alert.alert('Error', error.message);
        } finally {
          setIsCreatingRoom(false);
        }
        return;
      }

      await createAndStartFor(quiz, teamCount);
    } else if (selectedMode === 'group') {
      // An existing group room still owes us the team-pick window. Opening the
      // lobby is also the signal joiners are waiting on.
      firestore()
        .collection('gameRooms')
        .doc(roomCode)
        .update({ mode: 'group', lobbyOpen: true })
        .catch(() => {});
      router.push({
        pathname: '/game/lobby',
        params: { roomCode, isHost: 'true', topic: roomTopic, myId: String(currentUserId ?? '') },
      } as any);
    } else {
      // Room already exists -- classic, so it can just be started.
      startGameSequence(roomCode);
    }
  };

  /**
   * Open a LAN team lobby from the offline Play tab.
   *
   * Mirrors the online group path (create host -> /game/lobby) but over the
   * peer-to-peer LAN layer: create the host server and advertise the code,
   * bind the quiz so the lobby's START can broadcast it, and seat the host as
   * a player up front so it can claim a team like everyone else. Classic mode
   * never reaches this -- it keeps the solo/broadcast shortcuts below.
   */
  const startLanGroupLobby = async () => {
    const quiz = requirePlaySelections();
    if (!quiz) return;
    if (teamCount == null) {
      Alert.alert('Almost There', 'Please choose the number of teams before starting a game.');
      return;
    }

    let hostName = lanGame.playerName || 'Host';
    let hostAvatar = currentUserAvatar;
    try {
      const user = await getCurrentUser();
      if (user?.first_name) hostName = user.first_name;
      hostAvatar = user?.avatar ?? currentUserAvatar;
    } catch {}

    // Reuse a live host (e.g. players already joined via INVITE), but never a
    // dead one. A finished session leaves a stopped host in the ref; reusing it
    // produced a lobby with no players, and letting a fresh host bind LAN_PORT
    // while its predecessor still listened produced "Server error: undefined".
    let host = lanHostRef.current;
    if (host && !host.isAlive) {
      try {
        host.stop();
      } catch {}
      lanHostRef.current = null;
      host = null;
    }
    const code = host?.roomCode || generateRoomCode();
    if (!host) {
      host = new LanHostServer(code, { name: hostName || 'Host', avatar: hostAvatar });
      host.onMessage(msg => lanHostMsgRef.current(msg));
      try {
        host.start();
      } catch {}
      lanHostRef.current = host;
      startAdvertising(code, quiz.title || 'LAN Quiz', () => lanPlayerCountRef.current);
    }
    setLanHost(host);
    // Switch the live host to group (creating and broadcasting the teams) and
    // open the lobby. `openLobby` is what pulls LAN joiners off the Play tab;
    // the `mode` broadcast it triggers re-tints their locked mode card.
    host.setMode('group', teamCount);
    setLanTeams(host.teams);
    setLanMode('group');
    host.openLobby(quiz.title || 'LAN Quiz');

    const count = buildQuestions(quiz).length;
    const time = parseInt(timePerQuestion, 10) || 15;
    const order = makeOrder(count);
    host.setQuiz(quiz, order, time);
    lanGame.quiz = quiz;
    lanGame.order = order;
    lanGame.timePerQuestion = time;
    lanGame.playerName = hostName;
    lanGame.playerAvatar = hostAvatar;
    lanGame.role = 'student';
    lanGame.selfPlay = true;
    lanGame.hostIp = '';
    lanGame.roomCode = code;
    setRoomCode(code);
    setRoomTopic(quiz.title || 'LAN Quiz');

    // Seat the host as a real player BEFORE the lobby mounts, so it shows up
    // in the roster and can claim a team. The lobby's own quiz/countdown
    // handling then drives host and joiners through the same broadcast.
    let myId = getLanPlayerId();
    if (!getLanClient()?.connected) {
      setLanJoined([]);
      let hostJoined = false;
      const client = new LanClientSession(msg => {
        if (msg.t === 'welcome') {
          hostJoined = true;
          myId = msg.playerId;
          setLanPlayerId(msg.playerId);
        }
      });
      setLanClient(client);
      try {
        await client.connect('127.0.0.1');
        client.join(code, hostName, hostAvatar);
        const deadline = Date.now() + 3000;
        while (!hostJoined && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 25));
        }
      } catch {}
    }

    router.push({
      pathname: '/game/lobby',
      params: { roomCode: code, isHost: 'true', teamMode: 'true', lan: 'true', topic: quiz.title || 'LAN Quiz', myId: String(myId) },
    } as any);
  };

  const startGameSequence = async (code: string) => {
    setIsCreatingRoom(true);
    console.log('[game/index] START path: online-firestore');
    try {
      const token = await getToken();
      // Call backend to start the game
      const res = await fetch(`${API_BASE_URL}/game/start/`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ roomCode: code }),
      });
      
      if (!res.ok) {
         const err = await res.json();
         throw new Error(err.error || "Failed to start game");
      }

      // Success! Show Countdown
      setIsCreatingRoom(false);
      runCountdown(code);

    } catch (error: any) {
      Alert.alert("Start Failed", error.message);
      setIsCreatingRoom(false);
    }
  };

  const runCountdown = (code: string, extraParams: Record<string, string> = {}, targetPath = '/game/question' as any) => {
    setShowCountdown(true);
    setCountdownValue(3);
    
    // Animate 3
    animateNumber(() => {
      setCountdownValue(2);
      // Animate 2
      animateNumber(() => {
        setCountdownValue(1);
        // Animate 1
        animateNumber(() => {
          // Go!
          setShowCountdown(false);
          router.replace({ 
            pathname: targetPath, 
            params: { roomCode: code, isHost: 'true', ...extraParams } 
          });
        });
      });
    });
  };

  const startOfflineGame = () => {
    const quiz = requirePlaySelections();
    if (!quiz) return;
    console.log('[game/index] START path: offline-solo');
    const time = parseInt(timePerQuestion, 10) || 15;
    try {
      createOfflineGame(quiz, time);
    } catch (error: any) {
      Alert.alert("Can't Play Offline", error.message);
      return;
    }
    runCountdown('OFFLINE', { offline: 'true', quizTitle: quiz.title }, '/game/question' as any);
  };

  const copyCode = async () => {
    if (roomCode) {
      await Clipboard.setStringAsync(roomCode);
      Alert.alert("Copied!", "Room code copied to clipboard");
    }
  };

  const leaveLan = () => {
    getLanClient()?.disconnect();
    setLanClient(null);
    myLanIdRef.current = null;
    lanNavPushedRef.current = false;
    setIsJoinedLan(false);
    setLanJoined([]);
    setLanPlayerCount(0);
    lanPlayerCountRef.current = 0;
    resetLanState();
  };

  // Messages arriving from the LAN host while this screen is the joiner's lobby.
  const handleLanClientMsg = (msg: LanMessage) => {
    if (msg.t === 'welcome') {
      myLanIdRef.current = msg.playerId;
      setLanPlayerId(msg.playerId);
      setIsJoinedLan(true);
      setLanHostInfo({ name: msg.hostName, avatar: msg.hostAvatar });
      setLanMode(msg.teamMode ? 'group' : 'classic');
      // Stay on the Play tab for both classic and group until the host starts:
      // classic rides the 'quiz' broadcast into the game, group first pulls
      // everyone into the lobby via the `lobby` message below.
    } else if (msg.t === 'mode') {
      // The host changed classic <-> group while everyone is still waiting.
      setLanMode(msg.teamMode ? 'group' : 'classic');
    } else if (msg.t === 'roster') {
      const connected = msg.players.filter(p => p.connected);
      lanPlayerCountRef.current = connected.length;
      setLanPlayerCount(connected.length);
      setLanJoined(connected);
      setLastLanRoster(connected);
    } else if (msg.t === 'teams') {
      setLanTeams(msg.teams);
    } else if (msg.t === 'lobby') {
      setLanMode(msg.teamMode === false ? 'classic' : 'group');
      if (!lanNavPushedRef.current) {
        lanNavPushedRef.current = true;
        router.push({
          pathname: '/game/lobby',
          params: { roomCode: lanGame.roomCode, isHost: 'false', lan: 'true', topic: msg.topic ?? '' },
        } as any);
      }
    } else if (msg.t === 'quiz') {
      lanGame.quiz = msg.quiz;
      lanGame.order = msg.order;
      lanGame.timePerQuestion = msg.timePerQuestion;
      if (!lanNavPushedRef.current) {
        lanNavPushedRef.current = true;
        router.push({ pathname: '/game/question', params: { lan: 'true', roomCode: lanGame.roomCode } } as any);
      }
    } else if (msg.t === 'error') {
      Alert.alert('LAN Error', msg.message || 'Unexpected error');
      if (!lanNavPushedRef.current) leaveLan();
    } else if (msg.t === 'end') {
      if (!lanNavPushedRef.current) {
        Alert.alert('Game Ended', msg.reason || 'The host ended the game');
        leaveLan();
      }
    }
  };
  lanClientMsgRef.current = handleLanClientMsg;

  // If a live LAN client exists (screen refocused mid-session -- e.g. after a
  // rematch sent this device back to the Play tab), re-attach the handler so
  // mode/lobby/quiz broadcasts keep flowing. If a finished/abandoned LAN game is
  // leftover, tear the session down so the next INVITE/START/JOIN builds a fresh
  // room instead of reusing a stale one.
  useFocusEffect(
    useCallback(() => {
      const c = getLanClient();
      const hosting = getLanHostServer() != null;
      if (c && c.connected && !lanGame.quiz) {
        // A joiner keeps listening for the host's next broadcasts; the host has
        // its own self-client but drives its UI through the host's message
        // listener, so it must not adopt the joiner handler (which would
        // navigate the host into the lobby as a guest). Either way the next
        // quiz/lobby may navigate this screen again, so release the latch.
        lanNavPushedRef.current = false;
        if (!hosting) c.onEvent = lanClientMsgRef.current;
      } else if (lanGame.quiz) {
        lanHostRef.current?.stop();
        lanHostRef.current = null;
        getLanClient()?.disconnect();
        setLanClient(null);
        myLanIdRef.current = null;
        lanNavPushedRef.current = false;
        setIsJoinedLan(false);
        setLanJoined([]);
        setLanPlayerCount(0);
        lanPlayerCountRef.current = 0;
        resetLanState();
      }
    }, [])
  );

  const tryJoinLan = (code: string): Promise<boolean> =>
    new Promise<boolean>(async resolve => {
      const room = lanRoomsRef.current.find(r => r.code === code && !r.started);
      if (!room) {
        resolve(false);
        return;
      }
      try {
        getLanClient()?.disconnect();
        resetLanState();
        lanNavPushedRef.current = false;
        const client = new LanClientSession(lanClientMsgRef.current);
        setLanClient(client);
        await client.connect(room.hostIp);
        client.join(code, lanName, currentUserAvatar);
        lanGame.playerName = lanName;
        lanGame.playerAvatar = currentUserAvatar;
        lanGame.hostIp = room.hostIp;
        lanGame.roomCode = code;
        lanGame.role = 'player';
        setShowJoinModal(false);
        setJoinCode(Array(JOIN_CODE_LENGTH).fill(''));
        resolve(true);
      } catch {
        setLanClient(null);
        resolve(false);
      }
    });

  const handleJoin = async () => {
    const code = joinCodeToString(joinCode);
    if (code.length !== JOIN_CODE_LENGTH) {
      Alert.alert('Incomplete Code', `Room codes are ${JOIN_CODE_LENGTH} characters. You've entered ${code.length}.`);
      return;
    }
    setJoining(true);
    try {
      if (isOffline || usingCachedQuizzes) {
        const joined = await tryJoinLan(code);
        if (!joined) {
          Alert.alert(
            'No Room Nearby',
            `Room ${code} wasn't found near you. Join the host's hotspot/Wi-Fi and make sure the host screen is open.`
          );
        }
        return;
      }
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/join/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ roomCode: code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to join room');
      setShowJoinModal(false);
      setJoinCode(Array(JOIN_CODE_LENGTH).fill(''));

      // Stay on the Play tab for BOTH classic and group. The joiner's mode card
      // shows what the host chose (and stays locked), and when the host starts
      // a group game the room's `lobbyOpen` flag pulls this screen into the
      // lobby so teams are picked there -- the same screen the host sees.
      setRoomCode(code);
      setRoomTopic(data.topic || '');
      setJoinedRoom(true);
      setRoomMode(data.teamMode ? 'group' : 'classic');
      setSelectedMode(data.teamMode ? 'group' : 'classic');
      setActiveTab('presets');
      wentToLobbyRef.current = false;
    } catch (error: any) {
      console.warn('Join fell back to LAN after server error', error);
      const joined = await tryJoinLan(code);
      if (!joined) {
        Alert.alert(
          "Couldn't Join",
          `The online server couldn't be reached and no nearby room "${code}" was found. Open the host screen on the other phone - Game Center, then INVITE - and keep it on screen, then try again.`
        );
      }
    } finally {
      setJoining(false);
    }
  };

  const handleLeaveRoom = () => {
    Alert.alert(
      'Leave Room',
      'Are you sure you want to leave this room?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            // Removes us from our team, deletes our player document and hands
            // the room over if we were hosting it. Shared with the final
            // screen's Back to Game Center so both teardown paths match.
            await leaveGameRoom(roomCode, currentUserId);
            // Reset joined room state
            setJoinedRoom(false);
            setRoomCode(null);
            setRoomTopic('');
            setRoomMode(null);
            setRoomHostId(null);
            setRoomPlayers([]);
            // The mode card the host pressed to get into the lobby is not a
            // choice for whatever they do next. Leaving reset only `roomMode`,
            // so `selectedMode` stayed on 'group' and the group configuration
            // panel was still sitting under the picker on return — pressing
            // Start then went back to the group lobby instead of the mode the
            // student had switched to.
            //
            // The quiz selection is deliberately kept: they chose it, and
            // quitting a room is no reason to make them choose it again.
            setSelectedMode(null);
          },
        },
      ]
    );
  };

  // Host-side room mutations go through the server, not client-side Firestore:
  // the backend owns the room's roster and team bookkeeping and is the only
  // writer that can keep them consistent.
  const post = async (path: string, body: Record<string, unknown>) => {
    const token = await getToken();
    // Deadline, because a pending fetch leaves every caller's `busy` flag stuck
    // true and its `finally` unreached -- the button spins forever and later taps
    // hit an `if (busy) return` guard. See the same helper in game/lobby.tsx.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/game/${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error(`The server did not respond within ${Math.round(POST_TIMEOUT_MS / 1000)}s`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  // --- Render Helpers ---
  const lanActive = !!lanHostRef.current || isJoinedLan;
  const lanRoster = isJoinedLan && !lanHostRef.current
    ? lanJoined.filter(p => p.id !== myLanIdRef.current)
    : lanJoined;
  const joinedPlayers = lanActive
    ? lanRoster.map(p => ({ id: p.id, displayName: p.name, avatar: p.avatar }))
    : roomPlayers.filter(p => String(p.id) !== String(currentUserId));
  const joinedCount = joinedPlayers.length;

  // While waiting in a LAN game, the host is only a roster player once they tap
  // START — until then, show a dedicated HOST slot so joiners can see them.
  // Skip it if the host already appears in the roster (selfPlay loopback).
  const lanHostInfo = getLanHostInfo();
  const showLanHostSlot = isJoinedLan && !!lanHostInfo.name && !lanJoined.some(p => p.name === lanHostInfo.name);

  const gameModes = isEducator
    ? GAME_MODES.filter(m => EDUCATOR_GAME_MODES.has(m.id))
    : GAME_MODES;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} translucent={false} />
      
      {/* Background Gradient */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark, COLORS.purplePrimary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.background}
      >
        {/* Header / Avatar Section */}
        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
            
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
              style={{ width: '100%' }}
            >
            <View style={styles.avatarRow}>
                {/* Host Avatar (Active) */}
                <View style={styles.avatarContainer}>
                    <View style={styles.avatarCircleHost}>
                        {pfpSource(currentUserAvatar) ? (
                            <Image source={pfpSource(currentUserAvatar)!} style={styles.avatarImage} resizeMode="cover" />
                        ) : (
                            <Text style={styles.avatarCircleJoinedText}>{currentUserInitial || '?'}</Text>
                        )}
                    </View>
                    <View style={styles.hostBadges}>
                        <View style={styles.badgeIcon}><Ionicons name="person" size={10} color="white" /></View>
                        {!joinedRoom && (
                          <View style={[styles.badgeIcon, {backgroundColor: COLORS.purpleVibrant}]}><Ionicons name="star" size={10} color="white" /></View>
                        )}
                    </View>
                    <Text style={styles.avatarName}>YOU</Text>
                </View>

                {/* LAN Host (joined view, before the host taps START) */}
                {showLanHostSlot && (
                    <View style={styles.avatarContainer}>
                        <View style={styles.avatarCircleJoined}>
                            {pfpSource(lanHostInfo.avatar) ? (
                                <Image source={pfpSource(lanHostInfo.avatar)!} style={styles.avatarImage} resizeMode="cover" />
                            ) : (
                                <Text style={styles.avatarCircleJoinedText}>{initialsOf(lanHostInfo.name || 'H')}</Text>
                            )}
                        </View>
                        <View style={styles.hostBadges}>
                            <View style={[styles.badgeIcon, {backgroundColor: COLORS.purpleVibrant}]}><Ionicons name="star" size={10} color="white" /></View>
                        </View>
                        <Text style={styles.avatarName} numberOfLines={1}>{lanHostInfo.name}</Text>
                    </View>
                )}

                {/* Joined Players */}
                {joinedPlayers.map((p) => (
                    <View key={p.id} style={styles.avatarContainer}>
                        <View style={styles.avatarCircleJoined}>
                            {pfpSource(p.avatar) ? (
                                <Image source={pfpSource(p.avatar)!} style={styles.avatarImage} resizeMode="cover" />
                            ) : (
                                <Text style={styles.avatarCircleJoinedText}>{initialsOf(p.displayName || '?')}</Text>
                            )}
                        </View>
                        {joinedRoom && String(p.id) === String(roomHostId) && (
                          <View style={styles.hostBadges}>
                            <View style={[styles.badgeIcon, {backgroundColor: COLORS.purpleVibrant}]}><Ionicons name="star" size={10} color="white" /></View>
                          </View>
                        )}
                        <Text style={styles.avatarName} numberOfLines={1}>{p.displayName || 'Player'}</Text>
                    </View>
                ))}

                {/* Empty Slots */}
                {Array.from({ length: Math.max(0, 4 - joinedCount - (showLanHostSlot ? 1 : 0)) }).map((_, i) => (
                    <View key={`empty-${i}`} style={styles.avatarContainer}>
                        <View style={styles.avatarCircleEmpty}>
                            <Ionicons name="person" size={24} color={COLORS.purpleLight} style={{opacity: 0.5}} />
                        </View>
                        <Text style={styles.avatarNameEmpty}>EMPTY</Text>
                    </View>
                ))}
            </View>
            </ScrollView>
        </View>

        {/* Main Content Card */}
        <View style={styles.contentCard}>
            {/* Tabs: PRESETS | CUSTOM SETTINGS */}
            <View style={styles.tabsContainer}>
                <TouchableOpacity
                    style={activeTab === 'presets' ? styles.tabActive : styles.tabInactive}
                    onPress={joinedRoom ? undefined : () => setActiveTab('presets')}
                    activeOpacity={0.7}
                    disabled={joinedRoom}
                >
                    <Text numberOfLines={1} adjustsFontSizeToFit style={activeTab === 'presets' ? styles.tabTextActive : styles.tabTextInactive}>PRESETS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={activeTab === 'custom' ? styles.tabActive : styles.tabInactive}
                    onPress={joinedRoom ? undefined : () => setActiveTab('custom')}
                    activeOpacity={0.7}
                    disabled={joinedRoom}
                >
                    <Text numberOfLines={1} adjustsFontSizeToFit style={activeTab === 'custom' ? styles.tabTextActive : styles.tabTextInactive}>CUSTOM SETTINGS</Text>
                </TouchableOpacity>
            </View>

            {/* Educators have neither path on this screen, so the banner would
                be telling them to expect a solo game they cannot start. */}
            {!isEducator && (isOffline || usingCachedQuizzes) && (
                <View style={styles.offlineBanner}>
                    <Ionicons name="cloud-offline-outline" size={14} color={COLORS.warning} style={{ marginRight: 6 }} />
                    <Text style={styles.offlineBannerText}>
                        OFFLINE MODE — playing solo from saved quizzes
                    </Text>
                </View>
            )}

            {activeTab === 'presets' ? (
            <ScrollView 
                style={styles.modesScroll} 
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 100 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={COLORS.purplePale}
                        colors={[COLORS.purplePale]}
                    />
                }
            >
                {gameModes.map((mode) => {
                    const isSelected = joinedRoom
                        ? roomMode === mode.id
                        : isJoinedLan
                            ? lanMode === mode.id
                            : selectedMode === mode.id;
                    const isLocked = joinedRoom || isJoinedLan;
                    return (
                        <TouchableOpacity
                            key={mode.id}
                            style={[
                                styles.modeCard,
                                isSelected && styles.modeCardSelected,
                                !mode.active && styles.modeCardDisabled,
                                isLocked && styles.modeCardLocked,
                            ]}
                            onPress={isLocked ? undefined : () => handleModePress(mode.id)}
                            activeOpacity={0.7}
                            disabled={!mode.active || isLocked}
                        >
                            <View style={[
                                styles.modeIconBox,
                                { backgroundColor: isSelected ? 'rgba(124, 58, 237, 0.1)' : 'transparent' }
                            ]}>
                                <Ionicons 
                                    name={mode.icon} 
                                    size={28} 
                                    color={isSelected ? COLORS.purplePrimary : COLORS.textMuted} 
                                />
                            </View>

                            <View style={styles.modeContent}>
                                <View style={styles.modeHeader}>
                                    <Text style={[
                                        styles.modeTitle,
                                        { color: isSelected ? COLORS.purpleDeep : COLORS.textPrimary }
                                    ]}>
                                        {mode.title}
                                    </Text>
                                    {!mode.active && (
                                        <View style={styles.soonBadge}>
                                            <Text style={styles.soonText}>SOON</Text>
                                        </View>
                                    )}
                                </View>
                                <Text style={styles.modeDesc} numberOfLines={2}>
                                    {mode.description}
                                </Text>
                            </View>
                            
                            {mode.active && !isLocked && (
                                <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                            )}
                            {mode.active && isLocked && isSelected && (
                                <Ionicons name="lock-closed" size={20} color={COLORS.purplePrimary} />
                            )}
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
            ) : (
            <KeyboardSafeView style={styles.modesScroll}>
            <ScrollView 
                ref={modesScrollRef}
                style={styles.modesFill} 
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 100 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={COLORS.purplePale}
                        colors={[COLORS.purplePale]}
                    />
                }
            >
                <View style={styles.configSection}>
                    {/* Makes the lock visible. The host reached this screen from a
                        class and needs to know the quiz list is that class's, not
                        all of theirs -- otherwise "only these quizzes" reads as a
                        bug rather than a guarantee. */}
                    {courseId && (
                        <View style={styles.courseScopeBar}>
                            <Ionicons name="school" size={14} color={COLORS.purplePrimary} />
                            <Text style={styles.courseScopeText} numberOfLines={1}>
                                {courseName || 'This class'}
                            </Text>
                            <Text style={styles.courseScopeLock}>LOCKED</Text>
                        </View>
                    )}
                    <Text style={styles.configLabel}>
                        {courseId ? 'SELECT A CLASS QUIZ' : 'SELECT QUIZ'}
                    </Text>
                    {loadingQuizzes ? (
                        <ActivityIndicator size="small" color={COLORS.purpleLight} />
                    ) : quizzes.length === 0 ? (
                        <Text style={styles.emptyQuizText}>
                            {courseId
                                // Do not send the host to Activities: this picker
                                // is locked to one class, and a quiz created there
                                // is not on this list. Point at the class instead.
                                ? `This class has no quizzes yet. Create one in ${courseName || 'its Quizzes tab'}.`
                                : 'No quizzes found. Create one in Activities!'}
                        </Text>
                    ) : (
                        <View>
                            <TouchableOpacity
                                style={styles.quizSelector}
                                onPress={() => setShowQuizDropdown(!showQuizDropdown)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="document-text" size={18} color={COLORS.purplePrimary} style={{marginRight: 8}} />
                                <Text
                                    style={[styles.quizSelectorText, !selectedQuiz && styles.quizSelectorTextPlaceholder]}
                                    numberOfLines={1}
                                >
                                    {selectedQuiz?.title || 'Select a quiz...'}
                                </Text>
                                <Ionicons name={showQuizDropdown ? 'chevron-up' : 'chevron-down'} size={20} color={COLORS.textMuted} />
                            </TouchableOpacity>

                            {showQuizDropdown && (
                                <ScrollView style={styles.quizDropdown} nestedScrollEnabled={true} showsVerticalScrollIndicator={false}>
                                    {quizzes.map((q) => {
                                        const isQSelected = selectedQuiz?.id === q.id;
                                        return (
                                            <TouchableOpacity
                                                key={q.id}
                                                style={[styles.quizDropdownItem, isQSelected && styles.quizDropdownItemActive]}
                                                onPress={() => {
                                                    setSelectedQuiz(q);
                                                    setShowQuizDropdown(false);
                                                }}
                                                activeOpacity={0.7}
                                            >
                                                <Text style={[styles.quizDropdownItemText, isQSelected && styles.quizDropdownItemTextActive]} numberOfLines={1}>
                                                    {q.title}
                                                </Text>
                                                {isQSelected && <Ionicons name="checkmark" size={18} color={COLORS.purplePrimary} />}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            )}
                        </View>
                    )}
                </View>

                <View style={styles.configSection}>
                    <Text style={styles.configLabel}>TIME PER QUESTION</Text>
                    <View style={styles.timeOptions}>
                        {['10', '15', '20', '30'].map((t) => (
                            <TouchableOpacity
                                key={t}
                                style={[styles.timeBtn, timePerQuestion === t && styles.timeBtnActive]}
                                onPress={() => setTimePerQuestion(t)}
                            >
                                <Text style={[styles.timeBtnText, timePerQuestion === t && styles.timeBtnTextActive]}>{t}s</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {selectedMode === 'group' && (
                <View style={styles.configSection}>
                    <Text style={styles.configLabel}>NUMBER OF TEAMS</Text>
                    <View style={styles.teamCountRow}>
                        {[2, 3, 4, 5, 6].map((n) => (
                            <TouchableOpacity
                                key={n}
                                style={[styles.teamCountChip, teamCount === n && !teamCountDraft && styles.teamCountChipActive]}
                                onPress={() => { setTeamCount(n); setTeamCountDraft(''); }}
                            >
                                <Text style={[styles.teamCountChipText, teamCount === n && !teamCountDraft && styles.teamCountChipTextActive]}>{n}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <View style={[styles.teamCountInputWrap, teamCountDraft && styles.teamCountChipActive]}>
                        <Text style={styles.teamCountInputPrefix}>Custom</Text>
                        <TextInput
                            style={styles.teamCountInputText}
                            value={teamCountDraft}
                            onFocus={() => modesScrollRef.current?.scrollToEnd({ animated: true })}
                            onChangeText={(t) => {
                                const cleaned = t.replace(/[^0-9]/g, '').slice(0, 2);
                                setTeamCountDraft(cleaned);
                                if (cleaned) setTeamCount(Math.max(2, Math.min(20, parseInt(cleaned, 10))));
                            }}
                            keyboardType="number-pad"
                            placeholder="amount"
                            placeholderTextColor={COLORS.textMuted}
                            maxLength={2}
                        />
                        {teamCountDraft !== '' && <Text style={styles.teamCountInputSuffix}>teams</Text>}
                    </View>
                </View>
                )}
            </ScrollView>
            </KeyboardSafeView>
            )}
        </View>

        {/* Bottom Action Bar */}
        <View ref={gameActionsTargetRef} style={[styles.bottomBar, { paddingBottom: 10 }]}>
{isJoinedLan ? (
          <>
            {/* Joiner lobby: LEAVE + room code, waiting for the host */}
            <View style={styles.bottomBarRow}>
              <TouchableOpacity
                style={styles.actionBtnJoin}
                onPress={leaveLan}
              >
                <Ionicons name="exit" size={20} color={COLORS.purplePrimary} style={{marginRight: 8}} />
                <Text style={styles.actionBtnJoinText}>LEAVE</Text>
              </TouchableOpacity>

              <View style={styles.actionBtnInvite}>
                <Ionicons name="wifi" size={18} color={COLORS.success} style={{marginRight: 8}} />
                <Text style={styles.lanRoomChipText}>ROOM {lanGame.roomCode || ''}</Text>
              </View>
            </View>

            {lanGame.quiz ? (
              <TouchableOpacity
                style={styles.actionBtnStart}
                onPress={() => router.push({ pathname: '/game/question', params: { lan: 'true', roomCode: lanGame.roomCode } } as any)}
              >
                <Ionicons name="play" size={20} color="white" style={{marginRight: 8}} />
                <Text style={styles.actionBtnTextWhite}>RETURN TO GAME</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.lanWaitingRow}>
                <ActivityIndicator color={COLORS.purpleLight} />
                <Text style={styles.lanWaitingText}>Waiting for the host to start…</Text>
              </View>
            )}
          </>
        ) : joinedRoom ? (
          <>
            <View style={styles.bottomBarRow}>
              <Text style={styles.waitingText}>Waiting for host to start…</Text>
            </View>
            <TouchableOpacity
                style={styles.actionBtnLeave}
                onPress={handleLeaveRoom}
                activeOpacity={0.7}
            >
                <Ionicons name="exit" size={20} color="white" style={{marginRight: 8}} />
                <Text style={styles.actionBtnLeaveText}>LEAVE</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Row 1: JOIN + INVITE side by side */}
            <View style={styles.bottomBarRow}>
              {/* JOIN BUTTON — enter a room code. Educators only ever host, so
                  they get INVITE alone and it stretches to fill the row. */}
              {!isEducator && (
              <TouchableOpacity
                style={styles.actionBtnJoin}
                onPress={() => setShowJoinModal(true)}
              >
                <Ionicons name="enter" size={20} color={COLORS.purplePrimary} style={{marginRight: 8}} />
                <Text style={styles.actionBtnJoinText}>JOIN</Text>
              </TouchableOpacity>
              )}

              {/* INVITE BUTTON */}
              <TouchableOpacity
                style={styles.actionBtnInvite}
                onPress={handleInvitePress}
                disabled={isCreatingRoom}
              >
                {isCreatingRoom && !showCountdown ? (
                    <ActivityIndicator color={COLORS.success} />
                ) : (
                    <>
                        <Ionicons name="share-social" size={20} color={COLORS.success} style={{marginRight: 8}} />
                        <Text style={styles.actionBtnText}>INVITE</Text>
                    </>
                )}
              </TouchableOpacity>
            </View>

            {/* Row 2: START full width */}
            <TouchableOpacity
              style={[styles.actionBtnStart, isCreatingRoom && { opacity: 0.7 }]}
              onPress={handleStartPress}
              disabled={isCreatingRoom}
            >
              {isCreatingRoom && !showCountdown ? (
                  <ActivityIndicator color="white" />
              ) : (
                  <>
                      <Ionicons name="play" size={20} color="white" style={{marginRight: 8}} />
                      <Text style={styles.actionBtnTextWhite}>START</Text>
                  </>
              )}
            </TouchableOpacity>
</>
        )}
        </View>

        {/* --- INVITE CODE MODAL --- */}
        <Modal visible={showInviteModal} animationType="fade" transparent={true}>
            <View style={styles.modalOverlay}>
                <View style={styles.inviteModalCard}>
                    <TouchableOpacity 
                        style={styles.closeInviteBtn}
                        onPress={() => setShowInviteModal(false)}
                    >
                        <Ionicons name="close" size={24} color={COLORS.textMuted} />
                    </TouchableOpacity>

                    <Text style={styles.modalTitle}>ROOM CODE</Text>
                    <Text style={styles.modalSub}>
                      {(isOffline || usingCachedQuizzes)
                        ? 'Open your hotspot - players type this code to join, then tap START to begin'
                        : 'Share this code with your students'}
                    </Text>
                    
                    <View style={styles.codeDisplayRow}>
                        {roomCode?.split('').map((char, i) => (
                            <View key={i} style={styles.codeChip}>
                                <Text style={styles.codeChipText}>{char}</Text>
                            </View>
                        ))}
                    </View>

                    {(isOffline || usingCachedQuizzes) && lanPlayerCount > 0 && (
                        <Text style={styles.modalLanCount}>
                            {lanPlayerCount} player{lanPlayerCount === 1 ? '' : 's'} connected
                        </Text>
                    )}

                    <TouchableOpacity 
                        style={styles.copyCodeBtn}
                        onPress={copyCode}
                    >
                        <Ionicons name="copy-outline" size={20} color="white" style={{marginRight: 8}} />
                        <Text style={styles.copyCodeBtnText}>Copy Code</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>

        {/* --- JOIN ROOM MODAL ---
            The JOIN button above is the only thing that can open this, so for
            educators it is already unreachable. Gated on the role anyway: the
            effect that drives LAN discovery hangs off `showJoinModal`, and an
            educator who somehow landed in here would start scanning the
            hotspot for a LAN game the moment this rendered. */}
        <Modal visible={showJoinModal && !isEducator} animationType="fade" transparent={true}>
            <View style={styles.joinModalOverlay}>
                <KeyboardSafeView
                    style={styles.joinModalKeyboardWrap}
                >
                <View style={[styles.inviteModalCard, styles.joinModalCard]}>
                    <TouchableOpacity 
                        style={styles.closeInviteBtn}
                        onPress={() => { if (!joining) setShowJoinModal(false); }}
                    >
                        <Ionicons name="close" size={24} color={COLORS.textMuted} />
                    </TouchableOpacity>

                    <Text style={styles.modalTitle}>JOIN ROOM</Text>
                    <Text style={styles.modalSub}>Enter the room code — finds LAN games on your hotspot too</Text>

                    <JoinCodeInput
                        slots={joinCode}
                        onChange={setJoinCode}
                        editable={!joining}
                        containerStyle={styles.codeBoxes}
                        boxStyle={styles.codeBox}
                        filledBoxStyle={styles.codeBoxFilled}
                        accessibilityLabel="Room code"
                    />

                    <TouchableOpacity 
                        style={[styles.copyCodeBtn, joining && { opacity: 0.7 }]}
                        onPress={handleJoin}
                        disabled={joining}
                    >
                        {joining ? (
                            <ActivityIndicator color="white" />
                        ) : (
                            <>
                                <Ionicons name="enter" size={20} color="white" style={{marginRight: 8}} />
                                <Text style={styles.copyCodeBtnText}>Join Game</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
                </KeyboardSafeView>
            </View>
        </Modal>

        {/* --- COUNTDOWN OVERLAY --- */}
        <Modal visible={showCountdown} transparent={true} animationType="none">
            <View style={styles.countdownOverlay}>
                <Animated.View style={{
                    opacity: fadeAnim,
                    transform: [{ scale: scaleAnim }]
                }}>
                    <Text style={styles.countdownText}>{countdownValue}</Text>
                </Animated.View>
            </View>
        </Modal>

      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  background: { flex: 1 },
  
  // Header
  header: {
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: '100%',
    marginBottom: 20,
    paddingHorizontal: 10,
    gap: 8,
  },
  avatarContainer: {
    alignItems: 'center',
    width: 60,
  },
  avatarCircleHost: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.purpleVibrant,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.success,
    marginBottom: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  avatarCircleEmpty: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    marginBottom: 6,
  },
  avatarCircleJoined: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.purpleVibrant,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.success,
    marginBottom: 6,
  },
  avatarCircleJoinedText: {
    color: 'white',
    fontSize: 22,
    fontFamily: FONTS.black,
  },
  avatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  hostBadges: {
    position: 'absolute',
    bottom: 20,
    left: -5,
    flexDirection: 'row',
    gap: 2,
  },
  badgeIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.purpleDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'white',
  },
  avatarName: {
    color: 'white',
    fontSize: 11,
    fontFamily: FONTS.bold,
    textTransform: 'uppercase',
  },
  avatarNameEmpty: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontFamily: FONTS.bold,
    textTransform: 'uppercase',
  },

  // Content Card
  contentCard: {
    flex: 1,
    backgroundColor: 'rgba(76, 29, 149, 0.4)',
    marginHorizontal: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingHorizontal: 10,
    gap: 10,
  },
  tabActive: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.success,
  },
  tabInactive: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    opacity: 0.6,
  },
  tabTextActive: {
    color: COLORS.success,
    fontFamily: FONTS.extraBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  tabTextInactive: {
    color: 'white',
    fontFamily: FONTS.bold,
    fontSize: 14,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  offlineBannerText: {
    flex: 1,
    color: '#FDE68A',
    fontFamily: FONTS.bold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  lanActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 10,
  },
  lanActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  // Modes List
modesScroll: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  // The keyboard-safe wrapper around the mode list owns `modesScroll`'s padding
  // now, so the scroll view inside it only has to fill what is left.
  modesFill: { flex: 1 },
  modeCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceDim,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modeCardSelected: {
    backgroundColor: '#F3E8FF',
    borderColor: COLORS.success,
  },
  modeCardDisabled: {
    opacity: 0.6,
  },
  modeCardLocked: {
    opacity: 0.75,
  },
  modeIconBox: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderRadius: 12,
  },
  modeContent: {
    flex: 1,
  },
  modeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modeTitle: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.5,
  },
  modeDesc: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.purpleDark,
    lineHeight: 18,
    opacity: 0.8,
  },
  soonBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  soonText: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
  },

  // Bottom Bar
  bottomBar: {
    flexDirection: 'column',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    backgroundColor: COLORS.purpleDeep,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  bottomBarRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtnInvite: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    backgroundColor: 'white',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnJoin: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    backgroundColor: 'white',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnJoinText: {
    color: COLORS.purplePrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  lanRoomChipText: {
    color: COLORS.success,
    fontFamily: FONTS.extraBold,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  lanWaitingRow: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  lanWaitingText: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
    fontSize: 14,
  },
  actionBtnStart: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.success,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  actionBtnText: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  actionBtnTextWhite: {
    color: 'white',
    fontFamily: FONTS.extraBold,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  waitingText: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    textAlign: 'center',
  },
  actionBtnLeave: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.danger,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  actionBtnLeaveText: {
    color: 'white',
    fontFamily: FONTS.extraBold,
    fontSize: 16,
    letterSpacing: 0.5,
  },

  // Team Picker (joined players, group mode)
  teamPickerSection: {
    marginTop: 4,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  teamPickerLabel: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Team-column diagnostics, sitting between the label and the columns so the
  // failure is attached to the thing that failed.
  teamNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 1, marginBottom: 12,
  },
  teamNoticeError: { backgroundColor: COLORS.danger + '1A', borderColor: COLORS.danger + '55' },
  teamNoticeOk: { backgroundColor: COLORS.success + '1A', borderColor: COLORS.success + '55' },
  teamNoticeText: { flex: 1, fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, lineHeight: 17 },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  joinModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
  },
  joinModalCard: {
    marginBottom: 0,
  },
  joinModalKeyboardWrap: {
    width: '100%',
    alignItems: 'center',
  },
  configModalCard: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '80%',
  },
  inviteModalCard: {
    backgroundColor: 'white',
    width: '90%',
    alignSelf: 'center',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    position: 'relative',
    marginBottom: 100,
  },
  closeInviteBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: FONTS.black,
    color: COLORS.purpleDeep,
  },
  modalSub: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
    marginBottom: 24,
  },
  modalLanCount: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.success,
    textAlign: 'center',
    marginTop: 12,
  },
  
  // Config Modal Styles
  configSection: {
    marginBottom: 24,
  },
  configLabel: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  courseScopeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceDim,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  courseScopeText: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
  },
  courseScopeLock: {
    fontSize: 9,
    fontFamily: FONTS.bold,
    color: COLORS.purplePrimary,
    letterSpacing: 1,
  },
  quizSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    height: 48,
  },
  quizSelectorText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  quizSelectorTextPlaceholder: {
    color: COLORS.textMuted,
  },
  quizDropdown: {
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 6,
    maxHeight: 260,
    elevation: 6,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  quizDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  quizDropdownItemActive: {
    backgroundColor: '#F3E8FF',
  },
  quizDropdownItemText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
  },
  quizDropdownItemTextActive: {
    fontFamily: FONTS.bold,
    color: COLORS.purpleDeep,
  },
  emptyQuizText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    fontStyle: 'italic',
    paddingVertical: 10,
  },
  timeOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  timeBtn: {
    flex: 1,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  timeBtnActive: {
    backgroundColor: COLORS.purpleDark,
    borderColor: COLORS.purpleDark,
  },
  timeBtnText: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
  },
  timeBtnTextActive: {
    color: 'white',
  },

  // Number of Teams chips + custom input
  teamCountRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  teamCountChip: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 48,
  },
  teamCountChipActive: {
    backgroundColor: COLORS.purpleDark,
    borderColor: COLORS.purpleDark,
  },
  teamCountChipText: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
  },
  teamCountChipTextActive: {
    color: 'white',
  },
  teamCountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  teamCountInputPrefix: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    color: COLORS.textSecondary,
  },
  teamCountInputText: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    paddingVertical: 0,
    minWidth: 30,
  },
  teamCountInputSuffix: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    color: COLORS.textSecondary,
  },

  // Invite Modal Styles
  codeDisplayRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  codeChip: {
    width: 40,
    height: 50,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeChipText: {
    fontSize: 24,
    fontFamily: FONTS.black,
    color: COLORS.purpleDark,
  },
  codeBoxes: {
    marginBottom: 24,
  },
  codeBox: {
    width: 40,
    height: 50,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
    backgroundColor: COLORS.bgSecondary,
    color: COLORS.purpleDark,
    fontSize: 24,
    fontFamily: FONTS.black,
    textAlign: 'center',
    paddingVertical: 0,
  },
  codeBoxFilled: {
    borderColor: COLORS.success,
    backgroundColor: 'white',
  },
  copyCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
  },
  copyCodeBtnText: {
    color: 'white',
    fontFamily: FONTS.bold,
    fontSize: 14,
  },

  // Countdown Overlay
  countdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 12, 41, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontFamily: FONTS.black,
    color: 'white',
    textShadowColor: COLORS.purplePrimary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
});
