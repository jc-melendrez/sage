import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { StatCard, SectionHeader, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import { StudentRow, StudentSummary } from '@/components/educator/StudentRow';
import { ROSTER, CLASS_LABEL } from '@/constants/educatorMockData';

type StatusFilter = 'all' | StudentSummary['status'];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'onTrack', label: 'On track' },
  { key: 'needsAttention', label: 'Watch' },
  { key: 'atRisk', label: 'At risk' },
];

export default function StudentProgressScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const activeToday = ROSTER.filter((s) => s.lastActive === 'today').length;
  const atRiskCount = ROSTER.filter((s) => s.status === 'atRisk' || s.status === 'needsAttention').length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ROSTER.filter((s) => {
      const matchesStatus = filter === 'all' || s.status === filter;
      const matchesQuery = !q || s.name.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [query, filter]);

  return (
    <View style={styles.container}>
      <EducatorHeader title="Students" subtitle={`${CLASS_LABEL} · ${ROSTER.length} students`} />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Class overview stats */}
        <View style={styles.section}>
          <View style={styles.statsRow}>
            <StatCard icon="people" value={ROSTER.length} label="Students" color={COLORS.purpleVibrant} />
            <StatCard icon="pulse" value={activeToday} label="Active Today" color={COLORS.success} />
            <StatCard icon="warning" value={atRiskCount} label="At Risk" color={COLORS.danger} />
          </View>
        </View>

        {/* Search + filter */}
        <View style={styles.section}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search students"
              placeholderTextColor={COLORS.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.filterRow}>
            {STATUS_FILTERS.map((f) => (
              <FilterChip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>
        </View>

        {/* Roster */}
        <View style={styles.section}>
          <SectionHeader title="All Students" />
          {filtered.length > 0 ? (
            <View style={styles.listCard}>
              {filtered.map((s) => (
                <StudentRow
                  key={s.id}
                  student={s}
                  onPress={() => router.push({ pathname: '/educator/student-detail', params: { id: s.id } })}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="people-outline"
              title="No students found"
              text="No students match your search or filter. Try clearing the search."
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  statsRow: { flexDirection: 'row', gap: 10 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap' },

  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});
