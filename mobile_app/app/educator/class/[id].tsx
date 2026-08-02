import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import {
  getClassroom,
  addWeek,
  deleteWeek,
  addLesson,
  deleteLesson,
  deleteClassroom,
  generateMockQuiz,
  getExistingQuizzes,
  getWeekUnlockLabel,
  WeekUnlockMode,
  MockQuizQuestion,
} from '@/mock/classroomStore';

export default function EducatorClassDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const classroom = getClassroom(String(id));

  const [addingWeek, setAddingWeek] = useState(false);
  const [weekTitle, setWeekTitle] = useState('');
  const [weekMode, setWeekMode] = useState<WeekUnlockMode>('completion');
  const [weekDate, setWeekDate] = useState('');
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);

  const [addingLessonFor, setAddingLessonFor] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [source, setSource] = useState<'ai' | 'attach'>('ai');
  const [aiTopic, setAiTopic] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [passingScore, setPassingScore] = useState('70');
  const [xpReward, setXpReward] = useState('25');

  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);

  if (!classroom) {
    return (
      <View style={styles.container}>
        <EducatorHeader title="Class not found" showBack />
      </View>
    );
  }

  const existingQuizzes = getExistingQuizzes();

  const handleAddWeek = () => {
    const week = addWeek(classroom.id, {
      title: weekTitle,
      unlockMode: weekMode,
      unlockDate: weekDate && (weekMode === 'date' || weekMode === 'both') ? weekDate : undefined,
    });
    setAddingWeek(false);
    setWeekTitle('');
    setWeekDate('');
    setWeekMode('completion');
    if (week) setExpandedWeek(week.id);
    refresh();
  };

  const handleAddLesson = () => {
    if (!addingLessonFor || !lessonTitle.trim()) return;
    let quiz: MockQuizQuestion[] = [];
    if (source === 'ai') {
      quiz = generateMockQuiz(aiTopic || lessonTitle, difficulty);
    } else {
      const selected = existingQuizzes.find((q) => q.id === selectedQuizId);
      if (!selected) {
        Alert.alert('Pick a quiz', 'Choose a quiz to attach, or switch to AI generation.');
        return;
      }
      quiz = selected.questions;
    }
    addLesson(classroom.id, addingLessonFor, {
      title: lessonTitle,
      quiz,
      passingScore: Math.max(0, Math.min(100, Number(passingScore) || 70)),
      xpReward: Math.max(0, Number(xpReward) || 25),
    });
    setAddingLessonFor(null);
    setLessonTitle('');
    setAiTopic('');
    setSelectedQuizId(null);
    setPassingScore('70');
    setXpReward('25');
    refresh();
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={classroom.name}
        subtitle={`${classroom.subject} · ${classroom.weeks.length} weeks`}
        showBack
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {classroom.weeks.length === 0 && !addingWeek && (
          <View style={styles.section}>
            <EmptyState icon="calendar-outline" title="No weeks yet" text="Add your first week of lessons to get started." />
          </View>
        )}

        {/* Add Week builder */}
        {addingWeek && (
          <View style={styles.section}>
            <SectionHeader title="New Week" />
            <View style={styles.builderCard}>
              <Text style={styles.fieldLabel}>Week Title</Text>
              <TextInput
                style={styles.input}
                value={weekTitle}
                onChangeText={setWeekTitle}
                placeholder="e.g. Week 1"
                placeholderTextColor={COLORS.textMuted}
              />

              <Text style={styles.fieldLabel}>Unlock Rule</Text>
              <View style={styles.chipRow}>
                <FilterChip label="Date" active={weekMode === 'date'} onPress={() => setWeekMode('date')} />
                <FilterChip label="After previous" active={weekMode === 'completion'} onPress={() => setWeekMode('completion')} />
                <FilterChip label="Both" active={weekMode === 'both'} onPress={() => setWeekMode('both')} />
              </View>

              {(weekMode === 'date' || weekMode === 'both') && (
                <>
                  <Text style={styles.fieldLabel}>Unlock Date (YYYY-MM-DD)</Text>
                  <TextInput
                    style={styles.input}
                    value={weekDate}
                    onChangeText={setWeekDate}
                    placeholder="e.g. 2026-08-10"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                  />
                </>
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.outlineBtn} onPress={() => { setAddingWeek(false); setWeekTitle(''); setWeekDate(''); setWeekMode('completion'); }}>
                  <Text style={styles.outlineBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleAddWeek}>
                  <Ionicons name="add" size={16} color="white" />
                  <Text style={styles.primaryBtnText}>Add Week</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Week list */}
        {classroom.weeks.map((week, wIdx) => {
          const expanded = expandedWeek === week.id;
          return (
            <View key={week.id} style={styles.section}>
              <View style={styles.weekCard}>
                <TouchableOpacity style={styles.weekHeader} activeOpacity={0.8} onPress={() => setExpandedWeek(expanded ? null : week.id)}>
                  <View style={styles.weekNumberBadge}>
                    <Text style={styles.weekNumberText}>{wIdx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.weekTitle}>{week.title}</Text>
                    <Text style={styles.weekMeta}>
                      {week.lessons.length} lessons · {getWeekUnlockLabel(week, wIdx)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => {
                      Alert.alert('Delete week?', `"${week.title}" and its lessons will be removed.`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => { deleteWeek(classroom.id, week.id); refresh(); } },
                      ]);
                    }}
                  >
                    <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                  </TouchableOpacity>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                </TouchableOpacity>

                {expanded && (
                  <View style={styles.weekBody}>
                    {week.lessons.map((lesson) => (
                      <View key={lesson.id} style={styles.lessonRow}>
                        <View style={[styles.lessonIcon, { backgroundColor: tint(COLORS.purplePrimary) }]}>
                          <Ionicons name="help-circle" size={16} color={COLORS.purplePrimary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.lessonTitle}>{lesson.title}</Text>
                          <Text style={styles.lessonMeta}>
                            {lesson.quiz.length} Qs · Pass {lesson.passingScore}% · {lesson.xpReward} XP
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => {
                            Alert.alert('Delete lesson?', `"${lesson.title}" will be removed.`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => { deleteLesson(classroom.id, week.id, lesson.id); refresh(); } },
                            ]);
                          }}
                        >
                          <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    {week.lessons.length === 0 && (
                      <Text style={styles.noLessonsText}>No lessons yet — add one below.</Text>
                    )}

                    {addingLessonFor === week.id ? (
                      <View style={styles.lessonBuilder}>
                        <Text style={styles.fieldLabel}>Lesson Title</Text>
                        <TextInput
                          style={styles.input}
                          value={lessonTitle}
                          onChangeText={setLessonTitle}
                          placeholder="e.g. Adding Fractions"
                          placeholderTextColor={COLORS.textMuted}
                        />

                        <Text style={styles.fieldLabel}>Content Source</Text>
                        <View style={styles.chipRow}>
                          <FilterChip label="Generate with AI" active={source === 'ai'} onPress={() => setSource('ai')} />
                          <FilterChip label="Attach existing quiz" active={source === 'attach'} onPress={() => setSource('attach')} />
                        </View>

                        {source === 'ai' ? (
                          <>
                            <Text style={styles.fieldLabel}>Topic</Text>
                            <TextInput
                              style={styles.input}
                              value={aiTopic}
                              onChangeText={setAiTopic}
                              placeholder="e.g. Fractions"
                              placeholderTextColor={COLORS.textMuted}
                            />
                            <Text style={styles.fieldLabel}>Difficulty</Text>
                            <View style={styles.chipRow}>
                              {['Easy', 'Medium', 'Hard'].map((d) => (
                                <FilterChip key={d} label={d} active={difficulty === d} onPress={() => setDifficulty(d)} />
                              ))}
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={styles.fieldLabel}>Quiz</Text>
                            <View style={{ gap: 8 }}>
                              {existingQuizzes.map((q) => {
                                const active = selectedQuizId === q.id;
                                return (
                                  <TouchableOpacity
                                    key={q.id}
                                    style={[styles.attachRow, active && styles.attachRowActive]}
                                    onPress={() => setSelectedQuizId(q.id)}
                                  >
                                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? COLORS.purplePrimary : COLORS.textMuted} />
                                    <Text style={styles.attachText}>{q.title}</Text>
                                    <Text style={styles.attachCount}>{q.questions.length} Qs</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </>
                        )}

                        <View style={styles.rowFields}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabel}>Pass %</Text>
                            <TextInput style={styles.input} value={passingScore} onChangeText={setPassingScore} keyboardType="number-pad" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabel}>XP</Text>
                            <TextInput style={styles.input} value={xpReward} onChangeText={setXpReward} keyboardType="number-pad" />
                          </View>
                        </View>

                        <View style={styles.actionsRow}>
                          <TouchableOpacity style={styles.outlineBtn} onPress={() => { setAddingLessonFor(null); setLessonTitle(''); setAiTopic(''); setSelectedQuizId(null); }}>
                            <Text style={styles.outlineBtnText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.primaryBtn} onPress={handleAddLesson}>
                            <Ionicons name="add" size={16} color="white" />
                            <Text style={styles.primaryBtnText}>Add Lesson</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.addLessonBtn} onPress={() => setAddingLessonFor(week.id)}>
                        <Ionicons name="add-circle-outline" size={16} color={COLORS.purplePrimary} />
                        <Text style={styles.addLessonText}>Add Lesson</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* Footer controls */}
        <View style={[styles.section, styles.footerControls]}>
          {!addingWeek && (
            <TouchableOpacity style={[styles.primaryBtn, styles.fullBtn]} onPress={() => setAddingWeek(true)}>
              <Ionicons name="calendar" size={16} color="white" />
              <Text style={styles.primaryBtnText}>Add Week</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.outlineBtn, styles.fullBtn]}
            onPress={() => {
              Alert.alert('Delete class?', `"${classroom.name}" and all its weeks will be removed.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { deleteClassroom(classroom.id); router.back(); } },
              ]);
            }}
          >
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
            <Text style={[styles.outlineBtnText, { color: COLORS.danger }]}>Delete Class</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 20 },

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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowFields: { flexDirection: 'row', gap: 12 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  outlineBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.border },
  outlineBtnText: { fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 13 },
  primaryBtnText: { color: 'white', fontSize: 13.5, fontFamily: FONTS.bold, fontWeight: '700' },
  fullBtn: { flex: 1 },

  weekCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  weekHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  weekNumberBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.purplePrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNumberText: { color: 'white', fontFamily: FONTS.black, fontSize: 15 },
  weekTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  weekMeta: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  weekBody: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: COLORS.border },

  lessonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  lessonIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  lessonTitle: { fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  lessonMeta: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted },
  deleteBtn: { padding: 6 },
  noLessonsText: { fontSize: 12.5, fontFamily: FONTS.medium, color: COLORS.textMuted, paddingVertical: 12 },

  lessonBuilder: { marginTop: 14, paddingTop: 4 },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  attachRowActive: { borderColor: COLORS.purplePrimary, borderWidth: 2 },
  attachText: { flex: 1, fontSize: 13.5, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  attachCount: { fontSize: 11.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted },

  addLessonBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 14 },
  addLessonText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
  footerControls: { flexDirection: 'row', gap: 10 },
});
