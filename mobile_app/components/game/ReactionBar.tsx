import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { REACTION_EMOJIS, type TeamEntry } from '@/types/game';

const COLORS = {
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  textPrimary: '#FFFFFF',
  textMuted: '#94A3B8',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  extraBold: 'Montserrat-ExtraBold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Reaction {
  id: string;
  emoji: string;
  userId: string;
  displayName: string;
  teamId?: string | null;
}

/** What the bar actually renders: a reaction plus a client-side expiry. */
interface LiveReaction extends Reaction {
  /** ms epoch; the optimistic bubble and the newest server write both carry it. */
  at: number;
}

interface Props {
  roomCode: string;
  enabled: boolean;
  myId: string | null;
  teams: TeamEntry[];
}

const WINDOW_MS = 4000;

/**
 * Lightweight cheer/whinge bar.
 *
 * Reactions are written through the backend rather than straight to Firestore
 * so a client cannot stuff arbitrary documents into the room, and each one is
 * only shown for a few seconds — this is meant to be a quick "nice one" during
 * a question, not a chat log competing with the quiz for attention.
 */
export default function ReactionBar({ roomCode, enabled, myId, teams }: Props) {
  const [live, setLive] = useState<LiveReaction[]>([]);
  const [mine, setMine] = useState<LiveReaction | null>(null);
  const [cooling, setCooling] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const coolRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only watch the newest handful; the subcollection is never pruned, so an
  // unbounded onSnapshot would grow for the whole game.
  useEffect(() => {
    if (!enabled || !roomCode) { setLive([]); return; }
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('reactions')
      .orderBy('createdAt', 'desc')
      .limitToLast(12)
      .onSnapshot(snap => {
        const now = Date.now();
        setLive((snap?.docs ?? [])
          .map(d => {
            const data = d.data() as Reaction & { createdAt?: { toMillis(): number } | null };
            return {
              id: d.id,
              emoji: data.emoji,
              userId: data.userId,
              displayName: data.displayName,
              teamId: data.teamId,
              at: data.createdAt ? data.createdAt.toMillis() : now,
            };
          })
          .filter(r => now - r.at < WINDOW_MS)
          .reverse());
      }, () => { /* listener permissions are optional; bar just stays empty */ });
    return () => unsub();
  }, [roomCode, enabled]);

  // Re-filter on a timer as well, so reactions fade out even when no new
  // document is written and Firestore therefore sends no update.
  useEffect(() => {
    if (!enabled || live.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setLive(prev => prev.filter(r => now - r.at < WINDOW_MS));
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, live.length]);

  useEffect(() => () => { if (coolRef.current) clearTimeout(coolRef.current); }, []);

  const send = async (emoji: string) => {
    if (cooling || !enabled) return;
    setCooling(true);
    if (coolRef.current) clearTimeout(coolRef.current);
    coolRef.current = setTimeout(() => setCooling(false), 1200);

    // Optimistic, so the bar feels instant on a slow connection.
    const optimistic: LiveReaction = {
      id: `local-${Date.now()}`, emoji, userId: myId ?? '',
      displayName: 'You', teamId: null, at: Date.now(),
    };
    setMine(optimistic);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(anim, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => setMine(null));

    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/game/react/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode, emoji }),
      });
    } catch {
      // Losing a reaction is not worth interrupting the quiz over.
    }
  };

  if (!enabled) return null;

  const bubbles = mine ? [mine, ...live.slice(0, 3)] : live.slice(0, 4);
  const teamColors = new Map(teams.map(t => [String(t.id), t.color]));

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {bubbles.length > 0 && (
        <View style={styles.bubbleRow} pointerEvents="none">
          {bubbles.map(r => {
            const color = (r.teamId != null ? teamColors.get(String(r.teamId)) : null) || '#A78BFA';
            return (
              <Animated.View
                key={r.id}
                style={[
                  styles.bubble,
                  { borderColor: color + '99', backgroundColor: color + '22', opacity: anim },
                ]}
              >
                <Text style={styles.bubbleEmoji}>{r.emoji}</Text>
              </Animated.View>
            );
          })}
        </View>
      )}

      <View style={styles.bar}>
        {REACTION_EMOJIS.map(emoji => (
          <TouchableOpacity
            key={emoji}
            onPress={() => send(emoji)}
            disabled={cooling}
            activeOpacity={0.6}
            style={[styles.btn, cooling && styles.btnDim]}
            accessibilityLabel={`React ${emoji}`}
          >
            <Text style={styles.btnEmoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.hintWrap}>
          <Ionicons name="flash" size={11} color={COLORS.textMuted} />
          <Text style={styles.hint}>CHEER</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, alignItems: 'center' },
  bubbleRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-end', height: 44 },
  bubble: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  bubbleEmoji: { fontSize: 19 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.22)',
  },
  btn: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  btnDim: { opacity: 0.5 },
  btnEmoji: { fontSize: 17 },
  hintWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 3, paddingRight: 4 },
  hint: { fontSize: 9, fontFamily: FONTS.extraBold, color: COLORS.textMuted, letterSpacing: 0.6 },
});
