import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Network from 'expo-network';
import * as Clipboard from 'expo-clipboard';
import { LanHostServer, makeOrder } from '@/services/lanHost';
import { LanClientSession } from '@/services/lanClient';
import { buildQuestions, QuizPayload } from '@/services/offlineEngine';
import { getCachedQuizzes } from '@/services/offlineGameService';
import { getCurrentUser } from '@/services/authService';
import { generateRoomCode, LanMessage, LanPlayer } from '@/services/lanProtocol';
import { lanGame, setLanHost, setLanClient, resetLanState } from '@/services/lanSession';
import { startAdvertising, stopAdvertising } from '@/services/lanDiscovery';

const COLORS = {
  bg: '#0f0c29',
  surface: '#1e1b4b',
  cardBg: '#232052',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  accentBright: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(139, 92, 246, 0.2)',
};

export default function LanHostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [quizzes, setQuizzes] = useState<QuizPayload[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [code] = useState(() => generateRoomCode());
  const [ipManual, setIpManual] = useState('');
  const [detectedIp, setDetectedIp] = useState('');
  const [hostName, setHostName] = useState('');
  const [role, setRole] = useState('student');
  const [selfPlay, setSelfPlay] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [players, setPlayers] = useState<LanPlayer[]>([]);
  const [board, setBoard] = useState<LanPlayer[]>([]);
  const [advertising, setAdvertising] = useState(false);
  const [showIp, setShowIp] = useState(false);
  const hostRef = useRef<LanHostServer | null>(null);
  const selfRef = useRef(false);
  const playersCountRef = useRef(0);

  useEffect(() => {
    setQuizzes(getCachedQuizzes());
    (async () => {
      const user = await getCurrentUser();
      if (user?.first_name) setHostName(user.first_name);
      if (user?.role === 'student') setSelfPlay(true);
      setRole(user?.role || 'student');
    })();
    try {
      Network.getIpAddressAsync().then(ip => {
        if (ip && ip !== '0.0.0.0') {
          setDetectedIp(ip);
          setIpManual(ip);
        }
      });
    } catch {}
    return () => {
      if (hostRef.current) {
        hostRef.current.stop();
        hostRef.current = null;
      }
      if (selfRef.current) {
        setLanHost(null);
        setLanClient(null);
      }
      resetLanState();
      setLanHost(null);
      setLanClient(null);
      stopAdvertising();
    };
  }, []);

  useEffect(() => {
    if (started) {
      stopAdvertising();
      setAdvertising(false);
      return;
    }
    const quiz = quizzes.find(q => q.id === selectedId);
    const ok = startAdvertising(code, quiz?.title || 'LAN Quiz', () => playersCountRef.current);
    setAdvertising(ok);
    return () => stopAdvertising();
  }, [selectedId, started, code, quizzes]);

  const candidateIps = (() => {
    const list: string[] = [];
    if (detectedIp) list.push(detectedIp);
    for (const c of ['192.168.43.1', '192.168.96.1', '10.0.0.1']) {
      if (!list.includes(c)) list.push(c);
    }
    return list;
  })();

  const copyIp = async () => {
    const ip = ipManual.trim();
    if (!ip) return;
    await Clipboard.setStringAsync(ip);
    Alert.alert('Copied!', 'Host IP copied. Share it with players.');
  };

  const leave = () => {
    if (hostRef.current) {
      hostRef.current.stop();
      hostRef.current = null;
    }
    stopAdvertising();
    resetLanState();
    setLanHost(null);
    setLanClient(null);
    router.dismissAll();
  };

  const onHostMessage = useCallback(
    (msg: LanMessage) => {
      if (msg.t === 'roster') {
        setPlayers(msg.players);
        playersCountRef.current = msg.players.filter(p => p.connected).length;
        if (started) setBoard([...msg.players].sort((a, b) => b.score - a.score));
      } else if (msg.t === 'leaderboard') {
        setStarted(true);
        setBoard([...msg.players].sort((a, b) => b.score - a.score));
      } else if (msg.t === 'error') {
        Alert.alert('LAN Error', msg.message || 'Unexpected error');
      }
    },
    [started]
  );

  const startGame = async () => {
    const quiz = quizzes.find(q => q.id === selectedId);
    if (!quiz) {
      Alert.alert('Pick a Quiz', 'Choose a saved quiz first.');
      return;
    }
    const count = buildQuestions(quiz).length;
    if (count === 0) {
      Alert.alert('Empty Quiz', 'That quiz has no valid questions.');
      return;
    }
    if (!selfPlay && !players.some(p => p.connected)) {
      Alert.alert('No Players', 'Wait for someone to join, or turn on "I\'m playing too".');
      return;
    }

    setStarting(true);
    stopAdvertising();
    setAdvertising(false);
    const order = makeOrder(count);
    const host = new LanHostServer(code);
    hostRef.current = host;
    host.onMessage(onHostMessage);
    host.setQuiz(quiz, order, 30);
    host.start();
    setLanHost(host);

    lanGame.quiz = quiz;
    lanGame.order = order;
    lanGame.timePerQuestion = 30;
    lanGame.playerName = hostName || 'Host';
    lanGame.role = role;
    lanGame.selfPlay = selfPlay;
    lanGame.hostIp = ipManual.trim();
    lanGame.roomCode = code;

    if (selfPlay) {
      selfRef.current = true;
      const client = new LanClientSession(() => {});
      setLanClient(client);
      try {
        await client.connect('127.0.0.1');
        client.join(code, hostName || 'Host');
        host.startGame();
      } catch {
        Alert.alert(
          'Note',
          'Could not loop back on this device. You can still play alongside everyone, but your own name might not show on the scoreboard.'
        );
        host.startGame();
      }
      setStarted(true);
      router.push('/game/lan-play' as any);
    } else {
      host.startGame();
      setStarted(true);
    }
    setStarting(false);
  };

  const endGame = () => {
    if (hostRef.current) {
      hostRef.current.endGame('Game over');
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={leave} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.title}>Host LAN Game</Text>
          <Text style={styles.subtitle}>Open a hotspot — players connect without internet</Text>

          <View style={styles.codeBanner}>
            <Text style={styles.codeLabel}>ROOM CODE</Text>
            <Text style={styles.codeValue}>{code}</Text>
            <Text style={styles.codeHelp}>Players connect to your hotspot, tap JOIN in Game Center, and type this code — the room finds itself.</Text>
          </View>

          <View style={styles.card}>
            {advertising ? (
              <View style={styles.broadcastBanner}>
                <View style={styles.broadcastRow}>
                  <Ionicons name="radio" size={18} color={COLORS.success} />
                  <Text style={styles.broadcastText}>Broadcasting</Text>
                </View>
                <Text style={styles.broadcastSub}>
                  Players on your hotspot can find this game automatically. They only type the code above — no IP needed.
                </Text>
              </View>
            ) : (
              <Text style={styles.cardLabel}>GETTING READY…</Text>
            )}

            <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowIp(o => !o)} activeOpacity={0.8}>
              <Ionicons name={showIp ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
              <Text style={styles.advancedToggleText}>Troubleshooting — manually share IP</Text>
            </TouchableOpacity>
            {showIp && (
              <View style={styles.advancedBody}>
                <Text style={styles.cardLabel}>IP ADDRESS</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    value={ipManual}
                    onChangeText={setIpManual}
                    placeholder="Your hotspot address"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="numbers-and-punctuation"
                  />
                  <TouchableOpacity style={styles.pasteBtn} onPress={copyIp} activeOpacity={0.7}>
                    <Ionicons name="copy-outline" size={18} color={COLORS.purpleVibrant} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>
                  Only needed if a player can&apos;t find the room automatically. When you host a hotspot this phone can&apos;t read its own address, so pick your network&apos;s Gateway below (or copy it from Wi-Fi settings).
                </Text>
                <View style={styles.ipsRow}>
                  {candidateIps.map(ip => (
                    <TouchableOpacity
                      key={ip}
                      style={[styles.ipChip, ipManual === ip && styles.ipChipActive]}
                      onPress={() => setIpManual(ip)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.ipChipText, ipManual === ip && styles.ipChipTextActive]}>{ip}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <Text style={[styles.cardLabel, styles.labelGap]}>SELECT QUIZ</Text>
            {quizzes.length === 0 ? (
              <Text style={styles.emptyText}>
                No saved quizzes yet. Go online once in Game Center to cache quizzes, then come back.
              </Text>
            ) : (
              quizzes.map(q => (
                <TouchableOpacity
                  key={q.id}
                  style={[styles.quizRow, selectedId === q.id && styles.quizRowActive]}
                  onPress={() => setSelectedId(q.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="document-text" size={16} color={selectedId === q.id ? COLORS.accentBright : COLORS.purpleLight} />
                  <Text style={[styles.quizRowText, selectedId === q.id && styles.quizRowTextActive]} numberOfLines={1}>
                    {q.title}
                  </Text>
                  {selectedId === q.id && <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />}
                </TouchableOpacity>
              ))
            )}

            <View style={[styles.selfPlayRow, role !== 'student' && styles.selfPlayLocked]}>
              <View style={styles.selfPlayInfo}>
                <Ionicons name="person-add" size={16} color={role === 'student' ? COLORS.accentBright : COLORS.textMuted} />
                <Text style={[styles.selfPlayLabel, role !== 'student' && { color: COLORS.textMuted }]}>
                  I&apos;m playing too
                </Text>
              </View>
              {role === 'student' ? (
                <Switch
                  value={selfPlay}
                  onValueChange={setSelfPlay}
                  trackColor={{ false: '#3b3960', true: COLORS.purpleVibrant }}
                  thumbColor={selfPlay ? '#fff' : '#94a3b8'}
                />
              ) : (
                <Text style={styles.lockedNote}>Hosts keep the scoreboard (quizmaster)</Text>
              )}
            </View>
            <Text style={styles.selfPlayHint}>
              {role === 'student'
                ? selfPlay
                  ? "You'll play along — your own results will be saved too."
                  : 'Turn this on to also answer questions yourself.'
                : 'When an educator hosts, the host device stays on the scoreboard and does not answer questions.'}
            </Text>
          </View>

          {started ? (
            <View style={styles.card}>
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE — scoreboard</Text>
              </View>
              {board.length === 0 && (
                <Text style={styles.emptyText}>Waiting for results…</Text>
              )}
              {board.map((p, i) => (
                <View key={p.id} style={styles.rankRow}>
                  <Text style={styles.rankNum}>{i + 1}</Text>
                  <Ionicons name="person" size={15} color={COLORS.purpleLight} />
                  <Text style={styles.rankName}>{p.name}</Text>
                  {p.finished && <Ionicons name="checkmark-circle" size={15} color={COLORS.success} />}
                  <Text style={styles.rankScore}>{p.score.toLocaleString()}</Text>
                </View>
              ))}
              <TouchableOpacity style={styles.endBtn} onPress={endGame} activeOpacity={0.85}>
                <Ionicons name="stop-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.endBtnText}>End Game</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.rosterHeader}>
                  <Text style={styles.cardLabel}>PLAYERS IN LOBBY</Text>
                  <Text style={styles.rosterCount}>{players.filter(p => p.connected).length} connected</Text>
                </View>
                {players.filter(p => p.connected).length === 0 ? (
                  <Text style={styles.emptyText}>Waiting for players to join…</Text>
                ) : (
                  players
                    .filter(p => p.connected)
                    .map(p => (
                      <View key={p.id} style={styles.playerRow}>
                        <Ionicons name="person" size={15} color={COLORS.success} />
                        <Text style={styles.playerName}>{p.name}</Text>
                      </View>
                    ))
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.startBtn,
                  (!selectedId || (!selfPlay && !players.some(p => p.connected))) && styles.startBtnDisabled,
                  starting && { opacity: 0.7 },
                ]}
                onPress={startGame}
                disabled={starting || !selectedId || (!selfPlay && !players.some(p => p.connected))}
                activeOpacity={0.85}
              >
                {starting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="play" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.startBtnText}>Start Game</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.startHint}>Each player answers at their own pace — you&apos;ll watch who&apos;s fastest live.</Text>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  background: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  backBtn: { position: 'absolute', top: 8, right: 0, padding: 8, zIndex: 10 },
  title: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 24, marginTop: 8 },
  subtitle: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 4, marginBottom: 16 },
  codeBanner: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.purpleVibrant,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  codeLabel: { color: COLORS.textSecondary, fontFamily: 'Montserrat-Bold', fontSize: 11, letterSpacing: 2 },
  codeValue: { color: COLORS.accentBright, fontFamily: 'Montserrat-Black', fontSize: 40, letterSpacing: 10, marginVertical: 4 },
  codeHelp: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 11, textAlign: 'center' },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 14,
  },
  cardLabel: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12, letterSpacing: 0.5, marginBottom: 10 },
  labelGap: { marginTop: 20 },
  broadcastBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  broadcastRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  broadcastText: { color: COLORS.success, fontFamily: 'Montserrat-Bold', fontSize: 14 },
  broadcastSub: { color: COLORS.textSecondary, fontFamily: 'Montserrat-Medium', fontSize: 11, marginTop: 6, lineHeight: 16 },
  advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  advancedToggleText: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12 },
  advancedBody: { marginTop: 2 },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.textPrimary,
    fontSize: 15,
    fontFamily: 'Montserrat-Medium',
  },
  inputRow: { flexDirection: 'row', gap: 8 },
  inputFlex: { flex: 1 },
  pasteBtn: {
    width: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Montserrat-Medium', marginTop: 8, lineHeight: 16 },
  ipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  ipChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ipChipActive: { borderColor: COLORS.accentBright, backgroundColor: 'rgba(34, 211, 238, 0.08)' },
  ipChipText: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 13 },
  ipChipTextActive: { color: COLORS.accentBright },
  emptyText: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12, marginTop: 6, lineHeight: 17 },
  quizRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  quizRowActive: { borderColor: COLORS.purpleVibrant, backgroundColor: 'rgba(139, 92, 246, 0.1)' },
  quizRowText: { flex: 1, color: COLORS.textSecondary, fontFamily: 'Montserrat-Medium', fontSize: 14 },
  quizRowTextActive: { color: COLORS.textPrimary, fontFamily: 'Montserrat-SemiBold' },
  selfPlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 20,
  },
  selfPlayLocked: { opacity: 0.8 },
  selfPlayInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selfPlayLabel: { color: COLORS.textPrimary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 },
  lockedNote: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12 },
  selfPlayHint: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Montserrat-Medium', marginTop: 8, lineHeight: 16 },
  rosterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rosterCount: { color: COLORS.textMuted, fontFamily: 'Montserrat-SemiBold', fontSize: 12 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  playerName: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
  },
  startBtnDisabled: { backgroundColor: '#374151', opacity: 0.6 },
  startBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 16 },
  startHint: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Montserrat-Medium', marginTop: 10, textAlign: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  liveText: { color: COLORS.success, fontFamily: 'Montserrat-Bold', fontSize: 13, letterSpacing: 1 },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  rankNum: { color: COLORS.textMuted, fontFamily: 'Montserrat-Bold', fontSize: 13, width: 20 },
  rankName: { flex: 1, color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 13 },
  rankScore: { color: '#FBBF24', fontFamily: 'Montserrat-Bold', fontSize: 14 },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.danger,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 14,
  },
  endBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 15 },
});