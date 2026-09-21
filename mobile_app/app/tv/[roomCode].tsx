import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
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

const MEDALS = ['🥇', '🥈', '🥉'];

const STATUS_META: Record<RoomStatus, { label: string; color: string }> = {
  waiting: { label: 'WAITING', color: COLORS.warning },
  active: { label: 'LIVE', color: COLORS.success },
  finished: { label: 'FINISHED', color: COLORS.accent },
};

export default function TvLeaderboardScreen() {
  const { roomCode } = useLocalSearchParams<{ roomCode: string }>();
  const code = String(roomCode || '').toUpperCase();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setRoom((await res.json()) as RoomData);
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

  const status = room?.status ?? 'waiting';
  const statusMeta = STATUS_META[status] ?? STATUS_META.waiting;

  const students =
    room?.players.filter((p) => p.id !== room.hostId) ?? [];
  const rankedTeams = room?.teams ?? [];

  return (
    <LinearGradient
      colors={[COLORS.bg, COLORS.bgSecondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.root}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.kicker}>LIVE LEADERBOARD</Text>
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
          <Text style={styles.emptySub}>Open `/tv/{code}` on the web build</Text>
        </View>
      ) : !room ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.emptySub}>Connecting…</Text>
        </View>
      ) : room.teamMode ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {rankedTeams.length === 0 ? (
            <Text style={styles.emptyTitle}>No teams yet</Text>
          ) : (
            rankedTeams.map((team, i) => (
              <View key={team.id} style={[styles.teamRow, { borderLeftColor: team.color || COLORS.accent }]}>
                <Text style={styles.rank}>{MEDALS[i] || `${i + 1}`}</Text>
                <View style={styles.teamNameWrap}>
                  <Text style={styles.teamName}>{team.name}</Text>
                  <Text style={styles.meta}>
                    {team.memberCount} {team.memberCount === 1 ? 'player' : 'players'} ·{' '}
                    {team.answeredCount} answered
                  </Text>
                </View>
                <Text style={styles.score}>{Number(team.score).toLocaleString()}</Text>
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {students.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Waiting for players…</Text>
              <Text style={styles.emptySub}>
                Join with code {room.roomCode} on the Play tab
              </Text>
            </View>
          ) : (
            students.map((p, i) => (
              <View
                key={p.id}
                style={[
                  styles.playerRow,
                  p.isFinished && styles.playerFinished,
                ]}
              >
                <Text style={styles.rank}>{MEDALS[i] || `${i + 1}`}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {p.displayName}
                </Text>
                <Text style={styles.meta}>{p.answeredCount} answered</Text>
                <Text style={styles.score}>{Number(p.score).toLocaleString()}</Text>
              </View>
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
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
  kicker: {
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 3,
    color: COLORS.accent,
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
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 24,
    paddingVertical: 20,
    marginBottom: 14,
  },
  playerFinished: { opacity: 0.72 },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderLeftWidth: 8,
    paddingHorizontal: 24,
    paddingVertical: 20,
    marginBottom: 14,
  },
  rank: { width: 56, fontSize: 28, fontFamily: FONTS.extraBold, color: COLORS.textSecondary },
  name: { flex: 1, fontSize: 26, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  teamNameWrap: { flex: 1 },
  teamName: { fontSize: 26, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  meta: { fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 4 },
  score: { fontSize: 30, fontFamily: FONTS.black, color: COLORS.accent, marginLeft: 16 },
  emptyTitle: { fontSize: 28, fontFamily: FONTS.bold, color: COLORS.textPrimary, textAlign: 'center' },
  emptySub: { fontSize: 16, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: 10 },
  footer: { paddingHorizontal: 40, paddingTop: 12, paddingBottom: 28, alignItems: 'center' },
  footerText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted },
});