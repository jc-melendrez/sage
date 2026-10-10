import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { SectionHeader, EmptyState } from './EducatorPrimitives';
import { GameHistoryRow } from './GameHistoryRow';
import {
  CourseGame,
  getCourseGames,
  getMyGames,
} from '@/services/gameHistoryService';

interface CourseGamesSectionProps {
  /**
   * Games for one class. Omit it for every game the educator hosted, class
   * or no class — the owner-wide list behind the dashboard's Recent games and
   * the Hosted games screen (a room run from the FAB archives with no course
   * and can never appear in a per-class query).
   */
  courseId?: number;
  /** Course name, for the header and empty-state copy. */
  courseName?: string;
  /** Section heading. Defaults to "Games". */
  title?: string;
  /** Label each row with its class (or NO CLASS). On for owner-wide lists. */
  showCourse?: boolean;
}

/**
 * A list of archived games, newest first.
 *
 * Backed by the backend's GameRoom archive rather than the Firestore room, which
 * is keyed only by room code and therefore cannot answer "what did this class
 * play". Every archived row is rendered as history: there is no live/in-progress
 * presentation, so a room whose finish call was never recorded still reads as a
 * past game rather than one that is still running.
 *
 * With a `courseId` it reads `GET /users/courses/<id>/games/`; without one it
 * reads `GET /users/games/mine/`. Everything below the fetch is shared.
 */
export function CourseGamesSection({
  courseId,
  courseName,
  title = 'Games',
  showCourse = false,
}: CourseGamesSectionProps) {
  const [allGames, setAllGames] = useState<CourseGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = courseId != null ? await getCourseGames(courseId) : await getMyGames();
      setAllGames(data.games);
    } catch (e: any) {
      // Deliberately still shown as an empty list below, with this as the
      // reason. "No games yet" and "could not load games" must not look alike.
      setAllGames([]);
      setError(e?.message || 'Could not load games');
    }
  }, [courseId]);

  // Re-read on mount and whenever the class changes. Not useFocusEffect: this
  // section stays mounted while the educator switches Quizzes <-> Games, and
  // remounting the whole screen on every tab flip would refetch everything.
  React.useEffect(() => {
    load();
  }, [load]);

  const games = allGames ?? [];
  const loading = allGames === null;

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.purplePrimary} />
      </View>
    );
  }

  const hasGames = games.length > 0;

  const emptyText = error
    ? courseName
      ? `We could not load ${courseName}’s games.`
      : 'We could not load your hosted games.'
    : courseName
      ? `Host a game for ${courseName} and it will appear here with its full results.`
      : 'Host a game from the create button and it will appear here with its full results.';

  return (
    <View>
      <SectionHeader title={title} />

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
          text={emptyText}
        />
      ) : (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>
            {`${games.length} GAME${games.length === 1 ? '' : 'S'}`}
          </Text>
          {games.map(g => (
            <GameHistoryRow key={g.id} game={g} showCourse={showCourse} onDelete={load} />
          ))}
        </View>
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
