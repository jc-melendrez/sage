import { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, Platform, StatusBar, Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

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
  const { roomCode, isHost, topic } = useLocalSearchParams<{ roomCode: string; isHost: string; topic: string }>();
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [hostId, setHostId] = useState<number | string | null>(null);

  /* ── original effects (UNCHANGED) ── */
  useEffect(() => {
    getCurrentUser().then(u => setCurrentUserId(u?.id));
  }, []);

  useEffect(() => {
    const unsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        setPlayers(snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? []);
      });

    // Listen for game start
    const roomUnsub = firestore()
      .collection('gameRooms')
      .doc(roomCode)
      .onSnapshot(snap => {
        if (snap?.data()?.status === 'active') {
          router.replace({ pathname: '/game/question', params: { roomCode, isHost } });
        }
      });

    return () => { unsub(); roomUnsub(); };
  }, [roomCode]);

  /* ── additive UI-only: read hostId once (existing listeners stay untouched) ── */
  useEffect(() => {
    let live = true;
    firestore().collection('gameRooms').doc(roomCode).get().then(s => {
      if (live) setHostId(s.data()?.hostId ?? null);
    });
    return () => { live = false; };
  }, [roomCode]);

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

  /* ── original handler (UNCHANGED) ── */
  const handleStart = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/start/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const isHostUser = isHost === 'true';
  const playerCount = players.length;
  const ghostSeats = Math.max(0, 4 - playerCount);
  const codeChars = (roomCode || '').split('');

  return (
    <LinearGradient
      colors={[COLORS.bg, COLORS.bgSecondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── header ── */}
        <Animated.View
          style={[styles.header, {
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
          }]}
        >
          <View style={styles.headerLeft}>
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
        </Animated.View>

        {/* ── roster ── */}
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
            const isYou = String(item.id) === String(currentUserId);
            const isHostRow = hostId != null && String(item.id) === String(hostId);
            const initial = (item.displayName || '?').charAt(0).toUpperCase();
            return (
              <View key={item.id} style={[styles.playerCard, isYou && styles.playerCardYou]}>
                {isYou && <View style={styles.playerCardEdge} />}
                <View style={[styles.avatar, isYou && styles.avatarYou]}>
                  <Text style={[styles.avatarText, isYou && styles.avatarTextYou]}>{initial}</Text>
                </View>
                <View style={styles.playerInfo}>
                  <View style={styles.playerNameRow}>
                    <Text style={styles.playerName} numberOfLines={1}>{item.displayName}</Text>
                    {isYou && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
                  </View>
                  <Text style={styles.playerSub}>{isHostRow ? 'Host' : 'Player'} · Ready</Text>
                </View>
                {isHostRow && <Text style={styles.crown}>👑</Text>}
                <View style={styles.readyDot} />
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
      </ScrollView>

      {/* ── bottom CTA bar (safe-area fixed) ── */}
      <Animated.View
        style={[styles.bottomBar, {
          opacity: ctaAnim,
          transform: [{ translateY: ctaAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }]}
      >
        {isHostUser ? (
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
        ) : (
          <View style={styles.waitBar}>
            <Animated.View
              style={[styles.waitBarDot, {
                opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }],
              }]}
            />
            <Text style={styles.waitBarText}>Waiting for host to start...</Text>
          </View>
        )}
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 24 },

  /* ── header ── */
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 },
  headerLeft: { flex: 1, paddingRight: 12 },
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
  startCount: { color: 'rgba(15,12,41,0.7)', fontSize: 14, fontFamily: FONTS.bold },

  waitBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 16, paddingVertical: 16,
    borderWidth: 1, borderColor: 'rgba(127,119,221,0.18)',
  },
  waitBarDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.warning },
  waitBarText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textSecondary },
});