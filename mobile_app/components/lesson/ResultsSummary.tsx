import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import ProgressRing from '@/components/courses/ProgressRing';
import { QuestionResult } from './QuizRunner';

const COLORS = {
  bg: '#baaeda',
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  success: '#10B981',
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
  onRetry?: () => void;
  onContinue: () => void;
}

export default function ResultsSummary({
  score,
  passed,
  passingScore,
  results,
  xpEarned,
  onRetry,
  onContinue,
}: ResultsSummaryProps) {
  const correct = results.filter(r => r.correct).length;
  const total = results.length;

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
          {xpEarned !== undefined && ` — +${xpEarned} XP`}
        </Text>
      </LinearGradient>

      {/* Wrong answers breakdown */}
      {results.filter(r => !r.correct).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Review Mistakes</Text>
          {results.filter(r => !r.correct).map((r) => (
            <View key={r.questionIndex} style={styles.mistakeCard}>
              <View style={styles.mistakeHeader}>
                <Ionicons name="close-circle" size={16} color={COLORS.danger} />
                <Text style={styles.mistakeQ} numberOfLines={2}>
                  Q{r.questionIndex + 1}
                </Text>
              </View>
              <View style={styles.mistakeRow}>
                <View style={[styles.mistakePill, styles.mistakePillWrong]}>
                  <Text style={styles.mistakePillText}>{r.selectedAnswer}</Text>
                </View>
                <Ionicons name="arrow-forward" size={12} color={COLORS.textMuted} />
                <View style={[styles.mistakePill, styles.mistakePillRight]}>
                  <Text style={[styles.mistakePillText, { color: COLORS.success }]}>{r.correctAnswer}</Text>
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
  mistakeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  mistakeQ: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, flex: 1 },
  mistakeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mistakePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  mistakePillWrong: { backgroundColor: COLORS.danger + '15' },
  mistakePillRight: { backgroundColor: COLORS.success + '15' },
  mistakePillText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.danger },
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
