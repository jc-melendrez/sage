import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Platform,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {
  Animated as RAnimated,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
  LinearTransition,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  ZoomIn,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { API_BASE_URL } from '@/config/api';

const POLL_INTERVAL = 2000;

const COLORS = {
  bg: '#0f0c29',
  bgSecondary: '#1a1640',
  surface: '#1e1b4b',
  cardBg: '#232052',
  purplePrimary: '#7C3AED',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#F87171',
  gold: '#FBBF24',
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

const CONFETTI_COLORS = ['#22D3EE', '#FBBF24', '#34D399', '#A78BFA', '#FB7185', '#60A5FA'];

type RoomStatus = 'waiting' | 'active' | 'finished';

interface PlayerEntry {
  id: string;
  displayName: string;
  score: number;
  answeredCount: number;
  isFinished: boolean;
  teamId?: string | null;
}

interface TeamEntry {
  id: string;
  name: string;
  color?: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  memberCount: number;
}

interface RoomData {
  roomCode: string;
  status: RoomStatus;
  topic: string;
  questionCount: number;
  timePerQuestion: number;
  teamMode: boolean;
  hostId: string;
  hostName: string;
  players: PlayerEntry[];
  teams: TeamEntry[];
}

interface RankedEntry {
  id: string;
  name: string;
  score: number;
  answeredCount: number;
  color?: string;
  finished?: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

const STATUS_META: Record<RoomStatus, { label: string; color: string }> = {
  waiting: { label: 'WAITING', color: COLORS.warning },
  active: { label: 'LIVE', color: COLORS.success },
  finished: { label: 'FINISHED', color: COLORS.gold },
};

// ── tiny score count-up, dependency-free ────────────────────────────────
function CountUp({
  value,
  style,
  duration = 700,
}: {
  value: number;
  style?: any;
  duration?: number;
}) {
  const prev = useRef(value);
  const rafRef = useRef<number | null>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (value === prev.current) return;
    const from = prev.current;
    const to = value;
    prev.current = value;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return (
    <Text style={style} numberOfLines={1}>
      {display.toLocaleString()}
    </Text>
  );
}

// ── confetti burst (no dependency) ──────────────────────────────────────
interface ConfettiPieceState {
  id: number;
  x: number;
  drift: number;
  fall: number;
  size: number;
  color: string;
  round: boolean;
  delay: number;
  spin: number;
}

function ConfettiPiece({ piece, onDone }: { piece: ConfettiPieceState; onDone: (id: number) => void }) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(-30);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    translateX.value = withTiming(piece.drift, { duration: 2600, easing: Easing.out(Easing.quad) });
    translateY.value = withDelay(piece.delay, withTiming(piece.fall, { duration: 2600, easing: Easing.in(Easing.quad) }));
    rotate.value = withDelay(piece.delay, withTiming(piece.spin, { duration: 2600, easing: Easing.linear }));
    opacity.value = withDelay(piece.delay, withTiming(0, { duration: 500 }));
    const t = setTimeout(() => {
      scale.value = withTiming(0, { duration: 200 });
      setTimeout(() => onDone(piece.id), 220);
    }, 2900);
    return () => clearTimeout(t);
  }, [piece, onDone, translateX, translateY, rotate, opacity, scale]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <RAnimated.View
      pointerEvents="none"
      style={[
        styles.confettiPiece,
        {
          left: `${piece.x}%`,
          width: piece.size,
          height: piece.round ? piece.size : piece.size * 0.45,
          borderRadius: piece.round ? piece.size / 2 : 2,
          backgroundColor: piece.color,
        },
        style,
      ]}
    />
  );
}

function Confetti({ burstKey }: { burstKey: number }) {
  const [pieces, setPieces] = useState<ConfettiPieceState[]>([]);

  useEffect(() => {
    if (burstKey === 0) return;
    const next: ConfettiPieceState[] = Array.from({ length: 34 }, (_, i) => ({
      id: burstKey * 1000 + i,
      x: 10 + Math.random() * 80,
      drift: (Math.random() - 0.5) * 320,
      fall: 420 + Math.random() * 380,
      size: 8 + Math.random() * 8,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: i % 3 === 0,
      delay: Math.random() * 220,
      spin: 360 * (Math.random() > 0.5 ? 1 : -1),
    }));
    setPieces(next);
  }, [burstKey]);

  const removePiece = useCallback((id: number) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
  }, []);

  if (pieces.length === 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p) => (
        <ConfettiPiece key={p.id} piece={p} onDone={removePiece} />
      ))}
    </View>
  );
}

// ── floating "+N pts" callout + answered flash ──────────────────────────
function AnswerCallout({
  delta,
  answered,
  seq,
}: {
  delta: number;
  answered: boolean;
  seq: number;
}) {
  const anim = useSharedValue(0);
  const [visibleSeq, setVisibleSeq] = useState(0);

  useEffect(() => {
    if (seq === 0) return;
    if (seq === visibleSeq) return;
    setVisibleSeq(seq);
    anim.value = 0;
    anim.value = withTiming(1, { duration: 90 });
    anim.value = withDelay(
      1600,
      withTiming(0, { duration: 350, easing: Easing.out(Easing.quad) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const isUp = delta > 0;

  const style = useAnimatedStyle(() => {
    const p = anim.value;
    return {
      opacity: p,
      transform: [
        { translateY: -26 * p },
        { translateX: 40 * (isUp ? p : 0) },
        { scale: 0.6 + 0.4 * Math.min(1, p * 4) },
      ],
    };
  });

  return (
    <RAnimated.View pointerEvents="none" style={[styles.callout, style]}>
      {isUp ? (
        <Text style={styles.calloutGain}>+{delta.toLocaleString()}</Text>
      ) : (
        <Text style={styles.calloutNeutral}>answered</Text>
      )}
    </RAnimated.View>
  );
}

// ── leaderboard row (players + teams) ───────────────────────────────────
function RankRow({
  rank,
  entry,
  questionCount,
  bump,
  isLeader,
}: {
  rank: number;
  entry: RankedEntry;
  questionCount: number;
  bump?: { delta: number; answered: boolean; seq: number } | null;
  isLeader: boolean;
}) {
  const progress = questionCount > 0 ? entry.answeredCount / questionCount : 0;
  const medal = MEDALS[rank - 1];

  return (
    <RAnimated.View
      key={entry.id}
      entering={FadeInDown.delay(rank * 60).springify().damping(18)}
      exiting={FadeOut.duration(180)}
      layout={LinearTransition.springify().damping(18)}
      style={[
        styles.rowWrap,
        isLeader && styles.leaderRow,
        rank === 1 && styles.firstRow,
      ]}
    >
      {isLeader && (
        <RAnimated.View
          pointerEvents="none"
          entering={FadeIn.duration(240)}
          style={styles.leaderGlow}
        />
      )}

      <View style={styles.rowInner}>
        {rank <= 3 ? (
          <Text style={[styles.rank, rank === 1 && styles.rankMedal]}>{medal}</Text>
        ) : (
          <Text style={styles.rank}>{rank}</Text>
        )}

        {entry.color ? <View style={[styles.teamDot, { backgroundColor: entry.color }]} /> : null}
        {isLeader && <MaterialCommunityIcons name="crown" size={20} color={COLORS.gold} />}

        <View style={styles.rowNameWrap}>
          <Text style={[styles.name, isLeader && styles.nameLeader]} numberOfLines={1}>
            {entry.name}
          </Text>
          <View style={styles.progressTrack}>
            <RAnimated.View
              layout={LinearTransition.duration(600)}
              style={[
                styles.progressFill,
                {
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: isLeader ? COLORS.gold : entry.color || COLORS.accent,
                },
              ]}
            />
          </View>
        </View>

        <Text style={styles.meta}>{entry.answeredCount} answered</Text>
        <CountUp value={entry.score} style={[styles.score, isLeader && styles.scoreLeader]} />

        {bump ? (
          <AnswerCallout delta={bump.delta} answered={bump.answered} seq={bump.seq} />
        ) : null}
      </View>
    </RAnimated.View>
  );
}

// ── finished podium ceremony ────────────────────────────────────────────
function PodiumCeremony({ entries }: { entries: RankedEntry[] }) {
  const top = entries.slice(0, 3);
  // podium slots: 2nd, 1st, 3rd (left → right)
  const slots = [top[1], top[0], top[2]].filter(Boolean);
  const heights = [150, 210, 110];
  const champion = top[0];

  return (
    <View style={styles.podiumWrap}>
      <RAnimated.View entering={ZoomIn.duration(400)} style={styles.podiumHeader}>
        <Text style={styles.podiumChamp}>
          {champion ? `CHAMPION — ${champion.name}` : 'Round complete'}
        </Text>
      </RAnimated.View>

      <View style={styles.podiumStage}>
        {slots.map((e, i) => (
          <RAnimated.View
            key={e.id}
            entering={FadeInUp.delay(300 + i * 260).springify().damping(16)}
            style={styles.podiumSlot}
          >
            <View style={styles.podiumMedal}>
              <Text style={styles.podiumMedalText}>{MEDALS[top.indexOf(e)]}</Text>
            </View>
            <Text style={styles.podiumName} numberOfLines={1}>
              {e.name}
            </Text>
            <CountUp value={e.score} style={styles.podiumScore} duration={1100} />
            <View
              style={[
                styles.podiumBlock,
                {
                  height: heights[i],
                  backgroundColor:
                    i === 1 ? COLORS.gold : i === 0 ? '#8B93C0' : COLORS.purplePrimary,
                  opacity: i === 1 ? 1 : 0.75,
                },
              ]}
            >
              <Text style={styles.podiumRank}>{i === 1 ? '1' : i === 0 ? '2' : '3'}</Text>
            </View>
          </RAnimated.View>
        ))}
      </View>

      {entries.length > 3 && (
        <ScrollView contentContainerStyle={styles.podiumRest} showsVerticalScrollIndicator={false}>
          {entries.slice(3).map((e, i) => (
            <View key={e.id} style={styles.podiumRestRow}>
              <Text style={styles.podiumRestRank}>{i + 4}</Text>
              <Text style={styles.podiumRestName} numberOfLines={1}>
                {e.name}
              </Text>
              <Text style={styles.podiumRestScore}>{e.score.toLocaleString()}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ── ambient animated glow blobs ─────────────────────────────────────────
function AmbientGlow() {
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);

  useEffect(() => {
    const optsA = { duration: 9000, easing: Easing.inOut(Easing.sin) };
    const optsB = { duration: 11000, easing: Easing.inOut(Easing.sin) };
    const optsC = { duration: 7000, easing: Easing.inOut(Easing.sin) };
    a.value = withRepeat(withTiming(1, optsA), -1, true);
    b.value = withRepeat(withTiming(1, optsB), -1, true);
    c.value = withRepeat(withTiming(1, optsC), -1, true);
  }, [a, b, c]);

  const s1 = useAnimatedStyle(() => ({
    transform: [
      { translateX: a.value * 120 },
      { translateY: -a.value * 60 },
      { scale: 1 + a.value * 0.35 },
    ],
    opacity: 0.14 + a.value * 0.1,
  }));
  const s2 = useAnimatedStyle(() => ({
    transform: [
      { translateX: -b.value * 140 },
      { translateY: b.value * 80 },
      { scale: 1 + b.value * 0.4 },
    ],
    opacity: 0.12 + b.value * 0.08,
  }));
  const s3 = useAnimatedStyle(() => ({
    transform: [{ translateX: c.value * 60 }, { translateY: -c.value * 40 }, { scale: 1 + c.value * 0.3 }],
    opacity: 0.1 + c.value * 0.07,
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <RAnimated.View style={[styles.glowBlob, styles.glowPurple, s1]} />
      <RAnimated.View style={[styles.glowBlob, styles.glowCyan, s2]} />
      <RAnimated.View style={[styles.glowBlob, styles.glowGold, s3]} />
    </View>
  );
}

export default function TvLeaderboard() {
  const { roomCode } = useLocalSearchParams<{ roomCode: string }>();
  const code = String(roomCode || '').toUpperCase();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isWeb = Platform.OS === 'web';
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hintOpacity = useSharedValue(1);

  // poll-diff engine
  const prevScoresRef = useRef<Record<string, number>>({});
  const prevAnsweredRef = useRef<Record<string, number>>({});
  const prevLeaderRef = useRef<string | null>(null);
  const firstPollRef = useRef(true);
  const bumpSeqRef = useRef(0);
  const finishedBurstRef = useRef(false);
  const [bumps, setBumps] = useState<Record<string, { delta: number; answered: boolean; seq: number }>>({});
  const [burstKey, setBurstKey] = useState(0);
  const [leaderFlash, setLeaderFlash] = useState<{ name: string; key: number } | null>(null);

  useEffect(() => {
    if (!leaderFlash) return;
    const t = setTimeout(() => setLeaderFlash(null), 3400);
    return () => clearTimeout(t);
  }, [leaderFlash]);

  const requestFullscreen = useCallback(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const el = document.documentElement as any;
    try {
      if (el.requestFullscreen) return el.requestFullscreen();
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
      if (el.msRequestFullscreen) return el.msRequestFullscreen();
    } catch {}
  }, [isWeb]);

  const exitFullscreen = useCallback(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const d = document as any;
    try {
      if (d.exitFullscreen) return d.exitFullscreen();
      if (d.webkitExitFullscreen) return d.webkitExitFullscreen();
      if (d.msExitFullscreen) return d.msExitFullscreen();
    } catch {}
  }, [isWeb]);

  const toggleFullscreen = useCallback(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const el = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (el) exitFullscreen();
    else requestFullscreen();
  }, [exitFullscreen, requestFullscreen, isWeb]);

  const handleFirstClick = useCallback(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const el = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (el) return;
    requestFullscreen();
  }, [requestFullscreen, isWeb]);

  const handleButtonClick = useCallback(
    (e: any) => {
      e?.stopPropagation?.();
      toggleFullscreen();
    },
    [toggleFullscreen]
  );

  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const sync = () => {
      setIsFullscreen(
        !!(document.fullscreenElement || (document as any).webkitFullscreenElement)
      );
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [isWeb]);

  useEffect(() => {
    if (!isWeb || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isWeb, toggleFullscreen]);

  useEffect(() => {
    if (!isWeb) return;
    if (isFullscreen) {
      hintOpacity.value = withTiming(0, { duration: 300 });
      return;
    }
    const t = setTimeout(() => {
      hintOpacity.value = withTiming(0, { duration: 600 });
    }, 6000);
    return () => clearTimeout(t);
  }, [isWeb, isFullscreen, hintOpacity]);

  const hintStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));

  const load = useCallback(async () => {
    if (!code) {
      setRoom(null);
      setError('No room code');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/game/rooms/${code}/leaderboard/`);
      if (res.status === 404) {
        setRoom(null);
        setError('Room not found');
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as RoomData;

      // ── diff previous poll vs this one ──
      const ranked: RankedEntry[] = data.teamMode
        ? (data.teams ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            score: t.score,
            answeredCount: t.answeredCount,
            color: t.color,
          }))
        : (data.players ?? [])
            .filter((p) => p.id !== data.hostId)
            .map((p) => ({
              id: p.id,
              name: p.displayName,
              score: p.score,
              answeredCount: p.answeredCount,
              finished: p.isFinished,
            }));
      ranked.sort((x, y) => y.score - x.score);

      const newBumps: Record<string, { delta: number; answered: boolean; seq: number }> = {};
      if (!firstPollRef.current) {
        bumpSeqRef.current += 1;
        const seq = bumpSeqRef.current;
        for (const e of ranked) {
          const prevScore = prevScoresRef.current[e.id] ?? 0;
          const scoreDelta = e.score - prevScore;
          const prevAnswered = prevAnsweredRef.current[e.id] ?? 0;
          const answerDelta = e.answeredCount - prevAnswered;
          if (scoreDelta > 0) {
            newBumps[e.id] = { delta: scoreDelta, answered: false, seq };
          } else if (answerDelta > 0) {
            newBumps[e.id] = { delta: 0, answered: true, seq };
          }
        }
        const newLeader = ranked[0]?.id ?? null;
        if (prevLeaderRef.current && newLeader && newLeader !== prevLeaderRef.current) {
          setBurstKey((k) => k + 1);
          setLeaderFlash({ name: ranked[0].name, key: Date.now() });
        }
        prevLeaderRef.current = newLeader;
      } else {
        firstPollRef.current = false;
        prevLeaderRef.current = ranked[0]?.id ?? null;
      }

      // store new baselines
      for (const e of ranked) {
        prevScoresRef.current[e.id] = e.score;
        prevAnsweredRef.current[e.id] = e.answeredCount;
      }

      if (Object.keys(newBumps).length > 0) setBumps(newBumps);
      if (data.status === 'finished' && !finishedBurstRef.current) {
        finishedBurstRef.current = true;
        setBurstKey((k) => k + 1);
      } else if (data.status !== 'finished' && finishedBurstRef.current) {
        finishedBurstRef.current = false;
      }

      setRoom(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Cannot reach server');
    }
  }, [code]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (Object.keys(bumps).length === 0) return;
    const t = setTimeout(() => setBumps({}), 2600);
    return () => clearTimeout(t);
  }, [bumps]);

  const status = room?.status ?? 'waiting';
  const statusMeta = STATUS_META[status] ?? STATUS_META.waiting;

  const students =
    room?.players.filter((p) => p.id !== room.hostId) ?? [];
  const rankedTeams = room?.teams ?? [];

  const rankedEntries: RankedEntry[] = status === 'finished' && room
    ? (room.teamMode
        ? rankedTeams.map((t) => ({
            id: t.id,
            name: t.name,
            score: t.score,
            answeredCount: t.answeredCount,
            color: t.color,
          }))
        : students.map((p) => ({
            id: p.id,
            name: p.displayName,
            score: p.score,
            answeredCount: p.answeredCount,
            finished: p.isFinished,
          }))
      ).sort((x, y) => y.score - x.score)
    : [];

  const liveEntries: RankedEntry[] = room
    ? room.teamMode
      ? rankedTeams.map((t) => ({
          id: t.id,
          name: t.name,
          score: t.score,
          answeredCount: t.answeredCount,
          color: t.color,
        }))
      : students.map((p) => ({
          id: p.id,
          name: p.displayName,
          score: p.score,
          answeredCount: p.answeredCount,
          finished: p.isFinished,
        }))
    : [];
  liveEntries.sort((x, y) => y.score - x.score);

  const webClickProps = isWeb ? { onClick: handleFirstClick } : {};
  const webButtonProps = isWeb ? { onClick: handleButtonClick } : {};

  return (
    <View style={styles.root} {...(webClickProps as any)}>
      <LinearGradient
        colors={[COLORS.bg, COLORS.bgSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.gradient}
      >
        <StatusBar style="light" />
        <AmbientGlow />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {status === 'active' && (
              <View style={styles.liveRow}>
                <RAnimated.View entering={FadeIn.duration(400)} style={styles.kickerRow}>
                  <View style={[styles.pulseDot, { backgroundColor: COLORS.success }]} />
                  <Text style={styles.kicker}>LIVE LEADERBOARD</Text>
                </RAnimated.View>
              </View>
            )}
            {status !== 'active' && (
              <Text style={styles.kickerMuted}>LEADERBOARD</Text>
            )}
            <Text style={styles.topic} numberOfLines={1}>
              {room?.topic || 'Quiz Battle'}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.codePill}>
              <Text style={styles.codeText}>{room?.roomCode || code}</Text>
            </View>
            <View style={[styles.statusPill, { borderColor: statusMeta.color }]}>
              <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
              <Text style={[styles.statusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </View>
          </View>
        </View>

        {error && !room ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{error}</Text>
            <Text style={styles.emptySub}>Open the room code link on the web build</Text>
          </View>
        ) : !room ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.accent} size="large" />
            <Text style={styles.emptySub}>Connecting…</Text>
          </View>
        ) : status === 'finished' ? (
          <View style={styles.finishedWrap}>
            <PodiumCeremony entries={rankedEntries} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {liveEntries.length === 0 ? (
              <View style={styles.center}>
                <RAnimated.View entering={FadeIn.duration(400)}>
                  <Text style={styles.emptyTitle}>Waiting for players…</Text>
                </RAnimated.View>
                <Text style={styles.emptySub}>
                  Join with code {room.roomCode} on the Play tab
                </Text>
              </View>
            ) : (
              liveEntries.map((e, i) => (
                <RankRow
                  key={e.id}
                  rank={i + 1}
                  entry={e}
                  questionCount={room?.questionCount ?? 0}
                  bump={bumps[e.id] ?? null}
                  isLeader={i === 0}
                />
              ))
            )}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Auto-refreshing every few seconds ·{' '}
            {room?.hostName ? `Hosted by ${room.hostName}` : `Room ${code}`}
          </Text>
        </View>
      </LinearGradient>

      <Confetti burstKey={burstKey} />

      {leaderFlash && (
        <RAnimated.View
          key={leaderFlash.key}
          pointerEvents="none"
          entering={ZoomIn.duration(260)}
          exiting={FadeOut.duration(400)}
          style={styles.takeover}
        >
          <Text style={styles.takeoverTop}>NEW LEADER</Text>
          <Text style={styles.takeoverName}>{leaderFlash.name}</Text>
        </RAnimated.View>
      )}

      {isWeb && (
        <>
          <RAnimated.View
            pointerEvents="none"
            style={[styles.hintWrap, hintStyle]}
          >
            <Text style={styles.hintText}>
              Tap anywhere · Press F for fullscreen
            </Text>
          </RAnimated.View>
          <View style={styles.fsButton} {...(webButtonProps as any)}>
            <MaterialCommunityIcons
              name={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
              size={26}
              color={COLORS.textPrimary}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  gradient: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingTop: 32,
    paddingBottom: 24,
  },
  headerLeft: { flex: 1, paddingRight: 24 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveRow: { marginBottom: 8 },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  kicker: {
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 3,
    color: COLORS.accent,
  },
  kickerMuted: {
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 3,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  topic: {
    fontSize: 34,
    fontFamily: FONTS.black,
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  codePill: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  codeText: { fontSize: 28, fontFamily: FONTS.extraBold, color: COLORS.textPrimary, letterSpacing: 4 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontSize: 18, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  list: { paddingHorizontal: 40, paddingBottom: 24 },
  rowWrap: {
    marginBottom: 14,
    borderRadius: 20,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  firstRow: { borderColor: 'rgba(251, 191, 36, 0.45)' },
  leaderRow: { shadowColor: COLORS.gold, shadowOpacity: 0.35, shadowRadius: 18, elevation: 8 },
  leaderGlow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(251, 191, 36, 0.06)',
  },
  rowInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
  rank: { width: 40, fontSize: 26, fontFamily: FONTS.extraBold, color: COLORS.textSecondary },
  rankMedal: { fontSize: 30 },
  teamDot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  rowNameWrap: { flex: 1, marginHorizontal: 12 },
  name: { fontSize: 26, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  nameLeader: { color: COLORS.gold },
  progressTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3 },
  meta: { fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textMuted },
  score: { fontSize: 30, fontFamily: FONTS.black, color: COLORS.accent, marginLeft: 16, minWidth: 92, textAlign: 'right' },
  scoreLeader: { color: COLORS.gold },
  callout: {
    position: 'absolute',
    right: 20,
    bottom: 18,
  },
  calloutGain: {
    fontSize: 22,
    fontFamily: FONTS.black,
    color: COLORS.success,
    textShadowColor: 'rgba(16, 185, 129, 0.6)',
    textShadowRadius: 10,
  },
  calloutNeutral: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
  },
  emptyTitle: { fontSize: 28, fontFamily: FONTS.bold, color: COLORS.textPrimary, textAlign: 'center' },
  emptySub: { fontSize: 16, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: 10 },
  footer: { paddingHorizontal: 40, paddingTop: 12, paddingBottom: 28, alignItems: 'center' },
  footerText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted },
  fsButton: {
    position: 'absolute',
    right: 24,
    bottom: 20,
    backgroundColor: 'rgba(20, 18, 60, 0.85)',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    padding: 12,
  },
  hintWrap: { position: 'absolute', right: 84, bottom: 32 },
  hintText: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    textAlign: 'right',
  },
  glowBlob: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
  },
  glowPurple: { top: -120, left: -160, backgroundColor: COLORS.purplePrimary },
  glowCyan: { bottom: -180, right: -120, backgroundColor: COLORS.accent },
  glowGold: { top: '35%', right: '10%', backgroundColor: COLORS.gold },
  confettiPiece: { position: 'absolute', top: 0 },
  takeover: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 12, 41, 0.72)',
  },
  takeoverTop: {
    fontSize: 34,
    fontFamily: FONTS.black,
    letterSpacing: 8,
    color: COLORS.gold,
  },
  takeoverName: {
    fontSize: 60,
    fontFamily: FONTS.black,
    color: COLORS.textPrimary,
    marginTop: 10,
    textShadowColor: 'rgba(251, 191, 36, 0.5)',
    textShadowRadius: 24,
  },
  finishedWrap: { flex: 1 },
  podiumWrap: { flex: 1, paddingHorizontal: 40 },
  podiumHeader: { alignItems: 'center', paddingTop: 20, paddingBottom: 10 },
  podiumChamp: {
    fontSize: 30,
    fontFamily: FONTS.black,
    color: COLORS.gold,
    letterSpacing: 1,
    textShadowColor: 'rgba(251, 191, 36, 0.4)',
    textShadowRadius: 18,
  },
  podiumStage: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 18,
    paddingBottom: 18,
  },
  podiumSlot: { alignItems: 'center', width: 160 },
  podiumMedal: { marginBottom: 6 },
  podiumMedalText: { fontSize: 40 },
  podiumName: {
    fontSize: 20,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    maxWidth: 150,
  },
  podiumScore: {
    fontSize: 22,
    fontFamily: FONTS.black,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 8,
  },
  podiumBlock: {
    width: '100%',
    borderRadius: 14,
    alignItems: 'center',
    paddingTop: 10,
    justifyContent: 'flex-start',
  },
  podiumRank: { fontSize: 34, fontFamily: FONTS.black, color: 'rgba(255,255,255,0.9)' },
  podiumRest: { paddingHorizontal: 20, paddingBottom: 30 },
  podiumRestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(127, 119, 221, 0.15)',
  },
  podiumRestRank: { width: 40, fontSize: 20, fontFamily: FONTS.extraBold, color: COLORS.textMuted },
  podiumRestName: { flex: 1, fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  podiumRestScore: { fontSize: 20, fontFamily: FONTS.black, color: COLORS.accent },
});