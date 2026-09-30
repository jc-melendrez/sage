import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';

// Define a basic interface for a quiz question
interface QuizQuestion {
  id: number;
  question: string;
  type: 'Multiple Choice' | 'True/False' | 'Short Answer' | 'Fill-in-the-Blank';
  options?: string[]; // For Multiple Choice
  correct_answer?: string; // For validation (optional for this template)
  /**
   * Why the correct answer is correct. The model writes one per question and
   * the serializer already returns it, so the review below has something to
   * teach with instead of just marking an answer red.
   */
  explanation?: string | null;
}

export interface QuizRewardInfo {
  xp: number;
  badges: { icon: string; name: string }[];
}

/** One graded question, kept so the end-of-quiz review can explain it. */
export interface TakeQuizResult {
  question: string;
  /** What the student picked. `null` for a question they never answered. */
  yourAnswer: string | null;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
}

interface TakeQuizProps {
  quizTitle: string;
  questions: QuizQuestion[];
  /**
   * May be async and return reward info (XP/badges) to display in the results
   * view. The second argument is the per-question review; existing callers
   * ignore it, so it is optional in practice.
   */
  onFinish: (score: number, results?: TakeQuizResult[]) => QuizRewardInfo | void | Promise<QuizRewardInfo | void>;
  onClose: () => void; // Callback to close the quiz
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const TakeQuiz: React.FC<TakeQuizProps> = ({ quizTitle, questions, onFinish, onClose }) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Keyed by array index, not by question id. Ids come from the database, but
  // the response from a generation call echoes the ids the model invented, and
  // a collision there would silently overwrite one answer with another.
  const [userAnswers, setUserAnswers] = useState<{ [key: number]: string | string[] }>({});
  const [score, setScore] = useState<number | null>(null);
  const [review, setReview] = useState<TakeQuizResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [missedOnly, setMissedOnly] = useState(false);
  const [reward, setReward] = useState<QuizRewardInfo | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  // A short fade/scale on entry. The quiz used to snap in flat, which read as
  // a jump cut the moment the sheet closed.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 320 });
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.97 + 0.03 * enter.value }],
  }));

  const currentQuestion = questions[currentQuestionIndex] || questions[0];

  // answers is undefined until the quiz mounts, so every early return below
  // has to sit after this.
  const answers = questions;

  const progress = answers.length > 0 ? ((currentQuestionIndex + 1) / answers.length) * 100 : 0;

  const getOptionLabel = (index: number) => {
    return OPTION_LABELS[index] || '';
  };

  const handleAnswer = (index: number, answer: string | string[]) => {
    setUserAnswers(prev => ({ ...prev, [index]: answer }));
  };

  const hasAnswered = useCallback((index: number) => {
    const answer = userAnswers[index];
    if (answer == null) return false;
    if (Array.isArray(answer)) return answer.length > 0;
    // A short-answer box the student typed into and then cleared is not an
    // answer, so trim before deciding.
    return answer.trim().length > 0;
  }, [userAnswers]);

  const canAdvance = hasAnswered(currentQuestionIndex);

  const renderQuestionContent = () => {
    switch (currentQuestion.type) {
      case 'Multiple Choice':
        return (
          <View style={styles.optionsList}>
            {currentQuestion.options?.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.optionButton,
                  userAnswers[currentQuestionIndex] === option ? styles.optionButtonSelected : styles.optionButtonUnselected,
                ]}
                onPress={() => handleAnswer(currentQuestionIndex, option)}
              >
                <View style={[
                  styles.optionPrefix,
                  userAnswers[currentQuestionIndex] === option ? styles.optionPrefixSelected : styles.optionPrefixUnselected
                ]}>
                  <Text style={[
                    styles.optionPrefixText,
                    userAnswers[currentQuestionIndex] === option ? { color: 'white' } : { color: '#6D28D9' }
                  ]}>
                    {getOptionLabel(index)}
                  </Text>
                </View>
                <Text style={[
                  styles.optionText,
                  userAnswers[currentQuestionIndex] === option ? styles.optionTextSelected : styles.optionTextUnselected,
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      case 'True/False':
        return (
          <View style={styles.tfContainer}>
            {['True', 'False'].map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionButton,
                  { flex: 1, marginHorizontal: 6 },
                  userAnswers[currentQuestionIndex] === option && styles.optionButtonSelected,
                ]}
                onPress={() => handleAnswer(currentQuestionIndex, option)}
              >
                <Text style={[
                  styles.optionText,
                  userAnswers[currentQuestionIndex] === option && styles.optionTextSelected,
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      case 'Short Answer':
        return (
          <TextInput
            style={styles.shortAnswerInput}
            placeholder="Type your answer here..."
            placeholderTextColor="#9CA3AF"
            multiline
            value={(userAnswers[currentQuestionIndex] as string) || ''}
            onChangeText={(text) => handleAnswer(currentQuestionIndex, text)}
          />
        );
      case 'Fill-in-the-Blank':
        // Assuming the question text contains a blank, e.g., "The capital of France is ____."
        // For simplicity, we'll just use a single input field.
        return (
          <TextInput
            style={styles.shortAnswerInput}
            placeholder="Fill in the blank..."
            placeholderTextColor="#9CA3AF"
            value={(userAnswers[currentQuestionIndex] as string) || ''}
            onChangeText={(text) => handleAnswer(currentQuestionIndex, text)}
          />
        );
      default:
        return <Text>Unsupported question type.</Text>;
    }
  };

  const normalise = (value: unknown): string => {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  const handleSubmitQuiz = () => {
    let correctCount = 0;
    // Graded per question and kept, so the review can say what was right and
    // why. The old version counted and threw the detail away, which left the
    // results screen able to show a number and nothing else.
    const results: TakeQuizResult[] = answers.map((q, index) => {
      const rawAnswer = userAnswers[index];
      const yourAnswer = normalise(rawAnswer);
      const correctAnswer = normalise(q.correct_answer);
      // Case-insensitive trim comparison for text/short answer/multiple choice
      const correct = yourAnswer.length > 0
        && correctAnswer.length > 0
        && yourAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      if (correct) correctCount++;
      return {
        question: q.question,
        yourAnswer: yourAnswer.length > 0 ? yourAnswer : null,
        correctAnswer,
        correct,
        explanation: (q.explanation ?? '').trim(),
      };
    });

    setScore(correctCount);
    setReview(results);
    setMissedOnly(correctCount < results.length);
    setShowResults(true);
  };

  const handleFinish = async () => {
    if (score === null || isFinishing) return;
    if (reward !== null) {
      // Rewards already recorded — second tap dismisses the quiz entirely.
      onClose();
      return;
    }
    setIsFinishing(true);
    try {
      const result = await onFinish(score, review);
      if (result && typeof result === 'object') {
        setReward(result as QuizRewardInfo);
      } else {
        // No reward info (e.g. legacy callers) — close immediately.
        onClose();
      }
    } catch (err) {
      console.error('Failed to record quiz result:', err);
      onClose();
    } finally {
      setIsFinishing(false);
    }
  };

  const missedCount = useMemo(() => review.filter((r) => !r.correct).length, [review]);
  const visibleReview = useMemo(
    () => (missedOnly ? review.filter((r) => !r.correct) : review),
    [missedOnly, review],
  );

  const isLastQuestion = currentQuestionIndex >= answers.length - 1;

  // After the hooks, because a conditional return above them would break the
  // hook order across renders.
  if (!questions || questions.length === 0) return null;

  return (
    <KeyboardSafeView style={styles.container}>
    <Animated.View style={[styles.container, enterStyle]}>
      {/* Modern Gradient Header */}
      <LinearGradient colors={['#6D28D9', '#4F46E5']} style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={28} color="white" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.quizTitle} numberOfLines={1}>{quizTitle}</Text>
          <Text style={styles.questionCounter}>Question {currentQuestionIndex + 1} of {answers.length}</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="timer-outline" size={22} color="rgba(255,255,255,0.8)" />
        </View>
      </LinearGradient>

      {/* Animated Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
      </View>

      <ScrollView style={styles.questionArea} contentContainerStyle={styles.questionContent}>
        <View style={styles.questionCard}>
          <Text style={styles.questionText}>{currentQuestion.question}</Text>
          {renderQuestionContent()}
        </View>
      </ScrollView>

      <View style={styles.navigationContainer}>
        <TouchableOpacity
          style={[styles.navButton, currentQuestionIndex === 0 && { opacity: 0.5 }]}
          onPress={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
          disabled={currentQuestionIndex === 0}
        >
          <Ionicons name="arrow-back" size={18} color="#4B5563" style={{ marginRight: 6 }} />
          <Text style={styles.navButtonText}>Previous</Text>
        </TouchableOpacity>

        {!isLastQuestion ? (
          <>
            <TouchableOpacity
              // Advancing used to be unconditional, so a student could walk the
              // whole quiz without answering anything and be graded on blanks.
              style={[
                styles.navButton,
                styles.nextButton,
                !canAdvance && styles.navButtonDisabled,
              ]}
              onPress={() => setCurrentQuestionIndex(prev => prev + 1)}
              disabled={!canAdvance}
              activeOpacity={canAdvance ? 0.8 : 1}
            >
              <Text style={[styles.navButtonText, { color: 'white' }]}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color="white" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.navButton, styles.submitButton, !canAdvance && styles.navButtonDisabled]}
            onPress={handleSubmitQuiz}
            disabled={!canAdvance}
            activeOpacity={canAdvance ? 0.8 : 1}
          >
            <Text style={[styles.navButtonText, styles.submitButtonText]}>Submit Quiz</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Why the button is dead, instead of leaving it to be guessed at. */}
      {!canAdvance && (
        <View style={styles.hintBar} pointerEvents="none">
          <Ionicons name="information-circle-outline" size={14} color="#6D28D9" />
          <Text style={styles.hintText}>
            {currentQuestion.type === 'Multiple Choice' || currentQuestion.type === 'True/False'
              ? 'Pick an answer to continue'
              : 'Type an answer to continue'}
          </Text>
        </View>
      )}

      {/* Results + review. Full screen rather than a centred card: a 50-question
          quiz does not fit in a dialog, and the review is the point of the
          screen. */}
      <Modal visible={showResults} animationType="slide">
        <View style={styles.resultsScreen}>
          <LinearGradient colors={['#6D28D9', '#4F46E5']} style={styles.resultsHero}>
            <View style={styles.resultsHeroTop}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleFinish}
                disabled={isFinishing}
                accessibilityLabel="Close results"
              >
                {isFinishing
                  ? <ActivityIndicator color="white" />
                  : <Ionicons name="close" size={24} color="white" />}
              </TouchableOpacity>
              <Text style={styles.resultsHeroTitle} numberOfLines={1}>{quizTitle}</Text>
              <View style={styles.closeButton} />
            </View>

            <View style={styles.resultsScoreRow}>
              <View style={styles.scoreCircle}>
                <Text style={styles.scoreText}>{score}</Text>
                <Text style={styles.scoreTotal}>/ {answers.length}</Text>
              </View>
              <View style={styles.resultsScoreText}>
                <Text style={styles.resultsTitle}>
                  {score !== null && score / answers.length >= 0.7 ? 'Great Job!' : 'Keep Practicing!'}
                </Text>
                <Text style={styles.resultsPercent}>
                  {Math.round(((score ?? 0) / answers.length) * 100)}% score
                </Text>
                <Text style={styles.resultsSubtitle}>
                  {answers.length - missedCount} right, {missedCount} to review
                </Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.reviewHeader}>
            <Text style={styles.reviewHeading}>
              {missedOnly ? 'What you missed' : 'Answer review'}
            </Text>
            <TouchableOpacity
              style={[styles.filterChip, missedOnly && styles.filterChipActive]}
              onPress={() => setMissedOnly(prev => !prev)}
            >
              <Ionicons
                name={missedOnly ? 'eye-outline' : 'eye-off-outline'}
                size={13}
                color={missedOnly ? '#FFFFFF' : '#6D28D9'}
              />
              <Text style={[styles.filterChipText, missedOnly && styles.filterChipTextActive]}>
                {missedOnly ? 'Showing missed' : 'Showing all'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.reviewScroll}
            contentContainerStyle={styles.reviewContent}
            showsVerticalScrollIndicator={false}
          >
            {visibleReview.map((r, i) => (
              <View
                key={i}
                style={[styles.reviewRow, r.correct ? styles.reviewRowCorrect : styles.reviewRowWrong]}
              >
                <View style={styles.reviewRowTop}>
                  <View style={[styles.reviewBadge, r.correct ? styles.reviewBadgeCorrect : styles.reviewBadgeWrong]}>
                    <Ionicons
                      name={r.correct ? 'checkmark-circle' : 'close-circle'}
                      size={14}
                      color="#FFFFFF"
                    />
                  </View>
                  <Text style={styles.reviewVerdict}>{r.correct ? 'Correct' : 'Incorrect'}</Text>
                  <Text style={styles.reviewIndex}>#{i + 1}</Text>
                </View>

                <Text style={styles.reviewQuestion}>{r.question}</Text>

                <View style={styles.answerBlock}>
                  <Text style={styles.answerLabel}>Your answer</Text>
                  <Text style={[styles.answerValue, r.correct ? styles.answerRight : styles.answerWrong]}>
                    {r.yourAnswer ?? 'Not answered'}
                  </Text>
                </View>

                {!r.correct && (
                  <View style={styles.answerBlock}>
                    <Text style={styles.answerLabel}>Correct answer</Text>
                    <Text style={[styles.answerValue, styles.answerRight]}>{r.correctAnswer}</Text>
                  </View>
                )}

                {r.explanation ? (
                  <View style={styles.explanationBlock}>
                    <View style={styles.explanationHead}>
                      <Ionicons name="bulb-outline" size={13} color="#B45309" />
                      <Text style={styles.explanationLabel}>Why</Text>
                    </View>
                    <Text style={styles.explanationText}>{r.explanation}</Text>
                  </View>
                ) : (
                  <Text style={styles.noExplanation}>No explanation was provided for this question.</Text>
                )}
              </View>
            ))}
          </ScrollView>

          <View style={styles.resultsFooter}>
            <TouchableOpacity
              style={[styles.finishButton, isFinishing && { opacity: 0.7 }]}
              onPress={handleFinish}
              disabled={isFinishing}
            >
              {isFinishing ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.finishButtonText}>{reward ? 'Done' : 'Finish'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Animated.View>
    </KeyboardSafeView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 25,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerInfo: { flex: 1, alignItems: 'center' },
  headerIcon: { width: 32, alignItems: 'flex-end' },
  closeButton: { padding: 4, width: 32 },
  quizTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 10,
  },
  questionCounter: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
  progressContainer: { height: 4, backgroundColor: '#E2E8F0', width: '100%' },
  progressBarFill: { height: '100%', backgroundColor: '#10B981' },
  questionArea: { flex: 1, padding: 16 },
  questionContent: { paddingBottom: 40 },
  questionCard: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  questionText: {
    fontSize: 19,
    fontWeight: '600',
    color: '#1F2937',
    lineHeight: 28,
    marginBottom: 24,
  },
  optionsList: { gap: 12 },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 4,
  },
  optionButtonUnselected: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  optionButtonSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#4F46E5',
    borderWidth: 2,
  },
  optionPrefix: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optionPrefixUnselected: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  optionPrefixSelected: {
    backgroundColor: '#4F46E5',
  },
  optionPrefixText: { fontSize: 13, fontWeight: '700' },
  optionText: { flex: 1, fontSize: 15, lineHeight: 22 },
  optionTextUnselected: { color: '#4B5563' },
  optionTextSelected: { color: '#1E1B4B', fontWeight: '700' },
  tfContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  shortAnswerInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    color: '#1F2937',
  },
  navigationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    minWidth: 120,
    justifyContent: 'center',
  },
  nextButton: { backgroundColor: '#4F46E5' },
  navButtonDisabled: { backgroundColor: '#9CA3AF' },
  navButtonText: { fontSize: 15, fontWeight: '700', color: '#4B5563' },
  submitButton: { backgroundColor: '#10B981', flex: 1, marginLeft: 12 },
  submitButtonText: { color: 'white' },
  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 18,
    backgroundColor: '#F8FAFC',
  },
  hintText: { fontSize: 12, fontWeight: '600', color: '#6D28D9' },

  // ── Results ──
  resultsScreen: { flex: 1, backgroundColor: '#F1F5F9' },
  resultsHero: { paddingTop: 20, paddingBottom: 28, paddingHorizontal: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  resultsHeroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  resultsHeroTitle: { flex: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  resultsScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  resultsScoreText: { flex: 1 },
  scoreCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 6,
    borderColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  scoreText: { fontSize: 32, fontWeight: 'bold', color: '#FFFFFF' },
  scoreTotal: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginLeft: 3, marginTop: 8 },
  resultsTitle: { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 4 },
  resultsSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 6 },
  resultsPercent: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
  },
  reviewHeading: { fontSize: 16, fontWeight: '800', color: '#1F2937' },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  filterChipActive: { backgroundColor: '#6D28D9' },
  filterChipText: { fontSize: 11, fontWeight: '700', color: '#6D28D9' },
  filterChipTextActive: { color: '#FFFFFF' },

  reviewScroll: { flex: 1 },
  reviewContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  reviewRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  reviewRowCorrect: { borderLeftColor: '#10B981' },
  reviewRowWrong: { borderLeftColor: '#EF4444' },
  reviewRowTop: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  reviewBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reviewBadgeCorrect: { backgroundColor: '#10B981' },
  reviewBadgeWrong: { backgroundColor: '#EF4444' },
  reviewVerdict: { fontSize: 12, fontWeight: '800', color: '#4B5563' },
  reviewIndex: { marginLeft: 'auto', fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  reviewQuestion: { fontSize: 15, fontWeight: '600', color: '#1F2937', lineHeight: 21, marginBottom: 12 },
  answerBlock: { marginBottom: 8 },
  answerLabel: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 0.6, marginBottom: 3 },
  answerValue: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  answerRight: { color: '#059669' },
  answerWrong: { color: '#DC2626' },
  explanationBlock: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  explanationHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  explanationLabel: { fontSize: 10, fontWeight: '800', color: '#B45309', letterSpacing: 0.6 },
  explanationText: { fontSize: 13, color: '#78350F', lineHeight: 19 },
  noExplanation: { fontSize: 12, color: '#9CA3AF', fontStyle: 'italic', marginTop: 2 },

  resultsFooter: { padding: 20, paddingBottom: 28, backgroundColor: '#F1F5F9' },
  finishButton: {
    backgroundColor: '#6D28D9',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
  },
  finishButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});

export default TakeQuiz;
