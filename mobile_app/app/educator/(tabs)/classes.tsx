import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { Avatar, Pill, SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { getClassrooms, createClassroom, MockClassroom } from '@/mock/classroomStore';

const CLASS_COLORS = ['#7C3AED', '#22D3EE', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export default function ClassesScreen() {
  const router = useRouter();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [color, setColor] = useState(CLASS_COLORS[0]);

  const classes = getClassrooms();

  const handleCreate = () => {
    if (!name.trim()) return;
    createClassroom({ name, subject, color });
    setCreating(false);
    setName('');
    setSubject('');
    setColor(CLASS_COLORS[0]);
    refresh();
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="My Classes"
        subtitle={`${classes.length} classes this term`}
        rightIcon={creating ? 'close' : 'add'}
        onRightPress={() => setCreating(!creating)}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {creating && (
          <View style={styles.section}>
            <SectionHeader title="New Class" />
            <View style={styles.builderCard}>
              <Text style={styles.fieldLabel}>Class Name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Period 3 · Algebra I" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.fieldLabel}>Subject</Text>
              <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="e.g. Algebra" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.fieldLabel}>Color</Text>
              <View style={styles.colorRow}>
                {CLASS_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
                    onPress={() => setColor(c)}
                  >
                    {color === c && <Ionicons name="checkmark" size={16} color="white" />}
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.publishBtn} activeOpacity={0.85} onPress={handleCreate}>
                <Ionicons name="add" size={16} color="white" />
                <Text style={styles.publishText}>Create Class</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {classes.length === 0 ? (
          <EmptyState icon="school-outline" title="No classes yet" text="Tap + to create your first class." />
        ) : (
          <View style={styles.section}>
            <SectionHeader title="This Term" />
            <View style={{ gap: 12 }}>
              {classes.map((c: MockClassroom) => {
                const totalLessons = c.weeks.reduce((sum, w) => sum + w.lessons.length, 0);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.classCard}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/educator/class/${c.id}` as any)}
                  >
                    <Avatar initials={c.name.slice(0, 2).toUpperCase()} size={48} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.className}>{c.name}</Text>
                      <Text style={styles.classMeta}>{c.subject}</Text>
                    </View>
                    <Pill label={`${totalLessons} lessons`} color={c.color} icon="layers" />
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {classes.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Class Averages" />
            <View style={styles.listCard}>
              {classes.map((c, idx) => (
                <View key={c.id} style={[styles.avgRow, idx > 0 && styles.borderTop]}>
                  <View style={[styles.avgDot, { backgroundColor: c.color }]} />
                  <Text style={styles.avgLabel} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.avgScore}>{(82 + idx * 3).toFixed(0)}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}
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
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  colorRow: { flexDirection: 'row', gap: 12 },
  colorSwatch: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  colorSwatchActive: { borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  publishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: RADIUS.sm,
    paddingVertical: 14,
    marginTop: 20,
  },
  publishText: { color: 'white', fontSize: 14.5, fontFamily: FONTS.bold, fontWeight: '700' },

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
