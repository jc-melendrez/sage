import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { SectionHeader, Avatar } from './EducatorPrimitives';
import type { StudentSummary } from './StudentRow';

interface AtRiskSectionProps {
  students: StudentSummary[];
}

function reasonFor(s: StudentSummary): { label: string; color: string } {
  if (s.status === 'atRisk') {
    return { label: `Away ${s.lastActive}`, color: COLORS.danger };
  }
  return { label: s.streak <= 1 ? 'Low streak' : 'Needs a nudge', color: COLORS.warning };
}

function initialsFor(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function AtRiskSection({ students }: AtRiskSectionProps) {
  const router = useRouter();

  if (students.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Needs Attention" actionLabel="View all" onAction={() => router.push('/educator/student-progress' as any)} />
      <View style={styles.card}>
        {students.slice(0, 3).map((s) => {
          const reason = reasonFor(s);
          return (
            <TouchableOpacity
              key={s.id}
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/educator/student-detail', params: { id: s.id } })}
            >
              <Avatar initials={initialsFor(s.name)} size={40} />
              <View style={styles.middle}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <View style={[styles.reasonTag, { backgroundColor: tint(reason.color) }]}>
                  <Text style={[styles.reasonText, { color: reason.color }]}>{reason.label}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 28 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { fontSize: 14.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, flexShrink: 1 },
  reasonTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  reasonText: { fontSize: 11, fontFamily: FONTS.bold, fontWeight: '700' },
});