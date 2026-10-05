import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { pfpSource } from '@/constants/pfps';

export interface ActivityResultMember {
  user_id?: number | string;
  name?: string;
  score?: number;
  correct?: number;
  answered?: number;
  /** Only present on classic-mode participants; team mode ranks whole teams. */
  rank?: number | null;
  /** Profile picture written by the settle for both modes. */
  avatar?: string | null;
  /** Correct out of `answered`, as a percentage. 0 when nobody answered. */
  accuracy?: number;
  /** How often this member voted with their team, 0-100. Team mode only. */
  agreement?: number;
  /** Best run of consecutive correct answers. */
  bestStreak?: number;
  /** Holds the team together: renames it, locks in its answer. */
  isLeader?: boolean;
  /** Highest agreement on their team. At most one per team. */
  isMvp?: boolean;
  /** Submitted before the round closed, rather than waiting out the clock. */
  earlyFinisher?: boolean;
}

export interface ActivityResultTeam {
  id?: string;
  name?: string;
  score?: number;
  correct?: number;
  rank?: number | null;
  accuracy?: number;
  bestStreak?: number;
  /** Resolved to ids at settle time, so the names can be attributed here. */
  leaderId?: string | number | null;
  mvpId?: string | number | null;
  members?: ActivityResultMember[];
}

export interface ActivityResults {
  mode?: 'classic' | 'team' | 'offline';
  roomCode?: string;
  questionCount?: number;
  participants?: ActivityResultMember[];
  teams?: ActivityResultTeam[];
  score?: number;
  correct?: number;
  answered?: number;
  total?: number;
  timePerQuestion?: number;
  quizType?: string;
}

const COLORS = {
  purpleVibrant: '#8B5CF6',
  purpleGhost: '#DDD6FE',
  textPrimary: '#3a107a',
  textMuted: '#6B7280',
  success: '#10B981',
  warning: '#F59E0B',
  surface: '#FFFFFF',
  bgSecondary: '#F4F2FA',
  border: 'rgba(44, 29, 0, 0.12)',
};

const PODIUM = ['#F59E0B', '#9CA3AF', '#B45309'];

function initials(name?: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A single-word marker on a member row.
 *
 * Icon-only on purpose: MVP / leader / early finisher all apply to the same
 * handful of rows, and spelling them out put three labels across a row that is
 * already carrying a name, an accuracy line and a score. The label is kept as an
 * accessibilityLabel so a screen reader still says what the glyph means.
 */
function Badge({ icon, tint, label }: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: `${tint}1F` }]} accessibilityLabel={label}>
      <Ionicons name={icon} size={10} color={tint} />
    </View>
  );
}

function StatChip({ icon, label, value, tint }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  tint: string;
}) {
  return (
    <View style={styles.statChip}>
      <View style={[styles.statChipIcon, { backgroundColor: `${tint}1F` }]}>
        <Ionicons name={icon} size={13} color={tint} />
      </View>
      <Text style={styles.statChipValue}>{value}</Text>
      <Text style={styles.statChipLabel}>{label}</Text>
    </View>
  );
}

function MemberRow({ member, isMe, tone }: {
  member: ActivityResultMember;
  isMe?: boolean;
  tone?: string;
}) {
  const answered = member.answered ?? 0;
  const correct = member.correct ?? 0;
  // Older rows predate the snapshot's `accuracy`; deriving it keeps them from
  // rendering as blank rather than silently showing 0%.
  const accuracy = member.accuracy ?? (answered > 0 ? Math.round((correct / answered) * 100) : 0);
  const streak = member.bestStreak ?? 0;
  const source = pfpSource(member.avatar);

  const sub: string[] = [];
  if (answered > 0) {
    sub.push(`${correct}/${answered} correct`);
    sub.push(`${accuracy}%`);
    if (typeof member.agreement === 'number') sub.push(`${member.agreement}% agreed`);
  }

  return (
    <View style={[styles.memberRow, isMe && styles.memberRowMe, tone ? { borderLeftColor: tone } : null]}>
      {source ? (
        <Image source={source} style={[styles.avatar, styles.avatarPhoto]} resizeMode="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, isMe && styles.avatarMe]}>
          <Text style={[styles.avatarText, isMe && styles.avatarTextMe]}>{initials(member.name)}</Text>
        </View>
      )}
      <View style={styles.memberMeta}>
        <View style={styles.memberNameRow}>
          <Text style={[styles.memberName, isMe && styles.memberNameMe]} numberOfLines={1}>
            {member.name || 'Player'}
            {isMe ? '  (you)' : ''}
          </Text>
          {member.isMvp ? <Badge icon="ribbon" tint={COLORS.warning} label="MVP" /> : null}
          {member.isLeader ? <Badge icon="star" tint={COLORS.purpleVibrant} label="Team leader" /> : null}
          {member.earlyFinisher ? <Badge icon="flash" tint={COLORS.success} label="Finished early" /> : null}
        </View>
        {sub.length > 0 ? (
          <Text style={styles.memberSub} numberOfLines={1}>{sub.join('   ')}</Text>
        ) : null}
      </View>
      {streak >= 2 ? (
        <View style={styles.streakPill} accessibilityLabel={`Best run ${streak}`}>
          <Ionicons name="flame" size={10} color={COLORS.warning} />
          <Text style={styles.streakText}>{streak}</Text>
        </View>
      ) : null}
      <Text style={styles.memberScore}>{member.score ?? 0}</Text>
    </View>
  );
}

/**
 * Renders the settled snapshot attached to a Recent Activity row.
 *
 * The list row only ever has room for a title and a one-line description, so
 * this is where the parts that were actually interesting live: who else played,
 * what they scored, how accurate they were, who led and who carried their team,
 * and -- for a team game -- how each team placed and who was on it. Every field
 * below is written by the settle, so nothing here is derived on the client from
 * a screen the student no longer has open. Rows written before snapshots existed
 * render nothing rather than an empty shell, and the caller falls back to the
 * description.
 */
export default function ActivityResultsView({ results, myUserId, myTeamId }: {
  results?: ActivityResults | null;
  myUserId?: number | string;
  myTeamId?: string;
}) {
  if (!results) return null;

  const mode = results.mode;
  const isTeam = mode === 'team' && Array.isArray(results.teams) && results.teams.length > 0;
  const isClassic = mode === 'classic' && Array.isArray(results.participants)
    && results.participants.length > 0;
  const isOffline = mode === 'offline' && typeof results.score === 'number';

  if (!isTeam && !isClassic && !isOffline) return null;

  const mine = (list: ActivityResultMember[] | undefined) =>
    list?.find(m => !!myUserId && String(m.user_id) === String(myUserId)) ?? null;
  const ranked = [...results.participants!]
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

  return (
    <View style={styles.wrap}>
      {isTeam ? (
        <>
          <View style={styles.sectionHead}>
            <Ionicons name="people" size={14} color={COLORS.purpleVibrant} />
            <Text style={styles.sectionTitle}>Teams & players</Text>
            {results.questionCount ? (
              <Text style={styles.sectionMeta}>{results.questionCount} questions</Text>
            ) : null}
          </View>
          {results.teams!.map((team, index) => {
            const rank = team.rank ?? index + 1;
            const podium = rank <= 3 ? PODIUM[rank - 1] : null;
            const isMyTeam = !!myTeamId && String(team.id) === String(myTeamId);
            const nameOf = (id: string | number | null | undefined) => {
              if (id == null) return null;
              const hit = (team.members ?? []).find(m => String(m.user_id) === String(id));
              return hit?.name || null;
            };
            const leaderName = nameOf(team.leaderId);
            const mvpName = nameOf(team.mvpId);
            return (
              <View
                key={team.id ?? index}
                style={[styles.teamCard, isMyTeam && styles.teamCardMe]}
              >
                <View style={styles.teamHead}>
                  <View style={[styles.rankBadge, podium ? { backgroundColor: podium } : null]}>
                    <Text style={[styles.rankText, podium ? styles.rankTextPodium : null]}>
                      {rank}
                    </Text>
                  </View>
                  <View style={styles.teamNameWrap}>
                    <Text style={styles.teamName} numberOfLines={1}>
                      {team.name || `Team ${team.id}`}
                      {isMyTeam ? '  (your team)' : ''}
                    </Text>
                    {team.correct != null || team.accuracy != null ? (
                      <Text style={styles.teamSub} numberOfLines={1}>
                        {[
                          team.correct != null ? `${team.correct} correct` : null,
                          team.accuracy != null ? `${team.accuracy}% accuracy` : null,
                          team.bestStreak ? `best run ${team.bestStreak}` : null,
                        ].filter(Boolean).join('   ')}
                      </Text>
                    ) : null}
                    {leaderName || mvpName ? (
                      <Text style={styles.teamRoles} numberOfLines={1}>
                        {[
                          leaderName ? `Led by ${leaderName}` : null,
                          mvpName ? `MVP ${mvpName}` : null,
                        ].filter(Boolean).join('   ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.teamScore}>{team.score ?? 0}</Text>
                </View>
                {(team.members ?? []).length === 0 ? (
                  <Text style={styles.emptyLine}>No members recorded.</Text>
                ) : (
                  (team.members ?? []).map((member, mi) => (
                    <MemberRow
                      key={`${team.id}-${member.user_id ?? mi}`}
                      member={member}
                      isMe={!!myUserId && String(member.user_id) === String(myUserId)}
                      tone={podium ?? undefined}
                    />
                  ))
                )}
              </View>
            );
          })}
        </>
      ) : null}

      {isClassic ? (
        <>
          <View style={styles.sectionHead}>
            <Ionicons name="trophy" size={14} color={COLORS.warning} />
            <Text style={styles.sectionTitle}>Final standings</Text>
            {results.questionCount ? (
              <Text style={styles.sectionMeta}>{results.questionCount} questions</Text>
            ) : null}
          </View>
          {(() => {
            // The viewer's own line, promoted above the table so a solo game
            // answers "how did I do" before it lists everybody else. Skipped
            // when the caller could not attribute a row to this user.
            const me = mine(results.participants);
            if (!me) return null;
            const answered = me.answered ?? 0;
            return (
              <View style={styles.statRow}>
                <StatChip icon="star" label="points" value={me.score ?? 0} tint={COLORS.warning} />
                <StatChip
                  icon="checkmark-circle"
                  label="correct"
                  value={`${me.correct ?? 0}/${answered}`}
                  tint={COLORS.success}
                />
                <StatChip
                  icon="analytics"
                  label="accuracy"
                  value={`${me.accuracy ?? (answered > 0 ? Math.round(((me.correct ?? 0) / answered) * 100) : 0)}%`}
                  tint={COLORS.purpleVibrant}
                />
                <StatChip
                  icon="flame"
                  label="best run"
                  value={me.bestStreak ?? 0}
                  tint={COLORS.warning}
                />
              </View>
            );
          })()}
          {ranked.map((member, index) => {
            const rank = member.rank ?? index + 1;
            const podium = rank <= 3 ? PODIUM[rank - 1] : null;
            return (
              <MemberRow
                key={member.user_id ?? index}
                member={member}
                isMe={!!myUserId && String(member.user_id) === String(myUserId)}
                tone={podium ?? undefined}
              />
            );
          })}
        </>
      ) : null}

      {isOffline ? (
        <>
          <View style={styles.sectionHead}>
            <Ionicons name="game-controller" size={14} color={COLORS.purpleVibrant} />
            <Text style={styles.sectionTitle}>Your result</Text>
            {results.quizType ? (
              <Text style={styles.sectionMeta}>{results.quizType}</Text>
            ) : null}
          </View>
          <View style={styles.statRow}>
            <StatChip
              icon="star"
              label="points"
              value={results.score ?? 0}
              tint={COLORS.warning}
            />
            <StatChip
              icon="checkmark-circle"
              label="correct"
              value={`${results.correct ?? 0}/${results.total ?? 0}`}
              tint={COLORS.success}
            />
            {results.timePerQuestion ? (
              <StatChip
                icon="timer"
                label="sec/q"
                value={results.timePerQuestion}
                tint={COLORS.purpleVibrant}
              />
            ) : null}
          </View>
        </>
      ) : null}

      {results.roomCode ? (
        <Text style={styles.footnote}>Room {results.roomCode}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, gap: 10 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: {
    fontFamily: 'Montserrat-Bold',
    fontSize: 12,
    color: COLORS.textPrimary,
    letterSpacing: 0.3,
    flex: 1,
  },
  sectionMeta: { fontFamily: 'Montserrat-Medium', fontSize: 10, color: COLORS.textMuted },

  teamCard: {
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
    padding: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  teamCardMe: { borderColor: COLORS.purpleVibrant, borderWidth: 2 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.purpleGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: 'Montserrat-ExtraBold',
    fontSize: 11,
    color: COLORS.textPrimary,
  },
  rankTextPodium: { color: '#FFFFFF' },
  teamNameWrap: { flex: 1, gap: 1 },
  teamName: {
    fontFamily: 'Montserrat-Bold',
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  teamSub: { fontFamily: 'Montserrat-Medium', fontSize: 10, color: COLORS.textMuted },
  teamRoles: { fontFamily: 'Montserrat-SemiBold', fontSize: 10, color: COLORS.purpleVibrant },
  teamScore: { fontFamily: 'Montserrat-ExtraBold', fontSize: 14, color: COLORS.purpleVibrant },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingLeft: 6,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    borderRadius: 6,
  },
  memberRowMe: { backgroundColor: COLORS.purpleGhost + '55' },
  memberMeta: { flex: 1, gap: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberName: { flexShrink: 1, fontFamily: 'Montserrat-SemiBold', fontSize: 12, color: COLORS.textPrimary },
  memberNameMe: { fontFamily: 'Montserrat-ExtraBold' },
  memberSub: { fontFamily: 'Montserrat-Regular', fontSize: 10, color: COLORS.textMuted },
  memberScore: { fontFamily: 'Montserrat-ExtraBold', fontSize: 12, color: COLORS.textPrimary },

  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: { backgroundColor: COLORS.bgSecondary },
  avatarFallback: { backgroundColor: COLORS.purpleGhost },
  avatarMe: { backgroundColor: COLORS.purpleVibrant },
  avatarText: { fontFamily: 'Montserrat-Bold', fontSize: 10, color: COLORS.textPrimary },
  avatarTextMe: { color: '#FFFFFF' },

  /** Icon-only so three of them still fit beside a name on a narrow row. */
  badge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: COLORS.warning + '1F',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  streakText: { fontFamily: 'Montserrat-ExtraBold', fontSize: 10, color: COLORS.warning },

  emptyLine: { fontFamily: 'Montserrat-Regular', fontSize: 11, color: COLORS.textMuted },

  statRow: { flexDirection: 'row', gap: 8 },
  statChip: {
    flex: 1,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statChipIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statChipValue: { fontFamily: 'Montserrat-ExtraBold', fontSize: 14, color: COLORS.textPrimary },
  statChipLabel: { fontFamily: 'Montserrat-Medium', fontSize: 9, color: COLORS.textMuted },

  footnote: {
    fontFamily: 'Montserrat-Medium',
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});