import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface ActivityResultMember {
  user_id?: number | string;
  name?: string;
  score?: number;
  correct?: number;
  answered?: number;
  /** Only present on classic-mode participants; team mode ranks whole teams. */
  rank?: number | null;
}

export interface ActivityResultTeam {
  id?: string;
  name?: string;
  score?: number;
  correct?: number;
  rank?: number | null;
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
  return (
    <View style={[styles.memberRow, isMe && styles.memberRowMe, tone ? { borderLeftColor: tone } : null]}>
      <View style={[styles.avatar, isMe && styles.avatarMe]}>
        <Text style={styles.avatarText}>{initials(member.name)}</Text>
      </View>
      <View style={styles.memberMeta}>
        <Text style={[styles.memberName, isMe && styles.memberNameMe]} numberOfLines={1}>
          {member.name || 'Player'}
          {isMe ? '  (you)' : ''}
        </Text>
        {answered > 0 ? (
          <Text style={styles.memberSub}>{correct}/{answered} correct</Text>
        ) : null}
      </View>
      <Text style={styles.memberScore}>{member.score ?? 0}</Text>
    </View>
  );
}

/**
 * Renders the settled snapshot attached to a Recent Activity row.
 *
 * The list row only ever has room for a title and a one-line description, so
 * this is where the parts that were actually interesting live: who else
 * played, what they scored, and -- for a team game -- how each team placed and
 * who was on it. Rows written before snapshots existed render nothing rather
 * than an empty shell, and the caller falls back to the description.
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
                  <Text style={styles.teamName} numberOfLines={1}>
                    {team.name || `Team ${team.id}`}
                    {isMyTeam ? '  (your team)' : ''}
                  </Text>
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
          {[...results.participants!]
            .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
            .map((member, index) => {
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
  teamName: {
    fontFamily: 'Montserrat-Bold',
    fontSize: 13,
    color: COLORS.textPrimary,
    flex: 1,
  },
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
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.purpleGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarMe: { backgroundColor: COLORS.purpleVibrant },
  avatarText: { fontFamily: 'Montserrat-Bold', fontSize: 10, color: COLORS.textPrimary },
  memberMeta: { flex: 1 },
  memberName: { fontFamily: 'Montserrat-SemiBold', fontSize: 12, color: COLORS.textPrimary },
  memberNameMe: { fontFamily: 'Montserrat-ExtraBold' },
  memberSub: { fontFamily: 'Montserrat-Regular', fontSize: 10, color: COLORS.textMuted },
  memberScore: { fontFamily: 'Montserrat-ExtraBold', fontSize: 12, color: COLORS.textPrimary },

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
