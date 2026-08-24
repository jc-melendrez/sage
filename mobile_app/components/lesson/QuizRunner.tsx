import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuizQuestion } from '@/types/learning';

const COLORS = {
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleVibrant: '#8B5CF6',
  accent: '#22D3EE',
  success: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface QuizRunnerProps {
  questions: QuizQuestion[];
  passingScore?: number;
  onFinish: (score: number, results: QuestionResult[]) => void;
}

export interface QuestionResult {
  questionIndex: number;
  correct: boolean;
  selectedAnswer: string;
  correctAnswer: string;
}

export default function QuizRunner({ questions, passingScore = 70, onFinish }: QuizRunnerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  const current = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;
  const progress = (currentIndex) / questions.length;

  const handleSelect = useCallback((answer: string) => {
    if (answered) return;
    setSelected(answer);
    setAnswered(true);

    const isCorrect = answer === current.correct_answer;
    const newResults = [...results, {
      questionIndex: currentIndex,
      correct: isCorrect,
      selectedAnswer: answer,
      correctAnswer: current.correct_answer,
    }];
    setResults(newResults);
  }, [answered, current, currentIndex, results]);

  const handleNext = useCallback(() => {
    if (isLast) {
      const correct = results.filter(r => r.correct).length;
      const score = Math.round((correct / questions.length) * 100);
      onFinish(score, results);
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelected(null);
      setAnswered(false);
    }
  }, [isLast, results, questions.length, onFinish]);

  const correctSoFar = results.filter(r => r.correct).length;

  if (questions.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={{ fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center', marginTop: 60 }}>
          No questions available for this activity.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Progress */}
      <View style={styles.progressHeader}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{currentIndex + 1}/{questions.length}</Text>
      </View>

      {/* Question */}
      <View style={styles.questionCard}>
        <Text style={styles.questionText}>{current.question}</Text>
      </View>

      {/* Options */}
      <View style={styles.optionsContainer}>
        {current.options.map((opt) => {
          let optStyle: any = styles.option;
          let textStyle: any = styles.optionText;

          if (answered) {
            if (opt === current.correct_answer) {
              optStyle = { ...optStyle, ...styles.optionCorrect };
              textStyle = { ...textStyle, color: 'white' };
            } else if (opt === selected) {
              optStyle = { ...optStyle, ...styles.optionWrong };
              textStyle = { ...textStyle, color: 'white' };
            } else {
              optStyle = { ...optStyle, opacity: 0.45 };
            }
          } else if (opt === selected) {
            optStyle = { ...optStyle, ...styles.optionSelected };
          }

          return (
            <TouchableOpacity
              key={opt}
              style={optStyle}
              onPress={() => handleSelect(opt)}
              disabled={answered}
              activeOpacity={0.8}
            >
              <Text style={textStyle}>{opt}</Text>
              {answered && opt === current.correct_answer && <Ionicons name="checkmark-circle" size={18} color="white" />}
              {answered && opt === selected && opt !== current.correct_answer && <Ionicons name="close-circle" size={18} color="white" />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Explanation */}
      {answered && current.explanation && (
        <View style={styles.explanationBox}>
          <Ionicons name="bulb-outline" size={16} color={COLORS.warning} />
          <Text style={styles.explanationText}>{current.explanation}</Text>
        </View>
      )}

      {/* Next button */}
      {answered && (
        <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.85}>
          <Text style={styles.nextText}>{isLast ? 'See Results' : 'Next'}</Text>
          <Ionicons name={isLast ? 'trophy' : 'arrow-forward'} size={18} color="white" />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  progressBar: { flex: 1, height: 6, backgroundColor: 'rgba(124,58,237,0.12)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.purpleVibrant, borderRadius: 3 },
  progressText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, minWidth: 36, textAlign: 'right' },
  questionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 18,
  },
  questionText: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, lineHeight: 24 },
  optionsContainer: { gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  optionSelected: { borderColor: COLORS.purpleVibrant, backgroundColor: COLORS.purpleVibrant + '10' },
  optionCorrect: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  optionWrong: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  optionText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1, lineHeight: 20 },
  explanationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    padding: 14,
    backgroundColor: COLORS.warning + '12',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.warning + '30',
  },
  explanationText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1, lineHeight: 19 },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    backgroundColor: COLORS.purpleVibrant,
    paddingVertical: 16,
    borderRadius: 16,
  },
  nextText: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
});
