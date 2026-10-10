import { View, Text, StyleSheet } from 'react-native';
import { type PlayerInsight } from '@/services/gameBreakdown';

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

/**
 * Per-player strengths and weaknesses for the session.
 *
 * The sibling `SessionSummary` reports the viewer's own picks; this panel is the
 * room-wide counterpart educators asked for -- what each player was good at
 * (their strongest question type) and weak at (their weakest type and the
 * specific questions they missed). It never shows what a peer picked, only
 * whether they got a question right.
 */
export default function PlayerInsights({ insights }: { insights: PlayerInsight[] }) {
  const played = insights.filter((i) => !i.didNotPlay);
  const satOut = insights.filter((i) => i.didNotPlay);
  if (played.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>Good at &amp; needs work</Text>
        <Text style={styles.empty}>
          No answers were recorded for any player, so there is nothing to break down yet.
        </Text>
      </View>
    );
  }

  // Most accurate first, so the room's standout leads the list.
  const ordered = [...played].sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Good at &amp; needs work</Text>
      <Text style={styles.sub}>What each player got right and missed this session.</Text>

      {ordered.map((p) => (
        <View key={p.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.name} numberOfLines={1}>{p.displayName}</Text>
            <Text style={styles.accuracy}>{p.accuracy}%</Text>
          </View>
          <Text style={styles.meta}>
            {p.correct}/{p.answered} correct
            {p.bestStreak > 1 ? ` · best streak ${p.bestStreak}` : ''}
          </Text>

          {p.strongest || p.weakest ? (
            <View style={styles.skillRow}>
              {p.strongest ? (
                <View style={[styles.skillChip, styles.skillGood]}>
                  <Text style={styles.skillText}>
                    Strong: {p.strongest.label} ({p.strongest.accuracy}%)
                  </Text>
                </View>
              ) : null}
              {p.weakest ? (
                <View style={[styles.skillChip, styles.skillBad]}>
                  <Text style={styles.skillText}>
                    Needs work: {p.weakest.label} ({p.weakest.accuracy}%)
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {p.missed.length > 0 ? (
            <View style={styles.missedWrap}>
              <Text style={styles.missedLabel}>
                Missed {p.missed.length} question{p.missed.length === 1 ? '' : 's'}
              </Text>
              {p.missed.map((m) => (
                <Text key={m.index} style={styles.missedRow} numberOfLines={2}>
                  <Text style={styles.missedNum}>Q{m.index + 1}</Text>
                  {'  '}
                  {m.question || '—'}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.perfect}>No misses — a clean sweep.</Text>
          )}
        </View>
      ))}

      {satOut.length > 0 ? (
        <Text style={styles.satOut}>
          Did not play: {satOut.map((p) => p.displayName).join(', ')}
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
  },
  sub: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
  empty: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },

  card: {
    marginBottom: 10,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  accuracy: { fontSize: 15, fontFamily: FONTS.black, color: COLORS.textPrimary },
  meta: {
    marginTop: 3,
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
  },

  skillRow: { marginTop: 10, gap: 6 },
  skillChip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skillGood: {
    borderColor: 'rgba(52,211,153,0.4)',
    backgroundColor: 'rgba(52,211,153,0.12)',
  },
  skillBad: {
    borderColor: 'rgba(248,113,113,0.4)',
    backgroundColor: 'rgba(248,113,113,0.12)',
  },
  skillText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },

  missedWrap: { marginTop: 10 },
  missedLabel: {
    fontSize: 10,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.5,
    color: COLORS.bad,
    marginBottom: 4,
  },
  missedRow: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  missedNum: { fontFamily: FONTS.bold, color: COLORS.textPrimary },
  perfect: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.good,
  },
  satOut: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
});
