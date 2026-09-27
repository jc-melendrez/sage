import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ProgressRing from '@/components/courses/ProgressRing';
import { QuestionResult } from './QuizRunner';

const COLORS = {
  bg: '#baaeda',
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  success: '#10B981',
  successDeep: '#047857',
  danger: '#EF4444',
  warning: '#F59E0B',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface ResultsSummaryProps {
  score: number;
  passed: boolean;
  passingScore: number;
  results: QuestionResult[];
  xpEarned?: number;
  /**
   * 'quiz' shows a score ring, accuracy and a pass/fail verdict.
   * 'lesson' hides accuracy entirely — there are no questions to be right
   * about, so a 0% ring on a completed lesson was just wrong.
   */
  mode?: 'quiz' | 'lesson';
  /** Activity title, shown under "Lesson Complete!". */
  title?: string;
  onRetry?: () => void;
  onContinue: () => void;
  /** Dismiss without leaving the screen (e.g. an in-place runner). */
  onClose?: () => void;
}

export default function ResultsSummary({
  score,
  passed,
  passingScore,
  results,
  xpEarned,
  mode = 'quiz',
  title,
  onRetry,
  onContinue,
  onClose,
}: ResultsSummaryProps) {
  const isLesson = mode === 'lesson';
  const correct = results.filter(r => r.correct).length;
  const total = results.length;
  const mistakes = results.filter(r => !r.correct);

  // In lesson mode there is no accuracy to report, so skip the ring entirely.
  if (isLesson) {
    return (
      <View style={styles.lessonResults}>
        {onClose ? (
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={26} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}

        <LinearGradient colors={['#10B981', '#059669']} style={styles.lessonBadge}>
          <Ionicons name="checkmark-circle" size={44} color="white" />
        </LinearGradient>

        <Text style={styles.lessonTitle}>Lesson Complete!</Text>
        <Text style={styles.lessonSub}>
          Nice work{title ? ` on ${title}` : ''}. Keep practicing whenever you want to reinforce it.
        </Text>
        {xpEarned !== undefined && xpEarned > 0 ? (
          <Text style={styles.lessonXp}>+{xpEarned} XP earned</Text>
        ) : null}

        <TouchableOpacity
          style={styles.practiceBtn}
          onPress={onRetry}
          activeOpacity={0.85}
        >
          <Ionicons name="refresh" size={18} color="white" />
          <Text style={styles.practiceText}>Keep Practicing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.lessonContinueBtn}
          onPress={onContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.lessonContinueText}>Back to Path</Text>
          <Ionicons name="arrow-forward" size={18} color={COLORS.purpleVibrant} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <LinearGradient
        colors={passed ? ['#10B981', '#059669'] : ['#6D28D9', '#4C1D95']}
        style={styles.hero}
      >
        <ProgressRing progress={score} size={100} strokeWidth={8} fillColor="white" />
        <View style={styles.heroRingOverlay}>
          <Text style={styles.heroScore}>{score}%</Text>
        </View>
        <Text style={styles.heroTitle}>
          {passed ? (score === 100 ? 'Perfect Score!' : 'Great Job!') : 'Keep Practicing!'}
        </Text>
        <Text style={styles.heroSub}>
          {correct}/{total} correct
          {passed && ` — You passed (${passingScore}% required)`}
          {xpEarned !== undefined && xpEarned > 0 && ` — +${xpEarned} XP`}
        </Text>
      </LinearGradient>

      {/* Wrong answers breakdown */}
      {mistakes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Review Mistakes</Text>
          {mistakes.map((r) => (
            <View key={r.questionIndex} style={styles.mistakeCard}>
              <View style={styles.mistakeHeader}>
                <Ionicons name="close-circle" size={16} color={COLORS.danger} style={styles.mistakeIcon} />
                <Text style={styles.mistakeQ}>
                  {r.question || `Question ${r.questionIndex + 1}`}
                </Text>
              </View>
              {/* Stacked, not side-by-side: long answers were being clipped. */}
              <View style={styles.answerStack}>
                <View style={[styles.answerBox, styles.answerBoxWrong]}>
                  <Text style={styles.answerLabel}>Your answer</Text>
                  <Text style={styles.answerTextWrong}>{r.selectedAnswer || 'No answer'}</Text>
                </View>
                <View style={[styles.answerBox, styles.answerBoxRight]}>
                  <Text style={[styles.answerLabel, { color: COLORS.success }]}>Correct answer</Text>
                  <Text style={[styles.answerText, { color: COLORS.successDeep }]}>{r.correctAnswer}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {!passed && onRetry && (
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.85}>
            <Ionicons name="refresh" size={18} color={COLORS.purpleVibrant} />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.continueBtn, passed && styles.continueBtnPass]}
          onPress={onContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.continueText}>{passed ? 'Continue' : 'Back to Path'}</Text>
          <Ionicons name="arrow-forward" size={18} color="white" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40, alignItems: 'center' },
  hero: {
    width: '100%',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    marginBottom: 24,
  },
  heroRingOverlay: { position: 'absolute', top: 28, width: 100, height: 100, justifyContent: 'center', alignItems: 'center' },
  heroScore: { fontSize: 28, fontFamily: FONTS.extraBold, fontWeight: '900', color: 'white' },
  heroTitle: { fontSize: 22, fontFamily: FONTS.extraBold, fontWeight: '900', color: 'white', marginTop: 16 },
  heroSub: { fontSize: 13, fontFamily: FONTS.medium, color: 'rgba(255,255,255,0.8)', marginTop: 6, textAlign: 'center' },
  section: { width: '100%', marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 12 },
  mistakeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  mistakeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  mistakeIcon: { marginTop: 1 },
  mistakeQ: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, flex: 1, lineHeight: 19 },
  // Answers stack vertically so a long option wraps instead of being clipped.
  answerStack: { gap: 8 },
  answerBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  answerBoxWrong: { backgroundColor: COLORS.danger + '15' },
  answerBoxRight: { backgroundColor: COLORS.success + '15' },
  answerLabel: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.danger, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  answerText: { fontSize: 13, fontFamily: FONTS.medium, lineHeight: 19 },
  answerTextWrong: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.danger, lineHeight: 19 },

  // Lesson-complete layout: vertically centred, no score ring.
  lessonResults: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
    backgroundColor: COLORS.bg,
  },
  closeBtn: { position: 'absolute', top: 52, right: 20, padding: 4 },
  lessonBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonTitle: { fontSize: 26, fontFamily: FONTS.extraBold, fontWeight: '900', color: COLORS.textPrimary, marginTop: 24 },
  lessonSub: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  lessonXp: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.success, marginTop: 12 },
  practiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 320,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: COLORS.purpleVibrant,
    marginTop: 32,
  },
  practiceText: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
  lessonContinueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    maxWidth: 320,
    paddingVertical: 15,
    borderRadius: 16,
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: COLORS.purpleVibrant + '40',
    backgroundColor: 'white',
  },
  lessonContinueText: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleVibrant },
  actions: { flexDirection: 'row', gap: 12, width: '100%' },
  retryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.purpleVibrant + '40',
    backgroundColor: 'white',
  },
  retryText: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleVibrant },
  continueBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: COLORS.purpleVibrant,
  },
  continueBtnPass: { backgroundColor: COLORS.success },
  continueText: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
});
