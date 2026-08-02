import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { Avatar, Pill, SectionHeader } from '@/components/educator/EducatorPrimitives';

// --- Mock data (wire up to your API layer) ---
const CLASSES = [
  { id: 'c1', name: 'Algebra I', period: 'Period 3', students: 24, color: COLORS.purpleVibrant },
  { id: 'c2', name: 'Algebra I', period: 'Period 5', students: 27, color: COLORS.accent },
  { id: 'c3', name: 'Geometry', period: 'Period 2', students: 21, color: COLORS.success },
  { id: 'c4', name: 'Algebra Study Group', period: 'Lunch', students: 9, color: COLORS.warning },
];

export default function ClassesScreen() {
  return (
    <View style={styles.container}>
      <EducatorHeader title="My Classes" subtitle="4 classes this term" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <SectionHeader title="This Term" />
          <View style={{ gap: 12 }}>
            {CLASSES.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.classCard}
                activeOpacity={0.8}
                onPress={() => Alert.alert(c.name, `${c.period} · ${c.students} students`)}
              >
                <Avatar initials={c.name.slice(0, 2).toUpperCase()} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.className}>{c.name}</Text>
                  <Text style={styles.classMeta}>{c.period}</Text>
                </View>
                <Pill label={`${c.students} students`} color={c.color} icon="people" />
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Class Averages" />
          <View style={styles.listCard}>
            {CLASSES.map((c, idx) => (
              <View key={c.id} style={[styles.avgRow, idx > 0 && styles.borderTop]}>
                <View style={[styles.avgDot, { backgroundColor: c.color }]} />
                <Text style={styles.avgLabel} numberOfLines={1}>{c.period}</Text>
                <Text style={styles.avgScore}>{(82 + idx * 3).toFixed(0)}%</Text>
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

  classCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  className: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  classMeta: { fontSize: 12.5, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },

  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  avgDot: { width: 9, height: 9, borderRadius: 4.5 },
  avgLabel: { flex: 1, fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  avgScore: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
});
