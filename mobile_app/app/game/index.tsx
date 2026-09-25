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
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
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
import { lanGame, setLanClient, setLanHost, resetLanState, getLanClient, getLanHostInfo, setLanHostInfo, setLastLanRoster, setLanPlayerId } from '@/services/lanSession';
import { LanHostServer, makeOrder } from '@/services/lanHost';
import { LanMessage, LanPlayer, generateRoomCode } from '@/services/lanProtocol';
import { startScanning, stopScanning, startAdvertising, stopAdvertising, DiscoveredRoom } from '@/services/lanDiscovery';
import { buildQuestions } from '@/services/offlineEngine';
import { pfpSource } from '@/constants/pfps';

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

export default function GameCenterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
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
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomTopic, setRoomTopic] = useState<string>('');
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string>('');
  const [currentUserInitial, setCurrentUserInitial] = useState<string>('');

  // Joined room state
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'active'>('waiting');
  const [roomMode, setRoomMode] = useState<'classic' | 'group' | null>(null);
  const [roomHostId, setRoomHostId] = useState<number | string | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
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
  const lanClientMsgRef = useRef<(msg: LanMessage) => void>(() => {});
  const lanHostMsgRef = useRef<(msg: LanMessage) => void>(() => {});

  const onLanHostMessage = (msg: LanMessage) => {
    if (msg.t === 'roster') {
      const connected = msg.players.filter(p => p.connected);
      lanPlayerCountRef.current = connected.length;
      setLanPlayerCount(connected.length);
      setLanJoined(connected);
      setLastLanRoster(connected);
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

  useEffect(() => {
    getCurrentUser().then(u => {
      setCurrentUserId(u?.id ?? null);
      setCurrentUserAvatar(u?.avatar ?? '');
      setCurrentUserInitial((u?.first_name || u?.username || '?').charAt(0).toUpperCase());
    });
  }, []);

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

  // Room doc listener for joined players — mode, status, hostId
  useEffect(() => {
    if (!joinedRoom || !roomCode) return;
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .onSnapshot(snap => {
        if (!snap.exists) {
          // Room deleted — reset joined state
          setJoinedRoom(false);
          setRoomCode(null);
          setRoomMode(null);
          setRoomStatus('waiting');
          return;
        }
        const d = snap.data();
        if (!d) return;
        setRoomStatus(d.status ?? 'waiting');
        setRoomMode(d.mode === 'group' || d.teamMode ? 'group' : 'classic');
        setRoomHostId(d.hostId ?? null);
        if (d.status === 'active') {
          startJoinedCountdown(roomCode);
        }
      });
    return () => unsub();
  }, [joinedRoom, roomCode, startJoinedCountdown]);

  // Team picker subscription (team mode only) — separate effect
  useEffect(() => {
    if (!joinedRoom || !roomCode) return;
    let unsub: (() => void) | null = null;
    firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .get()
      .then(snap => {
        const d = snap?.data();
        if (d?.teamMode) {
          unsub = firestore()
            .collection('gameRooms')
            .doc(roomCode)
            .collection('teams')
            .onSnapshot(snap => {
              setTeams(snap?.docs?.map(doc => ({ id: doc.id, ...doc.data() })) ?? []);
            });
        }
      });
    return () => unsub?.();
  }, [joinedRoom, roomCode]);

  const fetchQuizzes = useCallback(async () => {
    setLoadingQuizzes(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/quizzes/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setQuizzes(list);
        setUsingCachedQuizzes(false);
        cacheQuizzes(list);
        if (list.length > 0) setSelectedQuiz(list[0]);
        setLoadingQuizzes(false);
        return;
      }
    } catch (error) {
      console.error("Failed to load quizzes", error);
    }
    const cached = getCachedQuizzes();
    if (cached.length > 0) {
      setQuizzes(cached);
      setUsingCachedQuizzes(true);
      setSelectedQuiz(prev => prev ?? cached[0]);
    }
    setLoadingQuizzes(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchQuizzes();
    }, [fetchQuizzes])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchQuizzes();
    } finally {
      setRefreshing(false);
    }
  }, [fetchQuizzes]);

  // --- Handlers ---
  
  // 1. Handle Mode Click -> Open Config Modal
  const handleModePress = (modeId: string) => {
    if (modeId === 'classic') {
      setSelectedMode(modeId);
      setActiveTab('custom');
      // Sync mode to room doc if host has an active room
      if (roomCode && !joinedRoom) {
        firestore()
          .collection('gameRooms')
          .doc(roomCode)
          .update({ mode: 'classic' })
          .catch(() => {});
      }
    } else if (modeId === 'group') {
      setSelectedMode(modeId);
      setActiveTab('custom');
      // Sync mode to room doc if host has an active room
      if (roomCode && !joinedRoom) {
        firestore()
          .collection('gameRooms')
          .doc(roomCode)
          .update({ mode: 'group' })
          .catch(() => {});
      }
    } else if (modeId === 'flashcards') {
      router.push('/flashcards');
    } else {
      Alert.alert("Coming Soon", "This mode is under development!");
    }
  };

  // 2. Handle Invite Press -> Create Room (if needed) & Show Code Modal
  const handleInvitePress = async () => {
    if (isOffline || usingCachedQuizzes) {
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

    // Validate settings before creating
    if (!selectedQuiz) {
      Alert.alert("Missing Quiz", "Please select a game mode and quiz first.");
      return;
    }

    setIsCreatingRoom(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/create/`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          quizId: selectedQuiz.id,
          timePerQuestion: parseInt(timePerQuestion) || 15,
          teamMode: selectedMode === 'group' ? 'true' : 'false',
          autoAssignTeams: selectedMode === 'group' ? 'true' : 'false',
          ...(selectedMode === 'group' ? { teamCount } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create room');

      setRoomCode(data.roomCode);
      setRoomTopic(data.topic || selectedQuiz.title);
      // Sync host's selected mode to the room doc for joined players
      firestore()
        .collection('gameRooms')
        .doc(data.roomCode)
        .update({ mode: selectedMode === 'group' ? 'group' : 'classic' })
        .catch(() => {});
      setShowInviteModal(true); // Show the code immediately
      
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // 3. Handle Start Press -> Start Game & Countdown
  const handleStartPress = async () => {
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
      if (!selectedQuiz) {
        Alert.alert('Missing Quiz', 'Please select a quiz first.');
        return;
      }
      const count = buildQuestions(selectedQuiz).length;
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
      host.setQuiz(selectedQuiz, order, time);
      setLanHost(host);
      lanGame.quiz = selectedQuiz;
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
      // shows up on the leaderboard.
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
      host.startGame();
      router.push({ pathname: '/game/question', params: { lan: 'true', roomCode: lanGame.roomCode } } as any);
      return;
    }

    if (!roomCode) {
       // If no room exists, create one first silently
       if (!selectedQuiz) {
        Alert.alert("Missing Quiz", "Please select a quiz first.");
        return;
      }
      
      setIsCreatingRoom(true);
      try {
        const token = await getToken();
        const response = await fetch(`${API_BASE_URL}/game/create/`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify({
            quizId: selectedQuiz.id,
            timePerQuestion: parseInt(timePerQuestion) || 15,
            teamMode: selectedMode === 'group' ? 'true' : 'false',
            autoAssignTeams: selectedMode === 'group' ? 'true' : 'false',
            ...(selectedMode === 'group' ? { teamCount } : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create room');
        setRoomCode(data.roomCode);
        setRoomTopic(data.topic || selectedQuiz.title);
        
        // Proceed to start after creation
        startGameSequence(data.roomCode);
      } catch (error: any) {
        Alert.alert("Error", error.message);
        setIsCreatingRoom(false);
      }
    } else {
      // Room exists, just start
      startGameSequence(roomCode);
    }
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
    if (!selectedQuiz) {
      Alert.alert("Missing Quiz", "Please select a quiz first.");
      return;
    }
    console.log('[game/index] START path: offline-solo');
    const time = parseInt(timePerQuestion, 10) || 15;
    try {
      createOfflineGame(selectedQuiz, time);
    } catch (error: any) {
      Alert.alert("Can't Play Offline", error.message);
      return;
    }
    runCountdown('OFFLINE', { offline: 'true', quizTitle: selectedQuiz.title }, '/game/question' as any);
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
      // Stay on the Play tab (like online joins) — the waiting/LEAVE bar and
      // roster slots render here in the joined-LAN view.
    } else if (msg.t === 'roster') {
      const connected = msg.players.filter(p => p.connected);
      lanPlayerCountRef.current = connected.length;
      setLanPlayerCount(connected.length);
      setLanJoined(connected);
      setLastLanRoster(connected);
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

  // If a live LAN client exists (screen refocused mid-session), re-attach the
  // handler so lobby updates and game-over events keep flowing on this screen.
  // If a finished/abandoned LAN game is leftover, tear the session down so the
  // next INVITE/START/JOIN builds a fresh room instead of reusing a stale one.
  useFocusEffect(
    useCallback(() => {
      const c = getLanClient();
      if (c && c.connected && !lanGame.quiz) {
        c.onEvent = lanClientMsgRef.current;
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
        setJoinCode('');
        resolve(true);
      } catch {
        setLanClient(null);
        resolve(false);
      }
    });

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      Alert.alert('Error', 'Please enter a room code');
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
      setJoinCode('');
      // Stay on Play tab — joined room view
      setRoomCode(code);
      setRoomTopic(data.topic || '');
      setJoinedRoom(true);
      setRoomMode(data.teamMode ? 'group' : 'classic');
      setSelectedMode(data.teamMode ? 'group' : 'classic');
      setActiveTab('presets');
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
            if (roomCode && currentUserId) {
              const roomRef = firestore().collection('gameRooms').doc(roomCode);
              const playerRef = roomRef.collection('players').doc(String(currentUserId));
              // Get current teamId if any, then remove from team memberIds
              try {
                const playerSnap = await playerRef.get();
                const myTeamId = playerSnap.data()?.teamId;
                if (myTeamId) {
                  const teamRef = roomRef.collection('teams').doc(myTeamId);
                  await teamRef.update({ memberIds: firestore.FieldValue.arrayRemove(String(currentUserId)) });
                }
              } catch {}
              // Delete own player doc
              await playerRef.delete().catch(() => {});
            }
            // Reset joined room state
            setJoinedRoom(false);
            setRoomCode(null);
            setRoomTopic('');
            setRoomStatus('waiting');
            setRoomMode(null);
            setRoomHostId(null);
            setRoomPlayers([]);
            setTeams([]);
          },
        },
      ]
    );
  };

  const codeBoxRefs = useRef<any[]>([]);
  const handleCodeChange = (t: string, i: number) => {
    const char = t.slice(-1).toUpperCase();
    const next = joinCode.split('').slice(0, 6);
    while (next.length < i) next.push('');
    if (!char) {
      next[i] = '';
      if (i > 0) next[i - 1] = '';
    } else {
      next[i] = char;
    }
    const clean = next.join('').slice(0, 6);
    setJoinCode(clean);
    if (char && i < 5) codeBoxRefs.current[i + 1]?.focus();
    else if (!char && i > 0) codeBoxRefs.current[i - 1]?.focus();
  };
  const handleCodeKeyPress = (e: any, i: number) => {
    if (e.nativeEvent.key === 'Backspace' && !joinCode[i] && i > 0) {
      const next = joinCode.split('');
      next[i - 1] = '';
      setJoinCode(next.join(''));
      codeBoxRefs.current[i - 1]?.focus();
    }
  };

  const assignToTeam = async (teamId: string) => {
    if (!roomCode || !currentUserId) return;
    const uid = String(currentUserId);
    const roomRef = firestore().collection('gameRooms').doc(roomCode);
    // Find current team to remove from memberIds
    const playerRef = roomRef.collection('players').doc(uid);
    try {
      const playerSnap = await playerRef.get();
      const myTeamId = playerSnap.data()?.teamId;
      const batch = firestore().batch();
      if (myTeamId && myTeamId !== teamId) {
        batch.update(roomRef.collection('teams').doc(myTeamId), {
          memberIds: firestore.FieldValue.arrayRemove(uid),
        });
      }
      batch.update(roomRef.collection('teams').doc(teamId), {
        memberIds: firestore.FieldValue.arrayUnion(uid),
      });
      batch.update(playerRef, { teamId });
      await batch.commit();
    } catch (e) {
      console.warn('Team assignment failed', e);
    }
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

  const gameModes = [
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
                                <Text style={styles.avatarCircleJoinedText}>{(lanHostInfo.name || 'H').charAt(0).toUpperCase()}</Text>
                            )}
                        </View>
                        <View style={styles.hostBadges}>
                            <View style={[styles.badgeIcon, {backgroundColor: COLORS.purpleVibrant}]}><Ionicons name="star" size={10} color="white" /></View>
                        </View>
                        <Text style={styles.avatarName} numberOfLines={1}>{lanHostInfo.name}</Text>
                    </View>
                )}

                {/* Joined Players */}
                {joinedPlayers.slice(0, 4).map((p) => (
                    <View key={p.id} style={styles.avatarContainer}>
                        <View style={styles.avatarCircleJoined}>
                            {pfpSource(p.avatar) ? (
                                <Image source={pfpSource(p.avatar)!} style={styles.avatarImage} resizeMode="cover" />
                            ) : (
                                <Text style={styles.avatarCircleJoinedText}>{(p.displayName || '?').charAt(0).toUpperCase()}</Text>
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

            {(isOffline || usingCachedQuizzes) && (
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
                    const isSelected = joinedRoom ? roomMode === mode.id : selectedMode === mode.id;
                    const isLocked = joinedRoom;
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

                {/* Team picker for joined players in GROUP MODE */}
                {joinedRoom && roomMode === 'group' && teams.length > 0 && (
                  <View style={styles.teamPickerSection}>
                    <Text style={styles.teamPickerLabel}>PICK YOUR TEAM</Text>
                    <View style={styles.teamPickerChips}>
                      {teams.map((team) => {
                        const myTeamId = roomPlayers.find(
                          p => String(p.id) === String(currentUserId)
                        )?.teamId as string | undefined;
                        const isMyTeam = team.id === myTeamId;
                        const memberCount = team.memberIds?.length || 0;
                        return (
                          <TouchableOpacity
                            key={team.id}
                            style={[
                              styles.teamPickerChip,
                              isMyTeam && styles.teamPickerChipActive,
                            ]}
                            onPress={() => assignToTeam(team.id)}
                            activeOpacity={0.7}
                            disabled={roomStatus === 'active'}
                          >
                            <Text style={[
                              styles.teamPickerChipText,
                              isMyTeam && styles.teamPickerChipTextActive,
                            ]}>
                              {team.name || `Team ${team.id}`}
                              {'\n'}
                              <Text style={{ fontSize: 10, opacity: 0.7 }}>{memberCount} players</Text>
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
            </ScrollView>
            ) : (
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
                <View style={styles.configSection}>
                    <Text style={styles.configLabel}>SELECT QUIZ</Text>
                    {loadingQuizzes ? (
                        <ActivityIndicator size="small" color={COLORS.purpleLight} />
                    ) : quizzes.length === 0 ? (
                        <Text style={styles.emptyQuizText}>No quizzes found. Create one in Activities!</Text>
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
            )}
        </View>

        {/* Bottom Action Bar */}
        <View style={[styles.bottomBar, { paddingBottom: 10 }]}>
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
              {/* JOIN BUTTON — enter a room code */}
              <TouchableOpacity
                style={styles.actionBtnJoin}
                onPress={() => setShowJoinModal(true)}
              >
                <Ionicons name="enter" size={20} color={COLORS.purplePrimary} style={{marginRight: 8}} />
                <Text style={styles.actionBtnJoinText}>JOIN</Text>
              </TouchableOpacity>

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

        {/* --- JOIN ROOM MODAL --- */}
        <Modal visible={showJoinModal} animationType="fade" transparent={true}>
            <View style={styles.joinModalOverlay}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

                    <View style={styles.codeBoxes}>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <TextInput
                                key={i}
                                ref={(r) => { codeBoxRefs.current[i] = r; }}
                                style={[styles.codeBox, joinCode[i] ? styles.codeBoxFilled : null]}
                                value={joinCode[i] || ''}
                                onChangeText={(t) => handleCodeChange(t, i)}
                                onKeyPress={(e) => handleCodeKeyPress(e, i)}
                                maxLength={1}
                                autoCapitalize="characters"
                                autoCorrect={false}
                                editable={!joining}
                            />
                        ))}
                    </View>

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
                </KeyboardAvoidingView>
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
    width: '100%',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  avatarContainer: {
    alignItems: 'center',
    width: 60,
  },
  avatarCircleHost: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.surface,
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
  teamPickerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  teamPickerChip: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  teamPickerChipActive: {
    backgroundColor: '#F3E8FF',
    borderColor: COLORS.purplePrimary,
  },
  teamPickerChipText: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  teamPickerChipTextActive: {
    color: COLORS.purpleDeep,
  },

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
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
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