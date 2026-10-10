import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, CARD_SHADOW } from '@/constants/educatorTheme';
import { Pill } from './EducatorPrimitives';
import ActivityResultsView from '@/components/ActivityResultsView';
import { CourseGame, resultsFor, roundCount, deleteGame } from '@/services/gameHistoryService';
import { notify } from '@/services/notify';

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

/**
 * One archived game: header, tags, tap-to-expand results.
 *
 * Extracted from CourseGamesSection so the dashboard's Recent games preview
 * and the Hosted games screen render exactly the same card, with the same
 * rematch round toggle and the same ActivityResultsView payload shape.
 *
 * `showCourse` labels which class a game belonged to (or NO CLASS). Off by
 * default because inside a single class's Games tab every row belongs to that
 * class and the pill would be noise; the owner-wide lists turn it on because
 * there the class is the thing that distinguishes the rows.
 */
export function GameHistoryRow({ game, showCourse = false, onDelete }: {
  game: CourseGame;
  showCourse?: boolean;
  /** Called after a successful delete so the owning list can reload. */
  onDelete?: () => void | Promise<void>;
}) {
  // A rematched room has round one's results moved to `previous_round`, so the
  // row opens on whichever round actually has results rather than on an empty
  // "current" one.
  const [expanded, setExpanded] = useState(false);
  const [round, setRound] = useState<Round>('current');

  const rounds = roundCount(game);
  const shown = resultsFor(game, round);
  // Which round the toggle should offer next.
  const otherRound: Round = round === 'current' ? 'previous' : 'current';

  const when = formatWhen(round === 'current' ? game.finished_at : game.previous_round_finished_at)
    || formatWhen(game.finished_at)
    || formatWhen(game.created_at);

  // stopPropagation so the tap never also toggles the row's expand state.
  const confirmDelete = (event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
    Alert.alert(
      'Delete Game',
      `Remove "${game.topic || 'Untitled game'}" from your game history? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGame(game.id);
              await onDelete?.();
              notify('Game deleted', 'The game was removed from your history.');
            } catch (err) {
              console.error('Delete Game Error:', err);
              notify('Delete Failed', err instanceof Error ? err.message : 'Something went wrong.');
            }
          },
        },
      ],
    );
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => setExpanded(v => !v)}
      accessibilityRole="button"
      accessibilityLabel={`${game.topic || 'Game'}. ${expanded ? 'Hide results' : 'Show results'}`}
    >
      <View style={styles.rowHeader}>
        <View style={styles.iconBox}>
          <Ionicons
            name="game-controller-outline"
            size={18}
            color={COLORS.purpleVibrant}
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
          <Text style={styles.count}>{game.player_count}</Text>
          <Text style={styles.countLabel}>
            {game.player_count === 1 ? 'player' : 'players'}
          </Text>
          <TouchableOpacity
            style={styles.deleteBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${game.topic || 'game'}`}
            onPress={confirmDelete}
          >
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
          </TouchableOpacity>
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
        {/* The class it was played with — or an explicit marker for a game
            run from the FAB with no class, which is the case the per-course
            list can never show. */}
        {showCourse && (
          <Pill
            label={(game.course_name || '').toUpperCase() || 'NO CLASS'}
            color={COLORS.accent}
            icon={game.course_id ? 'school-outline' : undefined}
          />
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
              No results were recorded for this game.
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  deleteBtn: { padding: 6 },
  count: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  countLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginRight: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
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
});
