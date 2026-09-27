import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { deleteQuiz, type Quiz } from '@/services/quizService';

type Props = {
  quiz: Quiz | null;
  onClose: () => void;
  /** Omit to hide the Edit action (e.g. where no editor is hosted). */
  onEdit?: (quiz: Quiz) => void;
  /** Called after the quiz is deleted so the list can refresh. */
  onChanged?: () => void | Promise<void>;
};

/**
 * Read-only quiz detail sheet: metadata, every question with its correct answer
 * and explanation, plus Edit / Delete. Shared by the class Quizzes tab and the
 * standalone quiz manager so both open the exact same modal.
 */
export function QuizDetailModal({ quiz, onClose, onEdit, onChanged }: Props) {
  if (!quiz) return null;

  const questions = quiz.questions || [];

  const confirmDelete = () => {
    Alert.alert(
      'Delete Quiz',
      `Delete "${quiz.title}"? This will permanently remove the quiz and its questions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteQuiz(quiz.id);
              onClose();
              await onChanged?.();
            } catch (err) {
              console.error('Delete Error:', err);
              Alert.alert('Delete Failed', err instanceof Error ? err.message : 'Something went wrong.');
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={!!quiz} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1}>
                {quiz.title}
              </Text>
              <Text style={styles.subtitle}>
                {questions.length} question{questions.length === 1 ? '' : 's'} · {quiz.quiz_type}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Ionicons name="help-circle-outline" size={16} color={COLORS.textMuted} />
                <Text style={styles.metaText}>{questions.length} questions</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="document-text-outline" size={16} color={COLORS.textMuted} />
                <Text style={styles.metaText}>{quiz.quiz_type}</Text>
              </View>
              {!!quiz.available_until && (
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={16} color={COLORS.warning} />
                  <Text style={styles.metaText}>Closes {new Date(quiz.available_until).toLocaleString()}</Text>
                </View>
              )}
            </View>

            {questions.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="help-circle-outline" size={28} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>This quiz has no questions yet.</Text>
              </View>
            ) : (
              questions.map((question, idx) => (
                <View key={question.id ?? idx} style={styles.questionCard}>
                  <Text style={styles.questionText}>
                    {idx + 1}. {question.question_text}
                  </Text>
                  {(question.options || []).length > 0 && (
                    <View style={styles.options}>
                      {question.options.map((option, oi) => {
                        const isCorrect = option === question.correct_answer;
                        return (
                          <View key={oi} style={[styles.option, isCorrect && styles.optionCorrect]}>
                            <Ionicons
                              name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                              size={16}
                              color={isCorrect ? COLORS.success : COLORS.textMuted}
                            />
                            <Text style={[styles.optionText, isCorrect && styles.optionTextCorrect]}>{option}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  {!question.options?.length && !!question.correct_answer && (
                    <View style={[styles.option, styles.optionCorrect]}>
                      <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                      <Text style={[styles.optionText, styles.optionTextCorrect]}>{question.correct_answer}</Text>
                    </View>
                  )}
                  {!!question.explanation && (
                    <View style={styles.explanationRow}>
                      <Ionicons name="bulb-outline" size={14} color={COLORS.warning} />
                      <Text style={styles.explanation}>{question.explanation}</Text>
                    </View>
                  )}
                </View>
              ))
            )}

            <View style={styles.actions}>
              {onEdit && (
                <TouchableOpacity style={styles.primaryAction} onPress={() => onEdit(quiz)} activeOpacity={0.8}>
                  <Ionicons name="create-outline" size={18} color="white" />
                  <Text style={styles.primaryActionText}>Edit Quiz</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.dangerAction} onPress={confirmDelete} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                <Text style={styles.dangerActionText}>Delete Quiz</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    width: '100%',
    maxHeight: '90%',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  headerText: { flex: 1, paddingRight: 16 },
  title: { fontSize: 20, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textPrimary },
  subtitle: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  scrollBody: { paddingBottom: 24 },

  metaGrid: { gap: 10, marginBottom: 24 },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
  },
  metaText: { fontSize: 14, color: COLORS.textSecondary, flex: 1 },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted },

  questionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  questionText: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 10, lineHeight: 20 },
  options: { gap: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionCorrect: { borderColor: COLORS.success, backgroundColor: tint(COLORS.success) },
  optionText: { flex: 1, fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  optionTextCorrect: { color: COLORS.success, fontFamily: FONTS.semiBold, fontWeight: '600' },
  explanationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 },
  explanation: { flex: 1, fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 17 },

  actions: { gap: 10, marginTop: 8 },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
  },
  primaryActionText: { color: 'white', fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700' },
  dangerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  dangerActionText: { color: COLORS.danger, fontSize: 15, fontFamily: FONTS.semiBold, fontWeight: '600' },
});
