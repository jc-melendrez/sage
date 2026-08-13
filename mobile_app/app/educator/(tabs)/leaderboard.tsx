import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, FilterChip, Avatar } from '@/components/educator/EducatorPrimitives';

const LEADERBOARD = [
  { rank: 1, name: 'Priya Nair', xp: 960 },
  { rank: 2, name: 'Amara Chen', xp: 840 },
  { rank: 3, name: 'Sofia Reyes', xp: 705 },
  { rank: 4, name: 'Owen Blake', xp: 310 },
  { rank: 5, name: 'Diego Ramos', xp: 220 },
];

const PERIODS = ['Weekly', 'Monthly'];

function rankColor(rank: number) {
  if (rank === 1) return COLORS.warning;
  if (rank === 2) return COLORS.textMuted;
  if (rank === 3) return '#B08D57';
  return COLORS.purpleLight;
}

export default function LeaderboardScreen() {
  const [enabled, setEnabled] = useState(true);
  const [period, setPeriod] = useState('Weekly');

  return (
    <View style={styles.container}>
      <EducatorHeader title="Leaderboard" subtitle="Manage class rankings" showBack />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Enable/disable */}
        <View style={styles.section}>
          <View style={styles.toggleCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Class Leaderboard</Text>
              <Text style={styles.toggleSub}>{enabled ? 'Visible to students' : 'Hidden from students'}</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: COLORS.border, true: COLORS.purpleLight }}
              thumbColor={enabled ? COLORS.purplePrimary : '#f4f3f4'}
            />
          </View>
        </View>

        {/* Ranking period */}
        <View style={styles.section}>
          <SectionHeader title="Ranking Period" />
          <View style={styles.chipRow}>
            {PERIODS.map((p) => (
              <FilterChip key={p} label={p} active={period === p} onPress={() => setPeriod(p)} />
            ))}
          </View>
        </View>

        {/* Reset actions */}
        <View style={styles.section}>
          <SectionHeader title="Reset Rankings" />
          <View style={styles.resetRow}>
            <TouchableOpacity style={styles.resetBtn} activeOpacity={0.85}>
              <Ionicons name="refresh" size={16} color={COLORS.purplePrimary} />
              <Text style={styles.resetText}>Reset Weekly</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} activeOpacity={0.85}>
              <Ionicons name="refresh" size={16} color={COLORS.purplePrimary} />
              <Text style={styles.resetText}>Reset Monthly</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Live preview */}
        <View style={styles.section}>
          <SectionHeader title="Live Preview" />
          <View style={styles.previewCard}>
            {!enabled && (
              <View style={styles.disabledOverlayNote}>
                <Ionicons name="eye-off-outline" size={14} color={COLORS.textMuted} />
                <Text style={styles.disabledOverlayText}>Leaderboard is currently hidden from students</Text>
              </View>
            )}
            {LEADERBOARD.map((entry, idx) => (
              <View key={entry.rank} style={[styles.rankRow, idx > 0 && styles.borderTop]}>
                <View style={[styles.rankBadge, { backgroundColor: tint(rankColor(entry.rank)) }]}>
                  <Text style={[styles.rankNumber, { color: rankColor(entry.rank) }]}>{entry.rank}</Text>
                </View>
                <Avatar initials={entry.name.split(' ').map((n) => n[0]).join('')} size={36} />
                <Text style={styles.rankName}>{entry.name}</Text>
                <Text style={styles.rankXp}>{entry.xp} XP</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },

  toggleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  toggleTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  toggleSub: { fontSize: 12.5, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  resetRow: { flexDirection: 'row', gap: 12 },
  resetBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border },
  resetText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  previewCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  disabledOverlayNote: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  disabledOverlayText: { fontSize: 11.5, fontFamily: FONTS.medium, color: COLORS.textMuted },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rankBadge: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  rankNumber: { fontSize: 12, fontFamily: FONTS.black, fontWeight: '900' },
  rankName: { flex: 1, fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  rankXp: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleDark },
});
