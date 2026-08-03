import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, STATUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, Pill, FilterChip, ProgressBar, EmptyState } from '@/components/educator/EducatorPrimitives';

type AStatus = 'assigned' | 'submitted' | 'pending' | 'overdue';

const ASSIGNMENTS: { id: string; title: string; quiz: string; due: string; submitted: number; total: number; status: AStatus }[] = [
  { id: 'a1', title: 'Fractions Practice Set', quiz: 'Fractions Quiz', due: 'Jul 16', submitted: 14, total: 24, status: 'assigned' },
  { id: 'a2', title: 'Weekly Reading — Ch. 4', quiz: '—', due: 'Jul 10', submitted: 24, total: 24, status: 'submitted' },
  { id: 'a3', title: 'Order of Operations Review', quiz: 'Order of Operations', due: 'Jul 8', submitted: 9, total: 24, status: 'overdue' },
];

function statusMeta(status: AStatus): { color: string; label: string } {
  switch (status) {
    case 'submitted': return { color: STATUS.submitted, label: 'Submitted' };
    case 'pending': return { color: STATUS.pending, label: 'Pending' };
    case 'overdue': return { color: STATUS.overdue, label: 'Overdue' };
    default: return { color: STATUS.assigned, label: 'Assigned' };
  }
}

export default function AssignmentsScreen() {
  const [filter, setFilter] = useState<'all' | AStatus>('all');
  const [creating, setCreating] = useState(false);

  const filtered = filter === 'all' ? ASSIGNMENTS : ASSIGNMENTS.filter((a) => a.status === filter);

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Assignments"
        subtitle={`${ASSIGNMENTS.length} assignments this term`}
        showBack
        rightIcon={creating ? 'close' : 'add'}
        onRightPress={() => setCreating(!creating)}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {creating && (
          <View style={styles.section}>
            <SectionHeader title="New Assignment" />
            <View style={styles.builderCard}>
              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput style={styles.input} placeholder="e.g. Fractions Practice Set" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.fieldLabel}>Due Date</Text>
              <TouchableOpacity style={styles.input}>
                <Text style={{ color: COLORS.textSecondary, fontFamily: FONTS.medium }}>Select a due date</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Attach Quiz</Text>
              <TouchableOpacity style={styles.attachRow}>
                <Ionicons name="document-text-outline" size={18} color={COLORS.purplePrimary} />
                <Text style={styles.attachText}>Choose a quiz to attach</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Attach Resources</Text>
              <TouchableOpacity style={styles.attachRow}>
                <Ionicons name="attach-outline" size={18} color={COLORS.purplePrimary} />
                <Text style={styles.attachText}>Add files or links</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.publishBtn} activeOpacity={0.85}>
                <Ionicons name="paper-plane" size={16} color="white" />
                <Text style={styles.publishText}>Assign to Class</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.filterRow}>
            <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
            <FilterChip label="Assigned" active={filter === 'assigned'} onPress={() => setFilter('assigned')} />
            <FilterChip label="Submitted" active={filter === 'submitted'} onPress={() => setFilter('submitted')} />
            <FilterChip label="Overdue" active={filter === 'overdue'} onPress={() => setFilter('overdue')} />
          </View>

          {filtered.length > 0 ? (
            <View style={{ gap: 12 }}>
              {filtered.map((a) => {
                const meta = statusMeta(a.status);
                const percent = (a.submitted / a.total) * 100;
                return (
                  <View key={a.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{a.title}</Text>
                        <Text style={styles.cardMeta}>Quiz: {a.quiz} · Due {a.due}</Text>
                      </View>
                      <Pill label={meta.label} color={meta.color} />
                    </View>
                    <ProgressBar percent={percent} height={6} />
                    <Text style={styles.submissionText}>{a.submitted}/{a.total} submitted</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <EmptyState icon="document-text-outline" title="No assignments here" text="Try a different filter or create a new assignment." />
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

  builderCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  fieldLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { backgroundColor: 'white', borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'white', borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border },
  attachText: { flex: 1, fontSize: 13.5, fontFamily: FONTS.medium, color: COLORS.textSecondary },
  publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 14, marginTop: 20 },
  publishText: { color: 'white', fontSize: 14.5, fontFamily: FONTS.bold, fontWeight: '700' },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },

  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  cardMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  submissionText: { fontSize: 11.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted, marginTop: 8 },
});
