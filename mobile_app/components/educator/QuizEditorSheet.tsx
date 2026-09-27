import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { updateQuiz, parseDeadlineInput, toDeadlineInput, type Quiz } from '@/services/quizService';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';

interface EditableQuestion {
  id?: number;
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

interface EditableQuiz {
  id: number;
  title: string;
  quiz_type: string;
  /** User-facing deadline text ("YYYY-MM-DD HH:MM") or '' for no deadline. */
  available_until: string;
  questions: EditableQuestion[];
}

const HAS_OPTIONS = ['Multiple Choice', 'True/False'];

type Props = {
  /** The quiz to edit. Null closes the sheet. */
  quiz: Quiz | null;
  onClose: () => void;
  /** Called after a successful save so the host can refresh its list. */
  onSaved?: () => void | Promise<void>;
};

/**
 * Quiz editor as a slide-up sheet, shared by the class Quizzes tab and the
 * standalone quiz manager so both edit through the exact same UI. It owns its
 * own draft so a host only has to hold the quiz being edited.
 */
export function QuizEditorSheet({ quiz, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<EditableQuiz | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Deadline picker state
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [deadlinePickerMode, setDeadlinePickerMode] = useState<'date' | 'time'>('date');
  const [deadlineTempDate, setDeadlineTempDate] = useState<Date>(new Date());

  // Seed the draft whenever a different quiz is opened.
  useEffect(() => {
    if (!quiz) {
      setDraft(null);
      return;
    }
    setDraft({
      id: quiz.id,
      title: quiz.title,
      quiz_type: quiz.quiz_type,
      available_until: quiz.available_until ? toDeadlineInput(new Date(quiz.available_until)) : '',
      questions: (quiz.questions || []).map((q) => ({
        id: q.id,
        question_text: q.question_text,
        options: [...(q.options || [])],
        correct_answer: q.correct_answer,
        explanation: q.explanation || '',
      })),
    });
    setShowDeadlinePicker(false);
  }, [quiz]);

  const close = () => {
    if (isSaving) return;
    setDraft(null);
    onClose();
  };

  const openDeadlinePicker = () => {
    const parsed = draft?.available_until ? parseDeadlineInput(draft.available_until) : null;
    setDeadlineTempDate(parsed || new Date());
    setDeadlinePickerMode('date');
    setShowDeadlinePicker(true);
  };

  const clearDeadline = () => {
    if (draft) setDraft({ ...draft, available_until: '' });
  };

  const handleDeadlineChange = ({ nativeEvent }: { nativeEvent: { type?: string; timestamp?: number } }) => {
    if (nativeEvent.type === 'dismissed') {
      setShowDeadlinePicker(false);
      return;
    }
    const newDate = nativeEvent.timestamp ? new Date(nativeEvent.timestamp) : deadlineTempDate;
    setDeadlineTempDate(newDate);
    if (deadlinePickerMode === 'date') {
      setDeadlinePickerMode('time');
      return;
    }
    const combined = new Date(
      deadlineTempDate.getFullYear(),
      deadlineTempDate.getMonth(),
      deadlineTempDate.getDate(),
      newDate.getHours(),
      newDate.getMinutes(),
    );
    setDraft((d) => (d ? { ...d, available_until: toDeadlineInput(combined) } : d));
    setShowDeadlinePicker(false);
  };

  const updateQuestion = (index: number, field: keyof EditableQuestion, value: string | string[]) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => (i === index ? { ...q, [field]: value } : q));
    setDraft({ ...draft, questions });
  };

  const updateOption = (qIndex: number, oIndex: number, text: string) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => {
      if (i !== qIndex) return q;
      const options = q.options.map((opt, oi) => (oi === oIndex ? text : opt));
      const correct_answer = q.correct_answer === q.options[oIndex] ? text : q.correct_answer;
      return { ...q, options, correct_answer };
    });
    setDraft({ ...draft, questions });
  };

  const addOption = (qIndex: number) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => (i === qIndex ? { ...q, options: [...q.options, ''] } : q));
    setDraft({ ...draft, questions });
  };

  const removeOption = (qIndex: number, oIndex: number) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => {
      if (i !== qIndex) return q;
      const removed = q.options[oIndex];
      const options = q.options.filter((_, oi) => oi !== oIndex);
      const correct_answer = q.correct_answer === removed ? '' : q.correct_answer;
      return { ...q, options, correct_answer };
    });
    setDraft({ ...draft, questions });
  };

  const removeQuestion = (qIndex: number) => {
    if (!draft) return;
    setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== qIndex) });
  };

  const addQuestion = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      questions: [...draft.questions, { question_text: '', options: ['', ''], correct_answer: '', explanation: '' }],
    });
  };

  const handleSave = async () => {
    if (!draft) return;

    if (!draft.title.trim()) {
      Alert.alert('Missing Title', 'Give the quiz a title before saving.');
      return;
    }

    for (let i = 0; i < draft.questions.length; i++) {
      const q = draft.questions[i];
      if (!q.question_text.trim()) {
        Alert.alert('Incomplete Question', `Question ${i + 1} needs question text.`);
        return;
      }
      if (HAS_OPTIONS.includes(draft.quiz_type)) {
        const nonEmpty = q.options.filter((o) => o.trim());
        if (nonEmpty.length < 2) {
          Alert.alert('Incomplete Question', `Question ${i + 1} needs at least two options.`);
          return;
        }
        if (!q.correct_answer) {
          Alert.alert('Missing Correct Answer', `Pick the correct answer for Question ${i + 1}.`);
          return;
        }
      } else if (!q.correct_answer.trim()) {
        Alert.alert('Missing Answer', `Question ${i + 1} needs an answer.`);
        return;
      }
    }

    setIsSaving(true);
    try {
      let deadlineIso: string | null = null;
      if (draft.available_until.trim()) {
        const parsed = parseDeadlineInput(draft.available_until);
        if (!parsed) {
          Alert.alert('Invalid Deadline', 'Enter the deadline as YYYY-MM-DD HH:MM (24-hour), or leave it blank.');
          setIsSaving(false);
          return;
        }
        deadlineIso = parsed.toISOString();
      }

      await updateQuiz(draft.id, {
        title: draft.title.trim(),
        available_until: deadlineIso,
        questions: draft.questions.map((q) => ({
          id: q.id,
          question_text: q.question_text.trim(),
          options: q.options.map((o) => o.trim()).filter((o) => o !== ''),
          correct_answer: q.correct_answer,
          explanation: q.explanation.trim(),
        })),
      });
      await onSaved?.();
      setDraft(null);
      onClose();
      Alert.alert('Saved', 'Quiz updated successfully.');
    } catch (err) {
      console.error('Save Error:', err);
      Alert.alert('Save Failed', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!quiz || !draft) return null;

  return (
    <>
      <Modal visible={!!quiz} animationType="slide" transparent onRequestClose={close}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <TouchableOpacity onPress={close} style={styles.headerBtn} disabled={isSaving} hitSlop={10}>
                <Ionicons name="close" size={22} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.headerTitle} numberOfLines={1}>Edit Quiz</Text>
              <TouchableOpacity
                style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving
                  ? <ActivityIndicator size="small" color="white" />
                  : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
              contentContainerStyle={styles.content}
            >
              <Text style={styles.label}>Quiz Title</Text>
              <TextInput
                style={styles.titleInput}
                value={draft.title}
                onChangeText={(text) => setDraft({ ...draft, title: text })}
                placeholder="Quiz title"
                placeholderTextColor={COLORS.textMuted}
              />

              <Text style={styles.label}>Deadline (Optional) · YYYY-MM-DD HH:MM</Text>
              <View style={styles.deadlineRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={draft.available_until}
                  onChangeText={(text) => setDraft({ ...draft, available_until: text })}
                  placeholder="e.g. 2026-10-01 23:59 — blank = no deadline"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.pickerBtn} activeOpacity={0.8} onPress={openDeadlinePicker} disabled={isSaving}>
                  <Ionicons name="calendar" size={22} color={COLORS.purplePrimary} />
                </TouchableOpacity>
                {!!draft.available_until && (
                  <TouchableOpacity style={styles.pickerBtn} activeOpacity={0.8} onPress={clearDeadline} disabled={isSaving}>
                    <Ionicons name="close-circle" size={22} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.meta}>
                {draft.questions.length} questions · {draft.quiz_type} · Tap an option to mark the correct answer
              </Text>

              {draft.questions.map((question, qIndex) => (
                <View key={question.id ?? `new-${qIndex}`} style={styles.questionCard}>
                  <View style={styles.questionCardHeader}>
                    <Text style={styles.questionNumber}>Question {qIndex + 1}</Text>
                    <TouchableOpacity onPress={() => removeQuestion(qIndex)}>
                      <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    style={[styles.input, styles.questionTextInput]}
                    value={question.question_text}
                    onChangeText={(text) => updateQuestion(qIndex, 'question_text', text)}
                    placeholder="Enter the question"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />

                  {HAS_OPTIONS.includes(draft.quiz_type) ? (
                    <>
                      <Text style={styles.label}>Options</Text>
                      {question.options.map((option, oIndex) => {
                        const isCorrect = option === question.correct_answer && !!option;
                        return (
                          <View key={oIndex} style={styles.optionRow}>
                            <TouchableOpacity
                              style={styles.optionCheck}
                              onPress={() => updateQuestion(qIndex, 'correct_answer', option)}
                            >
                              <Ionicons
                                name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                                size={20}
                                color={isCorrect ? COLORS.success : COLORS.textMuted}
                              />
                            </TouchableOpacity>
                            <TextInput
                              style={styles.optionInput}
                              value={option}
                              onChangeText={(text) => updateOption(qIndex, oIndex, text)}
                              placeholder={`Option ${oIndex + 1}`}
                              placeholderTextColor={COLORS.textMuted}
                            />
                            <TouchableOpacity style={styles.optionRemove} onPress={() => removeOption(qIndex, oIndex)}>
                              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      <TouchableOpacity style={styles.addOptionBtn} onPress={() => addOption(qIndex)}>
                        <Ionicons name="add" size={16} color={COLORS.purplePrimary} />
                        <Text style={styles.addOptionText}>Add Option</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={styles.label}>Answer</Text>
                      <TextInput
                        style={styles.input}
                        value={question.correct_answer}
                        onChangeText={(text) => updateQuestion(qIndex, 'correct_answer', text)}
                        placeholder="Enter the correct answer"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </>
                  )}

                  <Text style={styles.label}>Explanation (Optional)</Text>
                  <TextInput
                    style={[styles.input, styles.explanationInput]}
                    value={question.explanation}
                    onChangeText={(text) => updateQuestion(qIndex, 'explanation', text)}
                    placeholder="Brief explanation why"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />
                </View>
              ))}

              <TouchableOpacity style={styles.addQuestionBtn} onPress={addQuestion}>
                <Ionicons name="add-circle-outline" size={18} color={COLORS.purplePrimary} />
                <Text style={styles.addQuestionText}>Add Question</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {showDeadlinePicker && Platform.OS !== 'web' && (
        <DateTimePicker
          testID="deadlinePicker"
          value={deadlineTempDate}
          mode={deadlinePickerMode}
          is24Hour={true}
          onChange={handleDeadlineChange}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    width: '100%',
    maxHeight: '90%',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginTop: 8,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  saveBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 62,
    alignItems: 'center',
  },
  saveText: { color: 'white', fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },

  content: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  titleInput: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  meta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 10 },
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

  questionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  questionCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  questionNumber: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleDeep },
  questionTextInput: { marginTop: 6, minHeight: 64, textAlignVertical: 'top' },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  optionCheck: { padding: 2 },
  optionInput: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionRemove: { padding: 2 },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start' },
  addOptionText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  explanationInput: { minHeight: 60, textAlignVertical: 'top' },

  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.purplePrimary,
    borderStyle: 'dashed',
    backgroundColor: tint(COLORS.purplePrimary),
  },
  addQuestionText: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerBtn: { padding: 6 },
});
