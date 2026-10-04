import { useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PlayerEntry, TeamEntry } from '@/types/game';
import { activeMembersByTeam, teamRankValue } from '@/types/game';

const COLORS = {
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  textPrimary: '#FFFFFF',
  textMuted: '#94A3B8',
  accent: '#7F77DD',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

export interface TickerRow {
  id: string;
  rank: number;
  name: string;
  score: number;
  /** 'you' highlights the viewer's own row; null for a team row. */
  mine: boolean;
  teamId?: string | null;
  /** Gap to the row above, so a lead reads as a lead. */
  delta: number;
}

interface Props {
  teams?: TeamEntry[];
  players?: PlayerEntry[];
  teamMode: boolean;
  myUserId?: string | null;
  /** Rendered above the strip; the ticker itself is always compact. */
  questionNumber?: number;
  questionCount?: number;
}

/**
 * Live standings during play.
 *
 * Two reasons this is a thin strip rather than a full leaderboard: the question
 * is on screen at the same time and it is the thing being answered, and the
 * roster is already on the lobby screen if anybody wants the long version. What
 * the strip adds is *movement* -- a score changing under you is the feedback
 * that makes a team answer feel like a race.
 *
 * Ranked on the same value the results screen settles on (`teamRankValue`), so
 * the order here cannot disagree with the podium at the end.
 */
export default function StandingsTicker({
  teams = [],
  players = [],
  teamMode,
  myUserId,
  questionNumber,
  questionCount,
}: Props) {
  const rows = useMemo(
    () => buildRows({ teams, players, teamMode, myUserId }),
    [teams, players, teamMode, myUserId],
  );

  if (rows.length === 0) return null;

  const top = rows[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name="podium" size={12} color={COLORS.accent} />
        <Text style={styles.headerText}>
          {teamMode ? 'TEAM STANDINGS' : 'STANDINGS'}
          {questionNumber != null && questionCount != null
            ? `  ·  Q${questionNumber}/${questionCount}`
            : ''}
        </Text>
        <Text style={styles.leaderText} numberOfLines={1}>
          {top.name} · {top.score.toLocaleString()}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {rows.map(row => (
          <Row key={row.id} row={row} />
        ))}
      </ScrollView>
    </View>
  );
}

function Row({ row }: { row: TickerRow }) {
  // A short fade on mount so a reorder reads as movement rather than a glitch.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [enter, row.score]);

  return (
    <Animated.View
      style={[
        styles.chip,
        row.mine && styles.chipMine,
        { opacity: enter },
      ]}
    >
      <Text style={[styles.chipRank, row.mine && styles.chipTextMine]}>
        {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}
      </Text>
      <View style={styles.chipMain}>
        <Text style={[styles.chipName, row.mine && styles.chipTextMine]} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.chipMeta}>
          {row.teamId != null && `${row.teamId} · `}
          {row.delta > 0 ? `+${row.delta.toLocaleString()}` : 'leading'}
        </Text>
      </View>
      <Text style={[styles.chipScore, row.mine && styles.chipTextMine]}>
        {row.score.toLocaleString()}
      </Text>
    </Animated.View>
  );
}

/**
 * Ranked rows for the strip.
 *
 * Teams are ranked on the same average-per-active-member value the server pays
 * placement XP from, so a member who joined late does not push their team down
 * the board for playing fewer questions.
 */
function buildRows({
  teams = [],
  players = [],
  teamMode,
  myUserId,
}: {
  teams?: TeamEntry[];
  players?: PlayerEntry[];
  teamMode: boolean;
  myUserId?: string | null;
}): TickerRow[] {
  const source = teamMode
    ? teams.map(t => ({
        id: String(t.id),
        name: t.name,
        score: teamRankValue(t, activeMembersByTeam(players)[String(t.id)] ?? 0),
        mine: false as boolean,
        teamId: null,
      }))
    : players.map(p => ({
        id: String(p.id),
        name: p.displayName,
        score: p.score ?? 0,
        mine: myUserId != null && String(p.id) === String(myUserId),
        teamId: null,
      }));

  const sorted = [...source].sort((a, b) => b.score - a.score);

  return sorted.map((row, i) => ({
    ...row,
    rank: i + 1,
    delta: i === 0 ? 0 : Math.max(0, sorted[i - 1].score - row.score),
  }));
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.25)',
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerText: {
    fontSize: 9, fontFamily: FONTS.bold, color: COLORS.accent, letterSpacing: 1,
  },
  leaderText: {
    flex: 1, textAlign: 'right', fontSize: 10,
    fontFamily: FONTS.semiBold, color: COLORS.textMuted,
  },
  strip: { gap: 6, paddingRight: 4 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 8,
    minWidth: 132,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipMine: { borderColor: COLORS.accent, backgroundColor: 'rgba(127,119,221,0.20)' },
  chipRank: {
    width: 16, textAlign: 'center',
    fontSize: 11, fontFamily: FONTS.bold, color: COLORS.textMuted,
  },
  chipMain: { flex: 1, minWidth: 0 },
  chipName: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  chipMeta: { fontSize: 8, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 1 },
  chipScore: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.accent },
  chipTextMine: { color: '#C4BFFF' },
});