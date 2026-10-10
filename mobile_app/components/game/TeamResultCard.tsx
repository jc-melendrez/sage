import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type TeamEntry } from '@/types/game';

const COLORS = {
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  success: '#10B981',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Props {
  team: TeamEntry;
  rank: number;
  /** Expand the per-member contribution breakdown. */
  expanded: boolean;
  isMyTeam: boolean;
}

/**
 * One team's result card.
 *
 * The team score is the headline, but members are shown underneath with their
 * share of it rather than as a separate leaderboard — that is the point of the
 * mode. A student still sees their own number, it just no longer decides
 * whether they "won".
 */
export default function TeamResultCard({ team, rank, expanded, isMyTeam }: Props) {
  const members = team.members ?? [];
  const accuracy = team.accuracy
    ?? (team.answeredCount > 0
      ? Math.round(((team.correctCount ?? 0) / team.answeredCount) * 100)
      : 0);

  return (
    <View
      style={[
        styles.card,
        { borderColor: isMyTeam ? team.color : 'rgba(127,119,221,0.28)' },
        isMyTeam && { backgroundColor: team.color + '12' },
      ]}
    >
      {/* ── header: rank + name + score ── */}
      <View style={styles.head}>
        <Text style={styles.rank}>
          {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
        </Text>
        <View style={[styles.colorBar, { backgroundColor: team.color }]} />
        <View style={styles.nameWrap}>
          <Text style={[styles.name, { color: team.color }]} numberOfLines={1}>{team.name}</Text>
          <Text style={styles.members}>
            {team.memberCount ?? members.length} {(team.memberCount ?? members.length) === 1 ? 'player' : 'players'}
            {isMyTeam ? ' · your team' : ''}
          </Text>
        </View>
        <Text style={styles.score}>{(team.score ?? 0).toLocaleString()}</Text>
      </View>

      {/* ── stat strip ── */}
      <View style={styles.stats}>
        <Stat icon="checkmark-circle" tint="#34D399" value={`${accuracy}%`} label="Accuracy" />
        <Stat icon="flame" tint="#FDBA74" value={String(team.bestStreak ?? team.teamStreak ?? 0)} label="Best streak" />
        <Stat icon="checkmark-done" tint="#A78BFA" value={String(team.correctCount ?? team.teamCorrect ?? 0)} label="Correct" />
      </View>

      {/* ── member breakdown ── */}
      {expanded && members.length > 0 && (
        <View style={styles.memberBlock}>
          {members.map(member => {
            // Agreement, not share of points: members share one team score, so
            // a per-member point share would be identical for everyone.
            const agree = Math.round(member.agreement ?? 0);
            return (
              <View key={member.id} style={styles.memberRow}>
                <View style={styles.memberAvatarWrap}>
                  <Text style={styles.memberAvatarText} numberOfLines={1}>
                    {(member.displayName || '?').charAt(0).toUpperCase()}
                  </Text>
                  {member.isMvp && (
                    <View style={styles.mvpBadge}>
                      <Ionicons name="star" size={8} color="#0f0c29" />
                    </View>
                  )}
                </View>

                <View style={styles.memberMain}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.displayName}
                    {member.earlyFinisher ? '  ⚡' : ''}
                  </Text>
                  <Text style={styles.memberMeta} numberOfLines={1}>
                    {member.correctCount ?? 0}/{member.answeredCount ?? 0} right
                    {member.bestStreak ? ` · best ${member.bestStreak}` : ''}
                  </Text>
                </View>

                <View style={styles.agreeWrap}>
                  <View style={styles.shareRow}>
                    <View style={styles.shareTrack}>
                      <View
                        style={[
                          styles.shareFill,
                          { width: `${Math.max(2, Math.min(100, agree))}%`, backgroundColor: team.color },
                        ]}
                      />
                    </View>
                    <Text style={styles.shareText}>{agree}%</Text>
                  </View>
                  <Text style={styles.shareLabel} numberOfLines={1}>agreed w/ team</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Stat({
  icon, tint, value, label,
}: { icon: keyof typeof Ionicons.glyphMap; tint: string; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={13} color={tint} />
      <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rank: { fontSize: 16, width: 26, textAlign: 'center' },
  colorBar: { width: 3, height: 30, borderRadius: 2 },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontFamily: FONTS.extraBold },
  members: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 1 },
  score: { fontSize: 17, fontFamily: FONTS.extraBold, color: COLORS.textPrimary },

  stats: { flexDirection: 'row', gap: 6 },
  stat: {
    flex: 1, alignItems: 'center', gap: 2,
    backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingVertical: 7,
  },
  statValue: { fontSize: 13, fontFamily: FONTS.extraBold },
  statLabel: { fontSize: 8, fontFamily: FONTS.medium, color: COLORS.textMuted },

  memberBlock: {
    gap: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberAvatarWrap: { width: 26, height: 26 },
  memberAvatarText: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.10)',
    color: COLORS.textSecondary,
    fontSize: 11, fontFamily: FONTS.bold,
    textAlign: 'center', lineHeight: 26,
    overflow: 'hidden',
  },
  mvpBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#FDBA74',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: COLORS.surface,
  },
  memberMain: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  memberMeta: { fontSize: 9, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 1 },
  agreeWrap: { width: 86, gap: 3 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  shareTrack: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.09)', overflow: 'hidden',
  },
  shareFill: { height: 6, borderRadius: 3 },
  shareText: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textMuted, width: 28, textAlign: 'right' },
  shareLabel: {
    fontSize: 8, fontFamily: FONTS.bold, color: COLORS.textMuted,
    letterSpacing: 0.2, textAlign: 'right',
  },
});
