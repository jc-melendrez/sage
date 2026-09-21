import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { generateRoomCode, LanMessage } from '@/services/lanProtocol';
import { LanHostServer } from '@/services/lanHost';
import { LanClientSession } from '@/services/lanClient';
import { lanGame, setLanClient, resetLanState } from '@/services/lanSession';
import {
  startAdvertising,
  stopAdvertising,
  startScanning,
  stopScanning,
  DiscoveredRoom,
} from '@/services/lanDiscovery';

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

export default function DiscoveryTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'host' | 'join'>('host');
  const [code, setCode] = useState(() => generateRoomCode());
  const [title, setTitle] = useState('LAN Quiz');
  const [hosting, setHosting] = useState(false);
  const [hostStatus, setHostStatus] = useState('');
  const [listening, setListening] = useState(false);
  const [rooms, setRooms] = useState<DiscoveredRoom[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const joiningRef = useRef(false);
  const hostRef = useRef<LanHostServer | null>(null);

  const pushLog = (line: string) => setLog(prev => [...prev.slice(-19), line]);

  const onHostPlayerCount = () => hostRef.current?.playerCount ?? 0;

  useEffect(() => {
    if (hosting) {
      const ok = startAdvertising(code.trim(), title, onHostPlayerCount);
      setHostStatus(ok ? 'HOSTING ✓ TCP 5050 + UDP 5051' : 'BROADCAST FAILED — socket error');
    } else {
      stopAdvertising();
      setHostStatus('');
    }
  }, [hosting, code, title]);

  useEffect(() => {
    return () => {
      hostRef.current?.stop();
      hostRef.current = null;
      stopAdvertising();
      stopScanning();
    };
  }, []);

  const toggleHost = () => {
    if (hosting) {
      hostRef.current?.stop();
      hostRef.current = null;
      setHosting(false);
    } else {
      if (!code.trim()) return;
      const host = new LanHostServer(code.trim());
      host.onMessage(msg => {
        if (msg.t === 'roster') {
          pushLog(`${msg.players.filter(p => p.connected).length} player(s) in room`);
        }
      });
      try {
        host.start();
      } catch {
        pushLog('HOST FAILED — TCP server error');
        return;
      }
      hostRef.current = host;
      setHosting(true);
    }
  };

  const toggleListen = () => {
    if (listening) {
      stopScanning();
      setListening(false);
      setRooms([]);
      return;
    }
    const ok = startScanning(list => setRooms(list));
    setListening(ok);
    if (ok) pushLog('LISTENING… waiting for host beacons');
    else pushLog('LISTEN FAILED — socket error');
  };

  const joinRoom = async (room: DiscoveredRoom) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    pushLog(`JOIN: found ${room.code} from ${room.hostIp}`);
    try {
      resetLanState();
      const client = new LanClientSession((msg: LanMessage) => {
        if (msg.t === 'quiz') {
          lanGame.quiz = msg.quiz;
          lanGame.order = msg.order;
          lanGame.timePerQuestion = msg.timePerQuestion;
        }
      });
      setLanClient(client);
      await client.connect(room.hostIp);
      client.join(room.code, 'Tester');
      lanGame.playerName = 'Tester';
      lanGame.hostIp = room.hostIp;
      lanGame.roomCode = room.code;
      lanGame.role = 'player';
      router.push('/game/lan-play' as any);
    } catch {
      pushLog(`CONNECT FAILED for ${room.code} at ${room.hostIp}`);
    } finally {
      joiningRef.current = false;
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
          <Text style={styles.headerTitle}>DISCOVERY SPIKE</Text>
          <Text style={styles.headerSub}>HOST advertises on port 5051 · JOIN auto-detects</Text>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, tab === 'host' && styles.tabActive]}
            onPress={() => setTab('host')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === 'host' && styles.tabTextActive]}>HOST</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'join' && styles.tabActive]}
            onPress={() => setTab('join')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === 'join' && styles.tabTextActive]}>JOIN</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
          {tab === 'host' ? (
            <View style={styles.card}>
              <Text style={styles.label}>ROOM CODE</Text>
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={t => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="______"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
              />
              <Text style={styles.label}>QUIZ TITLE (visible to joiners)</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="LAN Quiz"
                placeholderTextColor={COLORS.textMuted}
              />
              <TouchableOpacity
                style={[styles.actionBtn, hosting ? styles.actionBtnStop : styles.actionBtnStart]}
                onPress={toggleHost}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={hosting ? 'stop' : 'radio'}
                  size={18}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.actionBtnText}>{hosting ? 'STOP BROADCASTING' : 'START BROADCASTING'}</Text>
              </TouchableOpacity>
              {hostStatus ? <Text style={styles.statusText}>{hostStatus}</Text> : null}
            </View>
          ) : (
            <View style={styles.card}>
              <TouchableOpacity
                style={[styles.actionBtn, listening ? styles.actionBtnStop : styles.actionBtnStart]}
                onPress={toggleListen}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={listening ? 'stop' : 'search'}
                  size={18}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.actionBtnText}>
                  {listening ? 'STOP LISTENING' : 'START LISTENING'}
                </Text>
              </TouchableOpacity>

              <Text style={[styles.label, styles.labelGap]}>
                {listening ? `FOUND ROOMS (${rooms.length})` : 'ROOMS'}
              </Text>
              {rooms.length === 0 ? (
                <Text style={styles.emptyText}>
                  {listening ? 'Waiting for the host to broadcast…' : 'Start listening to find the host room.'}
                </Text>
              ) : (
                rooms.map(room => (
                  <TouchableOpacity
                    key={room.code}
                    style={styles.roomRow}
                    onPress={() => joinRoom(room)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.roomCode}>{room.code}</Text>
                    <View style={styles.roomInfo}>
                      <Text style={styles.roomTitle} numberOfLines={1}>{room.quizTitle || 'LAN Quiz'}</Text>
                      <Text style={styles.roomMeta}>
                        {room.players} player(s) · {room.hostIp}
                      </Text>
                    </View>
                    <Ionicons name="enter-outline" size={18} color={COLORS.purpleVibrant} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.label}>LOG</Text>
            {log.length === 0 ? (
              <Text style={styles.emptyText}>No events yet.</Text>
            ) : (
              log.map((line, i) => (
                <Text key={i} style={styles.logLine}>
                  {line}
                </Text>
              ))
            )}
          </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  background: { flex: 1 },
  header: { alignItems: 'center', marginBottom: 16 },
  headerTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Black', fontSize: 20, letterSpacing: 1 },
  headerSub: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 11, marginTop: 4 },
  tabs: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: COLORS.surface, borderRadius: 14, padding: 4, marginBottom: 14 },
  tab: { flex: 1, borderRadius: 11, paddingVertical: 10, alignItems: 'center' },
  tabActive: { backgroundColor: COLORS.purpleVibrant },
  tabText: { color: COLORS.textMuted, fontFamily: 'Montserrat-Bold', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  scroll: { paddingHorizontal: 20 },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  label: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12, letterSpacing: 0.5, marginBottom: 8 },
  labelGap: { marginTop: 18 },
  codeInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.purpleVibrant,
    borderRadius: 12,
    paddingVertical: 14,
    color: COLORS.accentBright,
    fontSize: 32,
    fontFamily: 'Montserrat-Black',
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: 16,
  },
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
    marginBottom: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 15,
  },
  actionBtnStart: { backgroundColor: COLORS.success },
  actionBtnStop: { backgroundColor: COLORS.danger },
  actionBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 14 },
  statusText: { color: COLORS.success, fontFamily: 'Montserrat-SemiBold', fontSize: 12, marginTop: 10, textAlign: 'center' },
  emptyText: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12, marginTop: 2, lineHeight: 17 },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  roomCode: { color: COLORS.accentBright, fontFamily: 'Montserrat-Black', fontSize: 20, letterSpacing: 2, width: 74 },
  roomInfo: { flex: 1 },
  roomTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 14 },
  roomMeta: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 11, marginTop: 3 },
  logLine: { color: COLORS.accentBright, fontFamily: 'Montserrat-Medium', fontSize: 12, marginBottom: 4 },
});