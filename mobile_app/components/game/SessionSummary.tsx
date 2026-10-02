import { View, Text, StyleSheet } from 'react-native';
import {
  accuracyPct,
  type QuestionBreakdown,
  type SessionBreakdown,
} from '@/services/gameBreakdown';

const COLORS = {
  surface: '#1e1b4b',
  surfaceLight: '#2d2a6e',
  border: 'rgba(127,119,221,0.30)',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  good: '#34D399',
  bad: '#F87171',
  accent: '#7F77DD',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

export interface TeamNameLookup {
  name: string;
  color?: string;
}

/**
 * One line of the review: what you answered, what it should have been, and how
 * the rest of the session did on the same question.
 */
function QuestionRow({
  row,
  teams,
}: {
  row: QuestionBreakdown;
  teams: Record<string, TeamNameLookup>;
}) {
  const { mine, question } = row;
  const answered = mine != null;
  const tint = !answered ? COLORS.textMuted : mine.correct ? COLORS.good : COLORS.bad;

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={[styles.rowNum, { color: tint }]}>Q{row.index + 1}</Text>
        <View style={[styles.mark, answered && (mine.correct ? styles.markGood : styles.markBad)]}>
          <Text style={styles.markText}>{answered ? (mine.correct ? '✓' : '✗') : '–'}</Text>
        </View>
        {row.aheadOfRoom ? <Text style={styles.chipGood}>you had this one</Text> : null}
        {row.behindRoom ? <Text style={styles.chipBad}>others got this</Text> : null}
        <View style={{ flex: 1 }} />
        <Text style={styles.roomPct}>{row.answered > 0 ? `${row.accuracy}% of players` : 'no answers'}</Text>
      </View>

      <Text style={styles.qText} numberOfLines={2}>{question.question}</Text>

      {/* Only the viewer's own pick. A peer's pick is never rendered here. */}
      {answered && mine.picked && !mine.correct ? (
        <Text style={styles.pickBad}>You picked: <Text style={styles.pickValue}>{mine.picked}</Text></Text>
      ) : null}
      {answered ? (
        <Text style={styles.pickGood}>
          Correct: <Text style={styles.pickValue}>{question.correctAnswer}</Text>
        </Text>
      ) : (
        <Text style={styles.pickMuted}>You didn&rsquo;t answer this one</Text>
      )}

      {!mine?.correct && question.explanation ? (
        <Text style={styles.explanation}>{question.explanation}</Text>
      ) : null}

      {/* Team head-to-head. Absent in classic, offline and LAN, which have no
          teams, so this simply does not render there. */}
      {row.teams.length > 1 ? (
        <View style={styles.teamBars}>
          {row.teams.map(t => {
            const meta = teams[t.teamId];
            const pct = accuracyPct(t.correct, t.answered);
            return (
              <View key={t.teamId} style={styles.teamBarRow}>
                <Text style={styles.teamBarName} numberOfLines={1}>{meta?.name ?? 'Team'}</Text>
                <View style={styles.teamBarTrack}>
                  <View
                    style={[
                      styles.teamBarFill,
                      { width: `${pct}%`, backgroundColor: meta?.color ?? COLORS.accent },
                    ]}
                  />
                </View>
                <Text style={styles.teamBarPct}>{pct}%</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The post-game review, identical for online rooms, offline practice and LAN.
 *
 * Deliberately reports the viewer's own picks and the room's aggregate accuracy
 * and nothing else: a peer's picked answer is never shown, so a leaderboard
 * cannot be used to work out how somebody else answered. That is a UI choice,
 * not a security boundary -- the underlying player documents are readable by the
 * room.
 */
export default function SessionSummary({
  breakdown,
  teams = {},
}: {
  breakdown: SessionBreakdown;
  teams?: Record<string, TeamNameLookup>;
}) {
  const answered = breakdown.mineAnswered > 0;
  if (!answered) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>How it went</Text>
        <Text style={styles.empty}>
          No answers were recorded for this session, so there is nothing to review yet.
        </Text>
      </View>
    );
  }

  const myPct = accuracyPct(breakdown.mineCorrect, breakdown.mineAnswered);
  const hardest = breakdown.hardestIndex != null ? breakdown.perQuestion[breakdown.hardestIndex] : null;
  const easiest = breakdown.easiestIndex != null ? breakdown.perQuestion[breakdown.easiestIndex] : null;
  const vsRoom = myPct - breakdown.roomAccuracy;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>How it went</Text>

      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{myPct}%</Text>
          <Text style={styles.tileLabel}>your accuracy</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{breakdown.roomAccuracy}%</Text>
          <Text style={styles.tileLabel}>everyone</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>{vsRoom > 0 ? 'ahead of' : vsRoom < 0 ? 'behind' : 'level with'}</Text>
          <Text
            style={[
              styles.tileValueSmall,
              { color: vsRoom > 0 ? COLORS.good : vsRoom < 0 ? COLORS.bad : COLORS.textSecondary },
            ]}
          >
            {vsRoom === 0 ? '—' : `${Math.abs(vsRoom)}%`}
          </Text>
        </View>
      </View>

      {hardest ? (
        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>
            {hardest.accuracy}% got this one · Q{hardest.index + 1}
          </Text>
          <Text style={styles.calloutText} numberOfLines={3}>{hardest.question.question}</Text>
          {hardest.question.explanation ? (
            <Text style={styles.calloutWhy}>{hardest.question.explanation}</Text>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.subheading}>
        {breakdown.missed.length > 0
          ? `Review · ${breakdown.missed.length} to look at`
          : 'Every question answered correctly'}
      </Text>

      {/* Misses first: those are the ones worth the player's time, so they lead. */}
      {(breakdown.missed.length > 0
        ? breakdown.missed
        : breakdown.perQuestion.filter(q => q.mine != null)
      ).map(row => (
        <QuestionRow key={row.index} row={row} teams={teams} />
      ))}

      {easiest && hardest && easiest.index !== hardest.index && breakdown.missed.length === 0 ? (
        <Text style={styles.footnote}>
          Strongest question: Q{easiest.index + 1} at {easiest.accuracy}%.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  heading: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  subheading: {
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 10,
  },
  empty: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },

  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  tileValue: { fontSize: 20, fontFamily: FONTS.black, color: COLORS.textPrimary },
  tileValueSmall: { fontSize: 18, fontFamily: FONTS.black },
  tileLabel: {
    marginTop: 3,
    fontSize: 9,
    fontFamily: FONTS.bold,
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },

  callout: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceLight,
  },
  calloutTitle: {
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    color: COLORS.accent,
    marginBottom: 6,
  },
  calloutText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  calloutWhy: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
  },

  row: {
    marginBottom: 10,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowNum: { fontSize: 12, fontFamily: FONTS.extraBold },
  mark: {
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.20)',
  },
  markGood: { backgroundColor: 'rgba(52,211,153,0.22)' },
  markBad: { backgroundColor: 'rgba(248,113,113,0.22)' },
  markText: { fontSize: 11, fontFamily: FONTS.black, color: COLORS.textPrimary },
  chipGood: {
    fontSize: 9,
    fontFamily: FONTS.extraBold,
    color: COLORS.good,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  chipBad: {
    fontSize: 9,
    fontFamily: FONTS.extraBold,
    color: COLORS.bad,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  roomPct: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.textMuted },

  qText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  pickBad: { marginTop: 6, fontSize: 12, fontFamily: FONTS.medium, color: COLORS.bad },
  pickGood: { marginTop: 6, fontSize: 12, fontFamily: FONTS.medium, color: COLORS.good },
  pickMuted: { marginTop: 6, fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },
  pickValue: { fontFamily: FONTS.bold, color: COLORS.textPrimary },
  explanation: {
    marginTop: 7,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
  },

  teamBars: { marginTop: 10, gap: 5 },
  teamBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamBarName: {
    width: 74,
    fontSize: 10,
    fontFamily: FONTS.bold,
    color: COLORS.textMuted,
  },
  teamBarTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  teamBarFill: { height: 5, borderRadius: 3 },
  teamBarPct: { width: 34, textAlign: 'right', fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textSecondary },

  footnote: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
});