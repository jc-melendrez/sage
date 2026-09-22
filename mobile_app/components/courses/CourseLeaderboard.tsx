import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { pfpSource } from '@/constants/pfps';
import type { CourseLeaderboard, LeaderboardSort } from '@/services/courseService';

const RANK_META: Record<number, { icon: string; color: string; label: string }> = {
  1: { icon: 'trophy', color: '#F59E0B', label: '1st' },
  2: { icon: 'medal', color: '#94A3B8', label: '2nd' },
  3: { icon: 'medal', color: '#D97706', label: '3rd' },
};

const SORT_OPTIONS: { key: LeaderboardSort; label: string; icon: string }[] = [
  { key: 'points', label: 'Points', icon: 'star' },
  { key: 'nodes', label: 'Completed', icon: 'checkmark-circle' },
  { key: 'streak', label: 'Streak', icon: 'flame' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function Avatar({ name, avatarKey, size }: { name: string; avatarKey?: string; size: number }) {
  const source = pfpSource(avatarKey);
  if (source) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: tint(COLORS.purpleVibrant) }}>
        <Image source={source} style={{ width: size, height: size }} />
      </View>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint(COLORS.purpleVibrant),
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text style={{ color: COLORS.purpleDeep, fontFamily: FONTS.bold, fontSize: size * 0.34 }}>{initialsOf(name)}</Text>
    </View>
  );
}

function PodiumCard({ entry }: { entry: CourseLeaderboard['entries'][number] }) {
  const meta = RANK_META[entry.rank] || RANK_META[3];
  const isFirst = entry.rank === 1;
  return (
    <View style={[styles.podiumCard, isFirst && styles.podiumCardFirst, entry.is_you && styles.youRing]}>
      <View style={[styles.rankBadge, { backgroundColor: tint(meta.color) }]}>
        <Ionicons name={meta.icon as any} size={isFirst ? 20 : 16} color={meta.color} />
      </View>
      <Avatar name={entry.display_name} avatarKey={entry.avatar} size={isFirst ? 56 : 46} />
      <Text style={styles.podiumName} numberOfLines={1}>{entry.display_name}</Text>
      <Text style={[styles.podiumPoints, isFirst && styles.podiumPointsFirst]}>{entry.points} pts</Text>
      <View style={styles.podiumStats}>
        <View style={styles.podiumStat}>
          <Ionicons name="layers" size={11} color={COLORS.textMuted} />
          <Text style={styles.podiumStatText}>{entry.nodes_completed}</Text>
        </View>
        <View style={styles.podiumStat}>
          <Ionicons name="flame" size={11} color={COLORS.warning} />
          <Text style={styles.podiumStatText}>{entry.streak}</Text>
        </View>
      </View>
      {entry.is_you && (
        <View style={styles.youPill}>
          <Text style={styles.youPillText}>YOU</Text>
        </View>
      )}
    </View>
  );
}

interface Props {
  data: CourseLeaderboard | null;
  loading: boolean;
  activeSort: LeaderboardSort;
  onSortChange: (sort: LeaderboardSort) => void;
}

export default function CourseLeaderboardView({ data, loading, activeSort, onSortChange }: Props) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }

  if (!data) return null;

  if (data.total_students === 0) {
    return (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconBox}>
          <Ionicons name="podium-outline" size={32} color={COLORS.purpleLight} />
        </View>
        <Text style={styles.emptyTitle}>No competition yet</Text>
        <Text style={styles.emptyText}>Students join this class with the join code, then earn points here.</Text>
      </View>
    );
  }

  const podium = data.entries.slice(0, 3);
  const rest = data.entries.slice(3);

  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);

  return (
    <View>
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => {
          const active = activeSort === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortChip, active && styles.sortChipActive]}
              activeOpacity={0.8}
              onPress={() => onSortChange(opt.key)}
            >
              <Ionicons name={opt.icon as any} size={13} color={active ? 'white' : COLORS.purpleDeep} />
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.podiumRow}>
        {podiumOrder.map((entry) => (
          <PodiumCard key={entry.id} entry={entry} />
        ))}
      </View>

      <View style={styles.listCard}>
        {rest.map((entry, idx) => {
          const meta = RANK_META[entry.rank] || RANK_META[3];
          return (
            <View
              key={entry.id}
              style={[styles.row, idx > 0 && styles.rowBorder, entry.is_you && styles.rowYou]}
            >
              <View style={styles.rankWrap}>
                <Text style={styles.rankNumber}>{entry.rank}</Text>
              </View>
              <Avatar name={entry.display_name} avatarKey={entry.avatar} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{entry.display_name}</Text>
                <View style={styles.rowStats}>
                  <View style={styles.rowStat}>
                    <Ionicons name="layers" size={11} color={COLORS.textMuted} />
                    <Text style={styles.rowStatText}>{entry.nodes_completed} done</Text>
                  </View>
                  <View style={styles.rowStat}>
                    <Ionicons name="flame" size={11} color={COLORS.warning} />
                    <Text style={styles.rowStatText}>{entry.streak} streak</Text>
                  </View>
                </View>
              </View>
              <View style={styles.rowRight}>
                <Ionicons name={meta.icon as any} size={15} color={meta.color} style={styles.rowRankIcon} />
                <Text style={[styles.rowPoints, entry.is_you && styles.rowPointsYou]}>{entry.points}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.hint}>
        Pass {activeSort === 'nodes' ? 'nodes' : activeSort === 'streak' ? 'daily streaks' : 'lessons and quizzes'} to climb the ranks in this class.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { paddingVertical: 60, alignItems: 'center' },

  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sortChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  sortChipText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleDeep },
  sortChipTextActive: { color: 'white' },

  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10, marginBottom: 18 },
  podiumCard: {
    flex: 1,
    maxWidth: 110,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  podiumCardFirst: { backgroundColor: tint(COLORS.warning, 0.12), borderColor: COLORS.warning, paddingVertical: 20 },
  youRing: { borderWidth: 2, borderColor: COLORS.purpleVibrant },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  podiumName: { fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginTop: 6 },
  podiumPoints: { fontSize: 14, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textSecondary, marginTop: 2 },
  podiumPointsFirst: { fontSize: 17, color: COLORS.warning },
  podiumStats: { flexDirection: 'row', gap: 10, marginTop: 6 },
  podiumStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  podiumStatText: { fontSize: 10, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted },
  youPill: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: COLORS.purpleVibrant,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  youPillText: { color: 'white', fontSize: 9, fontFamily: FONTS.black, fontWeight: '900' },

  listCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  rowYou: { backgroundColor: tint(COLORS.purpleVibrant, 0.12), marginHorizontal: -14, paddingHorizontal: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.border },
  rankWrap: { width: 22, alignItems: 'center' },
  rankNumber: { fontSize: 14, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textMuted },
  rowName: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  rowStats: { flexDirection: 'row', gap: 12, marginTop: 3 },
  rowStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowStatText: { fontSize: 10, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowRankIcon: { marginBottom: 1 },
  rowPoints: { fontSize: 15, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textPrimary },
  rowPointsYou: { color: COLORS.purpleDeep },

  hint: { fontSize: 11, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted, textAlign: 'center', marginTop: 16 },

  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl - 12,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptyIconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: { color: COLORS.purpleDark, fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', marginBottom: 6 },
  emptyText: { color: COLORS.purpleLight, fontSize: 13, fontFamily: FONTS.regular, textAlign: 'center', lineHeight: 19 },
});