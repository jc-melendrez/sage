import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, CARD_SHADOW } from '@/constants/educatorTheme';
import { SectionHeader, Pill, EmptyState } from './EducatorPrimitives';
import ActivityResultsView from '@/components/ActivityResultsView';
import {
  CourseGame,
  getCourseGames,
  isGameLive,
  resultsFor,
  roundCount,
} from '@/services/gameHistoryService';

type Round = 'current' | 'previous';

/** "3 Mar, 14:05" — enough to place a game in a lesson without a date header. */
function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    + ' · '
    + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function GameRow({ game }: { game: CourseGame }) {
  // A rematched room has round one's results moved to `previous_round`, so the
  // row opens on whichever round actually has results rather than on an empty
  // "current" one.
  const [expanded, setExpanded] = useState(false);
  const [round, setRound] = useState<Round>('current');

  const rounds = roundCount(game);
  const live = isGameLive(game);
  const shown = resultsFor(game, round);
  // Which round the toggle should offer next.
  const otherRound: Round = round === 'current' ? 'previous' : 'current';

  const when = formatWhen(round === 'current' ? game.finished_at : game.previous_round_finished_at)
    || formatWhen(game.finished_at)
    || formatWhen(game.created_at);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => setExpanded(v => !v)}
      accessibilityRole="button"
      accessibilityLabel={`${game.topic || 'Game'} ${live ? 'in progress' : ''}. ${expanded ? 'Hide results' : 'Show results'}`}
    >
      <View style={styles.rowHeader}>
        <View style={styles.iconBox}>
          <Ionicons
            name={live ? 'radio-outline' : 'game-controller-outline'}
            size={18}
            color={live ? COLORS.success : COLORS.purpleVibrant}
          />
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.topic} numberOfLines={1}>
            {game.topic || 'Untitled game'}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {when}
            {game.host_name ? ` · ${game.host_name}` : ''}
          </Text>
        </View>

        <View style={styles.rowRight}>
          {live ? (
            <Pill label="LIVE" color={COLORS.success} icon="radio-outline" />
          ) : (
            <>
              <Text style={styles.count}>{game.player_count}</Text>
              <Text style={styles.countLabel}>
                {game.player_count === 1 ? 'player' : 'players'}
              </Text>
            </>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={COLORS.textMuted}
          />
        </View>
      </View>

      <View style={styles.tags}>
        <Pill label={game.team_mode ? 'TEAMS' : 'CLASSIC'} color={COLORS.purpleVibrant} />
        {game.question_count > 0 && (
          <Pill label={`${game.question_count} Q`} color={COLORS.purpleVibrant} />
        )}
        {rounds > 1 && <Pill label={`ROUND ${round === 'current' ? 2 : 1}`} color={COLORS.warning} />}
        <View style={styles.roomCode}>
          <Text style={styles.roomCodeText}>{game.room_code}</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.results}>
          {shown ? (
            <>
              <ActivityResultsView results={shown} />
              {rounds > 1 && (
                <Pressable
                  style={styles.roundToggle}
                  onPress={() => setRound(otherRound)}
                  accessibilityRole="button"
                >
                  <Ionicons name="swap-horizontal" size={14} color={COLORS.purplePrimary} />
                  <Text style={styles.roundToggleText}>
                    Show round {otherRound === 'current' ? 2 : 1} of 2
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <Text style={styles.noResults}>
              {live
                ? 'This game is still running. Results appear once it ends.'
                : 'No results were recorded for this game.'}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

interface CourseGamesSectionProps {
  courseId: number;
  /** Course name, for the header copy. */
  courseName?: string;
}

/**
 * The Games tab of a course: every game hosted for this class, newest first.
 *
 * Backed by the backend's GameRoom archive rather than the Firestore room, which
 * is keyed only by room code and therefore cannot answer "what did this class
 * play". In-progress games are listed too -- filtering to finished-only would
 * hide the game the teacher is running until the moment it ended.
 */
export function CourseGamesSection({ courseId, courseName }: CourseGamesSectionProps) {
  const [games, setGames] = useState<CourseGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getCourseGames(courseId);
      setGames(data.games);
    } catch (e: any) {
      // Deliberately still shown as an empty list below, with this as the
      // reason. "No games yet" and "could not load games" must not look alike.
      setGames([]);
      setError(e?.message || 'Could not load games');
    }
  }, [courseId]);

  // Re-read on mount and whenever the class changes. Not useFocusEffect: this
  // section stays mounted while the educator switches Quizzes <-> Games, and
  // remounting the whole screen on every tab flip would refetch everything.
  React.useEffect(() => {
    load();
  }, [load]);

  const finished = useMemo(() => (games ?? []).filter(g => !isGameLive(g)), [games]);
  const live = useMemo(() => (games ?? []).filter(isGameLive), [games]);
  const loading = games === null;

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.purplePrimary} />
      </View>
    );
  }

  const hasGames = finished.length > 0 || live.length > 0;

  return (
    <View>
      <SectionHeader title="Games" />

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} accessibilityRole="button">
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!hasGames ? (
        <EmptyState
          icon="game-controller-outline"
          title="No games yet"
          text={
            error
              ? 'We could not load this class’s games.'
              : `Host a live game from ${courseName ? `${courseName}’s` : 'the class’s'} Quizzes tab and it will appear here with its full results.`
          }
        />
      ) : (
        <>
          {live.length > 0 && (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>IN PROGRESS</Text>
              {live.map(g => <GameRow key={g.id} game={g} />)}
            </View>
          )}
          {finished.length > 0 && (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>
                {live.length > 0 ? 'FINISHED' : `${finished.length} GAME${finished.length === 1 ? '' : 'S'}`}
              </Text>
              {finished.map(g => <GameRow key={g.id} game={g} />)}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 40, alignItems: 'center' },
  group: { marginBottom: 20 },
  groupLabel: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  row: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...CARD_SHADOW,
  },
  rowPressed: { opacity: 0.7 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  topic: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  meta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  countLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginRight: 4 },
  tags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  roomCode: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  roomCodeText: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    color: COLORS.purpleDark,
    letterSpacing: 1.5,
  },
  results: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  noResults: {
    fontSize: 13,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  roundToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
  },
  roundToggleText: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.purplePrimary },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  errorText: { flex: 1, fontSize: 12, fontFamily: FONTS.regular, color: COLORS.danger },
  retry: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.purplePrimary },
});
