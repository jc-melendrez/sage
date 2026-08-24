import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, STATUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, Pill, FilterChip, ProgressBar, EmptyState } from '@/components/educator/EducatorPrimitives';

type Tab = 'quizzes' | 'assignments';
type QuizStatus = 'draft' | 'assigned' | 'closed';
type AStatus = 'assigned' | 'submitted' | 'pending' | 'overdue';

const QUIZZES: { id: string; title: string; questions: number; status: QuizStatus; difficulty: string; assignedTo: string }[] = [
  { id: 'z1', title: 'Fractions Quiz', questions: 10, status: 'assigned', difficulty: 'Medium', assignedTo: 'Period 3' },
  { id: 'z2', title: 'Order of Operations', questions: 8, status: 'closed', difficulty: 'Easy', assignedTo: 'Period 3' },
  { id: 'z3', title: 'Intro to Geometry', questions: 12, status: 'draft', difficulty: 'Hard', assignedTo: '—' },
];

const ASSIGNMENTS: { id: string; title: string; quiz: string; due: string; submitted: number; total: number; status: AStatus }[] = [
  { id: 'a1', title: 'Fractions Practice Set', quiz: 'Fractions Quiz', due: 'Jul 16', submitted: 14, total: 24, status: 'assigned' },
  { id: 'a2', title: 'Weekly Reading — Ch. 4', quiz: '—', due: 'Jul 10', submitted: 24, total: 24, status: 'submitted' },
  { id: 'a3', title: 'Order of Operations Review', quiz: 'Order of Operations', due: 'Jul 8', submitted: 9, total: 24, status: 'overdue' },
];

const QUESTION_TYPES: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'mc', label: 'Multiple Choice', icon: 'list' },
  { id: 'tf', label: 'True / False', icon: 'checkbox' },
  { id: 'sa', label: 'Short Answer', icon: 'create' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ASSIGN_TARGETS = ['Period 3', 'Period 5', 'Algebra Study Group'];

function quizStatusColor(status: QuizStatus) {
  if (status === 'assigned') return COLORS.success;
  if (status === 'draft') return COLORS.textMuted;
  return COLORS.purpleVibrant;
}

function statusMeta(status: AStatus): { color: string; label: string } {
  switch (status) {
    case 'submitted': return { color: STATUS.submitted, label: 'Submitted' };
    case 'pending': return { color: STATUS.pending, label: 'Pending' };
    case 'overdue': return { color: STATUS.overdue, label: 'Overdue' };
    default: return { color: STATUS.assigned, label: 'Assigned' };
  }
}

export default function ContentScreen() {
  const [tab, setTab] = useState<Tab>('quizzes');
  const [quizFilter, setQuizFilter] = useState<'all' | QuizStatus>('all');
  const [assignFilter, setAssignFilter] = useState<'all' | AStatus>('all');
  const [creating, setCreating] = useState(false);
  const [questionType, setQuestionType] = useState('mc');
  const [difficulty, setDifficulty] = useState('Medium');
  const [assignTo, setAssignTo] = useState('Period 3');
  const [xpReward, setXpReward] = useState('50');
  const [timeLimit, setTimeLimit] = useState('15');

  const filteredQuizzes = quizFilter === 'all' ? QUIZZES : QUIZZES.filter((q) => q.status === quizFilter);
  const filteredAssignments = assignFilter === 'all' ? ASSIGNMENTS : ASSIGNMENTS.filter((a) => a.status === assignFilter);

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Content"
        subtitle={`${QUIZZES.length} quizzes · ${ASSIGNMENTS.length} assignments`}
        rightIcon={creating ? 'close' : 'add'}
        onRightPress={() => setCreating(!creating)}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Tab switcher */}
        <View style={styles.section}>
          <View style={styles.tabBar}>
            <TouchableOpacity style={[styles.tabBtn, tab === 'quizzes' && styles.tabBtnActive]} onPress={() => { setTab('quizzes'); setCreating(false); }}>
              <Ionicons name="help-circle" size={16} color={tab === 'quizzes' ? 'white' : COLORS.purplePrimary} />
              <Text style={[styles.tabBtnText, tab === 'quizzes' && { color: 'white' }]}>Quizzes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabBtn, tab === 'assignments' && styles.tabBtnActive]} onPress={() => { setTab('assignments'); setCreating(false); }}>
              <Ionicons name="document-text" size={16} color={tab === 'assignments' ? 'white' : COLORS.purplePrimary} />
              <Text style={[styles.tabBtnText, tab === 'assignments' && { color: 'white' }]}>Assignments</Text>
            </TouchableOpacity>
          </View>
        </View>

        {creating && tab === 'quizzes' && (
          <View style={styles.section}>
            <SectionHeader title="New Quiz" />
            <View style={styles.builderCard}>
              <Text style={styles.fieldLabel}>Quiz Title</Text>
              <TextInput style={styles.input} placeholder="e.g. Fractions Quiz" placeholderTextColor={COLORS.textMuted} />

              <Text style={styles.fieldLabel}>Question Type</Text>
              <View style={styles.chipRow}>
                {QUESTION_TYPES.map((qt) => (
                  <TouchableOpacity
                    key={qt.id}
                    style={[styles.typeChip, questionType === qt.id && styles.typeChipActive]}
                    onPress={() => setQuestionType(qt.id)}
                  >
                    <Ionicons name={qt.icon} size={14} color={questionType === qt.id ? 'white' : COLORS.purplePrimary} />
                    <Text style={[styles.typeChipText, questionType === qt.id && { color: 'white' }]}>{qt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.addQuestionBtn} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={16} color={COLORS.purplePrimary} />
                <Text style={styles.addQuestionText}>Add Question</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <Text style={styles.fieldLabel}>Difficulty</Text>
              <View style={styles.chipRow}>
                {DIFFICULTIES.map((d) => (
                  <FilterChip key={d} label={d} active={difficulty === d} onPress={() => setDifficulty(d)} />
                ))}
              </View>

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>XP Reward</Text>
                  <TextInput style={styles.input} value={xpReward} onChangeText={setXpReward} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Time Limit (min)</Text>
                  <TextInput style={styles.input} value={timeLimit} onChangeText={setTimeLimit} keyboardType="number-pad" />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Due Date</Text>
              <TouchableOpacity style={styles.input}>
                <Text style={{ color: COLORS.textSecondary, fontFamily: FONTS.medium }}>Select a due date</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Assign To</Text>
              <View style={styles.chipRow}>
                {ASSIGN_TARGETS.map((t) => (
                  <FilterChip key={t} label={t} active={assignTo === t} onPress={() => setAssignTo(t)} />
                ))}
              </View>

              <TouchableOpacity style={styles.publishBtn} activeOpacity={0.85}>
                <Ionicons name="rocket" size={16} color="white" />
                <Text style={styles.publishText}>Publish Quiz</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {creating && tab === 'assignments' && (
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

        {tab === 'quizzes' && (
          <View style={styles.section}>
            <View style={styles.filterRow}>
              <FilterChip label="All" active={quizFilter === 'all'} onPress={() => setQuizFilter('all')} />
              <FilterChip label="Assigned" active={quizFilter === 'assigned'} onPress={() => setQuizFilter('assigned')} />
              <FilterChip label="Draft" active={quizFilter === 'draft'} onPress={() => setQuizFilter('draft')} />
              <FilterChip label="Closed" active={quizFilter === 'closed'} onPress={() => setQuizFilter('closed')} />
            </View>

            {filteredQuizzes.length > 0 ? (
              <View style={{ gap: 12 }}>
                {filteredQuizzes.map((q) => (
                  <View key={q.id} style={styles.quizCard}>
                    <View style={styles.quizCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.quizCardTitle}>{q.title}</Text>
                        <Text style={styles.quizCardMeta}>{q.questions} questions · {q.difficulty} · {q.assignedTo}</Text>
                      </View>
                      <Pill label={q.status} color={quizStatusColor(q.status)} />
                    </View>
                    <View style={styles.quizCardActions}>
                      <TouchableOpacity style={styles.quizActionBtn}>
                        <Ionicons name="create-outline" size={16} color={COLORS.purplePrimary} />
                        <Text style={styles.quizActionText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.quizActionBtn}>
                        <Ionicons name="paper-plane-outline" size={16} color={COLORS.purplePrimary} />
                        <Text style={styles.quizActionText}>Assign</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.quizActionBtn}>
                        <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                        <Text style={[styles.quizActionText, { color: COLORS.danger }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState icon="document-text-outline" title="No quizzes here" text="Try a different filter or create a new quiz." />
            )}
          </View>
        )}

        {tab === 'assignments' && (
          <View style={styles.section}>
            <View style={styles.filterRow}>
              <FilterChip label="All" active={assignFilter === 'all'} onPress={() => setAssignFilter('all')} />
              <FilterChip label="Assigned" active={assignFilter === 'assigned'} onPress={() => setAssignFilter('assigned')} />
              <FilterChip label="Submitted" active={assignFilter === 'submitted'} onPress={() => setAssignFilter('submitted')} />
              <FilterChip label="Overdue" active={assignFilter === 'overdue'} onPress={() => setAssignFilter('overdue')} />
            </View>

            {filteredAssignments.length > 0 ? (
              <View style={{ gap: 12 }}>
                {filteredAssignments.map((a) => {
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
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },

  tabBar: { flexDirection: 'row', gap: 10 },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.pill,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabBtnActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  tabBtnText: { fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },

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
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADIUS.pill,
    backgroundColor: tint(COLORS.purplePrimary),
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typeChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  typeChipText: { fontSize: 12.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
  addQuestionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
  addQuestionText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
  divider: { height: 1, backgroundColor: COLORS.border, marginTop: 18 },
  rowFields: { flexDirection: 'row', gap: 12 },
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
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'white', borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border },
  attachText: { flex: 1, fontSize: 13.5, fontFamily: FONTS.medium, color: COLORS.textSecondary },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },

  quizCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  quizCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  quizCardTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  quizCardMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  quizCardActions: { flexDirection: 'row', gap: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  quizActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  quizActionText: { fontSize: 12.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  cardMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  submissionText: { fontSize: 11.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted, marginTop: 8 },
});
