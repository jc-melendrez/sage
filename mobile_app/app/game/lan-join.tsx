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
  const [ip, setIp] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'waiting' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [roster, setRoster] = useState<LanPlayer[]>([]);
  const [roomCode, setRoomCode] = useState('');
  const clientRef = useRef<LanClientSession | null>(null);

  const prefillIp = useCallback(async () => {
    try {
      const ip = await Network.getIpAddressAsync();
      if (ip && ip !== '0.0.0.0') setIp(ip);
    } catch {}
  }, []);

  useEffect(() => {
    prefillIp();
    (async () => {
      const user = await getCurrentUser();
      if (user?.first_name) setName(user.first_name);
    })();
    return () => {
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
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setLanClient(null);
    resetLanState();
    router.dismissAll();
  };

  const handleJoin = async () => {
    const cleanIp = ip.trim();
    const cleanCode = code.trim();
    const cleanName = name.trim().slice(0, 20);
    if (!cleanIp) {
      Alert.alert('Missing IP', 'Enter the host device IP address.');
      return;
    }
    if (cleanCode.length !== 4) {
      Alert.alert('Missing Code', 'Enter the 4-digit room code.');
      return;
    }
    if (!cleanName) {
      Alert.alert('Missing Name', 'Enter your nickname.');
      return;
    }

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
          lanGame.hostIp = cleanIp;
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
      await client.connect(cleanIp);
      client.join(cleanCode, cleanName);
    } catch {
      setStatus('error');
      setStatusText(`Could not reach host at ${cleanIp}: 5050. Is everyone on the same hotspot?`);
    }
  };

  const waiting = status === 'waiting';

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={leave} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.title}>Join LAN Game</Text>
          <Text style={styles.subtitle}>Same Wi-Fi / hotspot — no internet needed</Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>HOST IP ADDRESS</Text>
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
              On the host phone, open Settings → Wi-Fi → the current network → Gateway. Type that number here. A paste button can grab it from a message.
            </Text>

            <Text style={[styles.cardLabel, styles.labelGap]}>ROOM CODE</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={t => setCode(t.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="0000"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
            />

            <Text style={[styles.cardLabel, styles.labelGap]}>YOUR NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={t => setName(t.slice(0, 20))}
              placeholder="Nickname"
              placeholderTextColor={COLORS.textMuted}
            />
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
              style={[styles.joinBtn, status === 'connecting' && { opacity: 0.7 }]}
              onPress={handleJoin}
              disabled={status === 'connecting'}
              activeOpacity={0.8}
            >
              {status === 'connecting' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="wifi" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.joinBtnText}>Join Lobby</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {status === 'error' && (
            <Text style={styles.errorText}>{statusText}</Text>
          )}
          {status === 'error' && (
            <TouchableOpacity style={styles.retryBtn} onPress={leave} activeOpacity={0.8}>
              <Text style={styles.retryBtnText}>Leave</Text>
            </TouchableOpacity>
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
  subtitle: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 4, marginBottom: 20 },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardLabel: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12, letterSpacing: 0.5, marginBottom: 8 },
  labelGap: { marginTop: 18 },
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
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 20,
  },
  joinBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 15 },
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