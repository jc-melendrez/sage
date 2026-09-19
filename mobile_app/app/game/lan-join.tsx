import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Network from 'expo-network';
import * as Clipboard from 'expo-clipboard';
import { LanClientSession } from '@/services/lanClient';
import { getCurrentUser } from '@/services/authService';
import { lanGame, setLanClient, resetLanState } from '@/services/lanSession';
import { LanMessage, LanPlayer } from '@/services/lanProtocol';
import { startScanning, stopScanning, DiscoveredRoom } from '@/services/lanDiscovery';

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

export default function LanJoinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [rooms, setRooms] = useState<DiscoveredRoom[]>([]);
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'waiting' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [roster, setRoster] = useState<LanPlayer[]>([]);
  const [roomCode, setRoomCode] = useState('');
  const clientRef = useRef<LanClientSession | null>(null);

  const prefillIp = useCallback(async () => {
    try {
      const detected = await Network.getIpAddressAsync();
      if (detected && detected !== '0.0.0.0') setIp(detected);
    } catch {}
  }, []);

  useEffect(() => {
    const ok = startScanning(list => {
      setRooms(list);
      setScanning(true);
    });
    if (!ok) setScanning(false);
    prefillIp();
    (async () => {
      const user = await getCurrentUser();
      if (user?.first_name) setName(user.first_name);
    })();
    return () => {
      stopScanning();
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      setLanClient(null);
    };
  }, [prefillIp]);

  const pasteIp = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setIp(text.trim().slice(0, 62));
  };

  const leave = () => {
    stopScanning();
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setLanClient(null);
    resetLanState();
    router.dismissAll();
  };

  const connect = async (hostIp: string, cleanCode: string, cleanName: string) => {
    setStatus('connecting');
    setStatusText('Connecting to host…');

    const client = new LanClientSession(msg => onClientMessage(msg));
    clientRef.current = client;
    setLanClient(client);

    const onClientMessage = (msg: LanMessage) => {
      switch (msg.t) {
        case 'welcome':
          setRoomCode(msg.roomCode);
          setStatus('waiting');
          setStatusText('Connected! Waiting for the host to start…');
          break;
        case 'roster':
          setRoster(msg.players);
          setStatusText(`${msg.players.filter(p => p.connected).length} player(s) in lobby`);
          break;
        case 'quiz':
          lanGame.quiz = msg.quiz;
          lanGame.order = msg.order;
          lanGame.timePerQuestion = msg.timePerQuestion;
          lanGame.playerName = cleanName;
          lanGame.hostIp = hostIp;
          lanGame.roomCode = cleanCode;
          lanGame.role = 'player';
          router.push('/game/lan-play' as any);
          break;
        case 'leaderboard':
          setRoster(msg.players);
          break;
        case 'end':
          setStatus('error');
          setStatusText(msg.reason || 'Game over');
          break;
        case 'error':
          setStatus('error');
          setStatusText(msg.message || 'Error');
          break;
        default:
          break;
      }
    };

    try {
      await client.connect(hostIp);
      client.join(cleanCode, cleanName);
    } catch {
      setStatus('error');
      setStatusText(`Could not reach host at ${hostIp}. Is everyone on the same hotspot?`);
    }
  };

  const handleJoin = () => {
    const cleanCode = code.trim();
    const cleanName = name.trim().slice(0, 20);
    if (cleanCode.length !== 4) {
      Alert.alert('Missing Code', 'Enter the 4-digit room code shown on the host screen.');
      return;
    }
    if (!cleanName) {
      Alert.alert('Missing Name', 'Enter your nickname.');
      return;
    }

    if (manualOpen) {
      if (!ip.trim()) {
        Alert.alert('Missing IP', 'Enter the host device IP address below.');
        return;
      }
      connect(ip.trim(), cleanCode, cleanName);
      return;
    }

    const room = rooms.find(r => r.code === cleanCode);
    if (!room) {
      setStatus('error');
      setStatusText(
        `Room ${cleanCode} isn&apos;t being found nearby. Make sure you&apos;re on the host&apos;s hotspot and the game is still in the lobby.`
      );
      return;
    }
    connect(room.hostIp, cleanCode, cleanName);
  };

  const waiting = status === 'waiting';
  const busy = status === 'connecting';

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={leave} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.title}>Join LAN Game</Text>
          <Text style={styles.subtitle}>Same Wi-Fi / hotspot — no internet needed</Text>

          <View style={styles.scanBanner}>
            <Ionicons name={scanning ? 'radio' : 'radio-outline'} size={16} color={COLORS.accentBright} />
            <Text style={styles.scanText}>
              {scanning
                ? `Listening for games… ${rooms.length} found nearby`
                : 'Scanning is off — discovering fell back to manual entry.'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>ROOM CODE</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={t => setCode(t.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="0000"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
              editable={!busy && !waiting}
            />

            {rooms.length > 0 && (
              <View style={styles.roomsBlock}>
                <Text style={styles.cardLabel}>FOUND NEARBY</Text>
                {rooms.filter(r => !r.started).map(r => (
                  <TouchableOpacity
                    key={r.code}
                    style={[styles.roomRow, code === r.code && styles.roomRowActive]}
                    onPress={() => setCode(r.code)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.roomCode}>{r.code}</Text>
                    <View style={styles.roomInfo}>
                      <Text style={styles.roomTitle} numberOfLines={1}>{r.quizTitle || 'LAN Quiz'}</Text>
                      <Text style={styles.roomMeta}>{r.players} player(s) in lobby</Text>
                    </View>
                    <Ionicons name="enter-outline" size={18} color={COLORS.purpleVibrant} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={[styles.cardLabel, styles.labelGap]}>YOUR NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={t => setName(t.slice(0, 20))}
              placeholder="Nickname"
              placeholderTextColor={COLORS.textMuted}
              editable={!busy && !waiting}
            />

            <TouchableOpacity style={styles.advancedToggle} onPress={() => setManualOpen(o => !o)} activeOpacity={0.8}>
              <Ionicons name={manualOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
              <Text style={styles.advancedToggleText}>Enter IP manually (troubleshooting)</Text>
            </TouchableOpacity>
            {manualOpen && (
              <View style={styles.advancedBody}>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    value={ip}
                    onChangeText={setIp}
                    placeholder="e.g. 192.168.43.1"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="numbers-and-punctuation"
                  />
                  <TouchableOpacity style={styles.pasteBtn} onPress={pasteIp} activeOpacity={0.7}>
                    <Ionicons name="clipboard-outline" size={18} color={COLORS.purpleVibrant} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>
                  On the host phone: Settings → Wi-Fi → current network → Gateway. Only needed if discovery can&apos;t find the game.
                </Text>
              </View>
            )}
          </View>

          {waiting ? (
            <View style={styles.waitCard}>
              <ActivityIndicator color={COLORS.purpleLight} size="large" />
              <Text style={styles.waitTitle}>{roomCode}</Text>
              <Text style={styles.waitText}>{statusText}</Text>
              {roster.length > 0 && (
                <View style={styles.roster}>
                  {roster.filter(p => p.connected && !p.finished).map(p => (
                    <View key={p.id} style={styles.rosterPill}>
                      <Ionicons name="person" size={12} color={COLORS.purpleLight} />
                      <Text style={styles.rosterName}>{p.name}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.joinBtn, busy && { opacity: 0.7 }]}
              onPress={handleJoin}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="wifi" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.joinBtnText}>Join</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {status === 'error' && (
            <>
              <Text style={styles.errorText}>{statusText}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={leave} activeOpacity={0.8}>
                <Text style={styles.retryBtnText}>Leave</Text>
              </TouchableOpacity>
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
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  scanText: { flex: 1, color: COLORS.textSecondary, fontFamily: 'Montserrat-Medium', fontSize: 12 },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardLabel: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12, letterSpacing: 0.5, marginBottom: 8 },
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
  },
  roomsBlock: { marginTop: 16 },
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
  roomRowActive: { borderColor: COLORS.accentBright, backgroundColor: 'rgba(34, 211, 238, 0.08)' },
  roomCode: { color: COLORS.accentBright, fontFamily: 'Montserrat-Black', fontSize: 20, letterSpacing: 2, width: 58 },
  roomInfo: { flex: 1 },
  roomTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 14 },
  roomMeta: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 11, marginTop: 3 },
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
  advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18 },
  advancedToggleText: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12 },
  advancedBody: { marginTop: 12 },
  hint: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Montserrat-Medium', marginTop: 8, lineHeight: 16 },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 18,
  },
  joinBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 16 },
  waitCard: { alignItems: 'center', marginTop: 24 },
  waitTitle: { color: COLORS.accentBright, fontFamily: 'Montserrat-Bold', fontSize: 34, marginTop: 16, letterSpacing: 6 },
  waitText: { color: COLORS.textSecondary, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 8, textAlign: 'center' },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 },
  rosterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rosterName: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12 },
  errorText: { color: COLORS.danger, fontFamily: 'Montserrat-Medium', fontSize: 12, marginTop: 14, textAlign: 'center' },
  retryBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  retryBtnText: { color: COLORS.textSecondary, fontFamily: 'Montserrat-Bold', fontSize: 14 },
});