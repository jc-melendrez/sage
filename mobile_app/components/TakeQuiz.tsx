import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
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
  /**
   * The question's options as presented, so the detail view can show every
   * choice with the student's pick and the right one both marked. Only present
   * for choice questions.
   */
  options?: string[];
  /** 1-based position, for the numbered grid. */
  number: number;
  /** `A`/`B`/... for choice questions, null for typed answers. */
  yourLabel: string | null;
  correctLabel: string | null;
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
  /**
   * Called when recording the result fails, so the screen can tell the student
   * instead of closing and implying the attempt was saved. The quiz stays open
   * when this fires.
   */
  onFinishError?: (message: string) => void;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const TakeQuiz: React.FC<TakeQuizProps> = ({ quizTitle, questions, onFinish, onClose, onFinishError }) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Keyed by array index, not by question id. Ids come from the database, but
  // the response from a generation call echoes the ids the model invented, and
  // a collision there would silently overwrite one answer with another.
  const [userAnswers, setUserAnswers] = useState<{ [key: number]: string | string[] }>({});
  const [score, setScore] = useState<number | null>(null);
  const [review, setReview] = useState<TakeQuizResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  // Index into `review` of the question whose detail is open, or null.
  const [openQuestion, setOpenQuestion] = useState<number | null>(null);

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

  /** The option letter for a value, or null when it is not one of the options. */
  const labelFor = (value: string, options?: string[]): string | null => {
    if (!options?.length) return null;
    const index = options.findIndex(o => o === value);
    return index === -1 ? null : getOptionLabel(index);
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
        options: q.options?.length ? q.options : undefined,
        number: index + 1,
        yourLabel: labelFor(yourAnswer, q.options),
        correctLabel: labelFor(correctAnswer, q.options),
      };
    });

    setScore(correctCount);
    setReview(results);
    setShowResults(true);
  };

  /**
   * Close first, save second.
   *
   * The screen used to await onFinish before doing anything visible, so pressing
   * Finish looked like a hang for the length of a network round trip -- and the
   * results overlay then sat there with the button relabelled "Close", needing a
   * second tap to leave. Dismissing immediately and letting the save finish in
   * the background is what "it should be instant" actually requires; the XP
   * lands on the refreshed Quizzes tab instead of on a screen we have already
   * left.
   *
   * The ref is what makes the background save safe: the component unmounts on
   * close, so state updates after the await would be wasted, and a second press
   * during that window would fire a duplicate POST.
   */
  const submittingRef = useRef(false);

  const handleFinish = async () => {
    if (score === null || submittingRef.current) return;
    submittingRef.current = true;
    onClose();
    try {
      await onFinish(score, review);
    } catch (err: any) {
      // The quiz is already closed, so this cannot be "kept open" for a retry.
      // Reporting it is the honest thing to do: swallowing it would leave the
      // student believing an attempt was saved when it was not.
      console.error('Failed to record quiz result:', err);
      onFinishError?.(err?.message || 'Could not save your result.');
    }
  };

  const missedCount = useMemo(() => review.filter((r) => !r.correct).length, [review]);
  const openResult = openQuestion != null ? review[openQuestion] ?? null : null;

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
          <Text style={[styles.navButtonText, styles.submitButtonText]}>Finish</Text>
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

      {/* Results. An in-tree overlay, NOT a <Modal>. This component is already
          rendered inside the parent <Modal> that hosts the quiz, and Android
          silently drops a second Modal stacked on another -- which is what
          made the review unreachable from here. */}
      {showResults && (
        <View style={styles.resultsOverlay}>
          <View style={styles.resultsScreen}>
            <LinearGradient colors={['#6D28D9', '#4F46E5']} style={styles.resultsHero}>
              <View style={styles.resultsHeroTop}>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={handleFinish}
                  accessibilityLabel="Close results"
                >
                  <Ionicons name="close" size={24} color="white" />
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

            {/* Numbered grid. Tapping a number opens that question in full, so a
                50-question quiz stays scannable instead of becoming 50 cards. */}
            <View style={styles.gridHeader}>
              <Text style={styles.reviewHeading}>Your answers</Text>
              <Text style={styles.gridHint}>Tap a number to see the question</Text>
            </View>

            <ScrollView
              style={styles.reviewScroll}
              contentContainerStyle={styles.reviewContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.grid}>
                {review.map((r, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.gridCell, r.correct ? styles.gridCellRight : styles.gridCellWrong]}
                    onPress={() => setOpenQuestion(i)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      r.correct
                        ? `Question ${r.number}, correct`
                        : `Question ${r.number}, you answered ${r.yourLabel ?? r.yourAnswer ?? 'nothing'}, correct was ${r.correctLabel ?? r.correctAnswer}`
                    }
                  >
                    <Text style={styles.gridNumber}>{r.number}</Text>
                    {!r.correct && (
                      <View style={styles.gridLetterRow}>
                        <Text style={styles.gridLetter}>
                          {r.yourLabel ?? '—'}
                        </Text>
                        <Ionicons name="arrow-forward" size={9} color="#FECACA" />
                        <Text style={[styles.gridLetter, styles.gridLetterRight]}>
                          {r.correctLabel ?? '?'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.resultsFooter}>
              <TouchableOpacity
                style={styles.finishButton}
                onPress={handleFinish}
                accessibilityLabel="Finish and save"
              >
                <Text style={styles.finishButtonText}>
                  Finish
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Per-question detail. Also in-tree: a third stacked Modal is even
              less reliable on Android than the second one was. */}
          {openResult && (
            <View style={styles.detailBackdrop}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setOpenQuestion(null)}
                accessibilityLabel="Close question"
              />
              <View style={styles.detailCard}>
                <View style={styles.detailHead}>
                  <View style={[
                    styles.detailBadge,
                    openResult.correct ? styles.gridCellRight : styles.gridCellWrong,
                  ]}>
                    <Text style={styles.detailBadgeText}>
                      {openResult.correct ? 'Correct' : 'Incorrect'}
                    </Text>
                  </View>
                  <Text style={styles.detailNumber}>Question {openResult.number}</Text>
                  <TouchableOpacity
                    onPress={() => setOpenQuestion(null)}
                    hitSlop={12}
                    accessibilityLabel="Close"
                  >
                    <Ionicons name="close-circle" size={28} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
                  <Text style={styles.detailQuestion}>{openResult.question}</Text>

                  {openResult.options?.length ? (
                    <View style={styles.detailOptions}>
                      {openResult.options.map((option, index) => {
                        const letter = getOptionLabel(index);
                        const isYours = option === openResult.yourAnswer;
                        const isRight = option === openResult.correctAnswer;
                        return (
                          <View
                            key={index}
                            style={[
                              styles.detailOption,
                              isRight && styles.detailOptionRight,
                              isYours && !isRight && styles.detailOptionWrong,
                              isYours && isRight && styles.detailOptionRight,
                            ]}
                          >
                            <View style={[
                              styles.detailOptionPrefix,
                              isRight && styles.detailOptionPrefixRight,
                              isYours && !isRight && styles.detailOptionPrefixWrong,
                            ]}>
                              <Text style={[
                                styles.detailOptionPrefixText,
                                (isRight || isYours) && { color: '#FFFFFF' },
                              ]}>
                                {letter}
                              </Text>
                            </View>
                            <Text style={styles.detailOptionText}>{option}</Text>
                            {isRight && (
                              <Text style={styles.detailOptionTag}>correct</Text>
                            )}
                            {isYours && !isRight && (
                              <Text style={styles.detailOptionTagWrong}>yours</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.detailAnswers}>
                      <View style={styles.detailAnswerBlock}>
                        <Text style={styles.answerLabel}>Your answer</Text>
                        <Text style={[
                          styles.answerValue,
                          openResult.correct ? styles.answerRight : styles.answerWrong,
                        ]}>
                          {openResult.yourAnswer ?? 'Not answered'}
                        </Text>
                      </View>
                      {!openResult.correct && (
                        <View style={styles.detailAnswerBlock}>
                          <Text style={styles.answerLabel}>Correct answer</Text>
                          <Text style={[styles.answerValue, styles.answerRight]}>
                            {openResult.correctAnswer}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {openResult.explanation ? (
                    <View style={styles.explanationBlock}>
                      <View style={styles.explanationHead}>
                        <Ionicons name="bulb-outline" size={13} color="#B45309" />
                        <Text style={styles.explanationLabel}>Why</Text>
                      </View>
                      <Text style={styles.explanationText}>{openResult.explanation}</Text>
                    </View>
                  ) : (
                    <Text style={styles.noExplanation}>
                      No explanation was provided for this question.
                    </Text>
                  )}
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      )}
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
  // Absolutely positioned over the quiz rather than a <Modal>, so it is not a
  // second Modal stacked on the one already hosting this component.
  resultsOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#F1F5F9', zIndex: 20 },
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

  gridHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  reviewHeading: { fontSize: 16, fontWeight: '800', color: '#1F2937' },
  gridHint: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  reviewScroll: { flex: 1 },
  reviewContent: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: {
    width: 62,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  gridCellRight: { backgroundColor: '#DCFCE7', borderColor: '#10B981' },
  gridCellWrong: { backgroundColor: '#FEE2E2', borderColor: '#EF4444' },
  gridNumber: { fontSize: 15, fontWeight: '800', color: '#1F2937' },
  gridLetterRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  gridLetter: { fontSize: 10, fontWeight: '800', color: '#B91C1C' },
  gridLetterRight: { color: '#15803D' },

  // ── per-question detail ──
  detailBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.72)', justifyContent: 'center', padding: 20, zIndex: 30 },
  detailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    maxHeight: '80%',
  },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  detailBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5 },
  detailBadgeText: { fontSize: 11, fontWeight: '800', color: '#1F2937' },
  detailNumber: { flex: 1, fontSize: 13, fontWeight: '700', color: '#6B7280' },
  detailScroll: { flexGrow: 0 },
  detailQuestion: { fontSize: 16, fontWeight: '700', color: '#1F2937', lineHeight: 23, marginBottom: 14 },
  detailOptions: { gap: 8 },
  detailOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  detailOptionRight: { backgroundColor: '#DCFCE7', borderColor: '#10B981' },
  detailOptionWrong: { backgroundColor: '#FEE2E2', borderColor: '#EF4444' },
  detailOptionPrefix: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1',
  },
  detailOptionPrefixRight: { backgroundColor: '#10B981', borderColor: '#10B981' },
  detailOptionPrefixWrong: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  detailOptionPrefixText: { fontSize: 12, fontWeight: '800', color: '#4B5563' },
  detailOptionText: { flex: 1, fontSize: 14, color: '#1F2937', lineHeight: 19 },
  detailOptionTag: { fontSize: 10, fontWeight: '800', color: '#15803D' },
  detailOptionTagWrong: { fontSize: 10, fontWeight: '800', color: '#B91C1C' },
  detailAnswers: { gap: 4 },
  detailAnswerBlock: { marginBottom: 8 },
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
