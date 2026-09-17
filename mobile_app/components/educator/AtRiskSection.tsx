import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS } from '@/constants/educatorTheme';
import { SectionHeader } from './EducatorPrimitives';
import { StudentRow, StudentSummary } from './StudentRow';

interface AtRiskSectionProps {
  students: StudentSummary[];
}

export function AtRiskSection({ students }: AtRiskSectionProps) {
  const router = useRouter();

  if (students.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Needs Attention" actionLabel="View all" onAction={() => {}} />
      <View style={styles.card}>
        {students.map((s) => (
          <StudentRow
            key={s.id}
            student={s}
            onPress={() => router.push({ pathname: '/educator/student-detail', params: { id: s.id } })}
          />
        ))}
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
});
