import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// Define a basic interface for a quiz question
interface QuizQuestion {
  id: number;
  question: string;
  type: 'Multiple Choice' | 'True/False' | 'Short Answer' | 'Fill-in-the-Blank';
  options?: string[]; // For Multiple Choice
  correct_answer?: string; // For validation (optional for this template)
}

export interface QuizRewardInfo {
  xp: number;
  badges: { icon: string; name: string }[];
}

interface TakeQuizProps {
  quizTitle: string;
  questions: QuizQuestion[];
  /** May be async and return reward info (XP/badges) to display in the results view. */
  onFinish: (score: number) => QuizRewardInfo | void | Promise<QuizRewardInfo | void>;
  onClose: () => void; // Callback to close the quiz
}

const TakeQuiz: React.FC<TakeQuizProps> = ({ quizTitle, questions, onFinish, onClose }) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<{ [key: number]: string | string[] }>({});
  const [score, setScore] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [reward, setReward] = useState<QuizRewardInfo | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  if (!questions || questions.length === 0) return null;

  const currentQuestion = questions[currentQuestionIndex] || questions[0];
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  const getOptionLabel = (index: number) => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    return labels[index] || '';
  };

  const handleAnswer = (questionId: number, answer: string | string[]) => {
    setUserAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

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
                  userAnswers[currentQuestion.id] === option ? styles.optionButtonSelected : styles.optionButtonUnselected,
                ]}
                onPress={() => handleAnswer(currentQuestion.id, option)}
              >
                <View style={[
                  styles.optionPrefix,
                  userAnswers[currentQuestion.id] === option ? styles.optionPrefixSelected : styles.optionPrefixUnselected
                ]}>
                  <Text style={[
                    styles.optionPrefixText,
                    userAnswers[currentQuestion.id] === option ? { color: 'white' } : { color: '#6D28D9' }
                  ]}>
                    {getOptionLabel(index)}
                  </Text>
                </View>
                <Text style={[
                  styles.optionText,
                  userAnswers[currentQuestion.id] === option ? styles.optionTextSelected : styles.optionTextUnselected,
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
                  userAnswers[currentQuestion.id] === option && styles.optionButtonSelected,
                ]}
                onPress={() => handleAnswer(currentQuestion.id, option)}
              >
                <Text style={[
                  styles.optionText,
                  userAnswers[currentQuestion.id] === option && styles.optionTextSelected,
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
            value={userAnswers[currentQuestion.id] as string || ''}
            onChangeText={(text) => handleAnswer(currentQuestion.id, text)}
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
            value={userAnswers[currentQuestion.id] as string || ''}
            onChangeText={(text) => handleAnswer(currentQuestion.id, text)}
          />
        );
      default:
        return <Text>Unsupported question type.</Text>;
    }
  };

  const handleSubmitQuiz = () => {
    let correctCount = 0;

    questions.forEach((q) => {
      const userAnswer = userAnswers[q.id];
      const correctAnswer = q.correct_answer;

      if (!userAnswer || !correctAnswer) return;

      if (typeof userAnswer === 'string' && typeof correctAnswer === 'string') {
        // Case-insensitive trim comparison for text/short answer/multiple choice
        if (userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase()) {
          correctCount++;
        }
      }
    });

    setScore(correctCount);
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
      const result = await onFinish(score);
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

  return (
    <View style={styles.container}>
      {/* Modern Gradient Header */}
      <LinearGradient colors={['#6D28D9', '#4F46E5']} style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={28} color="white" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.quizTitle} numberOfLines={1}>{quizTitle}</Text>
          <Text style={styles.questionCounter}>Question {currentQuestionIndex + 1} of {questions.length}</Text>
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

        {currentQuestionIndex < questions.length - 1 ? (
          <TouchableOpacity
            style={[styles.navButton, styles.nextButton]}
            onPress={() => setCurrentQuestionIndex(prev => prev + 1)}
          >
            <Text style={[styles.navButtonText, { color: 'white' }]}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="white" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.navButton, styles.submitButton]}
            onPress={handleSubmitQuiz}
          >
            <Text style={[styles.navButtonText, styles.submitButtonText]}>Submit Quiz</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Results Modal */}
      <Modal visible={showResults} transparent animationType="fade">
        <View style={styles.resultsOverlay}>
          <LinearGradient colors={['#FFFFFF', '#F1F5F9']} style={styles.resultsCard}>
            <View style={styles.resultsHeader}>
              <View style={[styles.scoreCircle, { borderColor: score !== null && score / questions.length >= 0.7 ? '#10B981' : '#F59E0B' }]}>
                <Text style={styles.scoreText}>{score}</Text>
                <Text style={styles.scoreTotal}>/ {questions.length}</Text>
              </View>
              <Text style={styles.resultsTitle}>
                {score !== null && score / questions.length >= 0.7 ? 'Great Job!' : 'Keep Practicing!'}
              </Text>
              <Text style={styles.resultsSubtitle}>
                You&apos;ve completed the &quot;{quizTitle}&quot; quiz.
              </Text>

              {score !== null && (
                <Text style={styles.resultsPercent}>
                  {Math.round((score / questions.length) * 100)}% score
                </Text>
              )}

              {reward && reward.xp > 0 && (
                <View style={styles.xpRow}>
                  <Ionicons name="flash" size={16} color="#F59E0B" />
                  <Text style={styles.xpText}>+{reward.xp} XP earned</Text>
                </View>
              )}

              {reward && reward.badges.length > 0 && (
                <View style={styles.badgesRow}>
                  {reward.badges.map(b => (
                    <View key={b.name} style={styles.badgeChip}>
                      <Text style={styles.badgeChipText}>{b.icon} {b.name}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

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
          </LinearGradient>
        </View>
      </Modal>
    </View>
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
    paddingBottom: 34,
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
  navButtonText: { fontSize: 15, fontWeight: '700', color: '#4B5563' },
  submitButton: { backgroundColor: '#10B981', flex: 1, marginLeft: 12 },
  submitButtonText: { color: 'white' },
  resultsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  resultsCard: {
    width: '100%',
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
    elevation: 10,
  },
  resultsHeader: { alignItems: 'center', marginBottom: 32 },
  scoreCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    flexDirection: 'row',
  },
  scoreText: { fontSize: 38, fontWeight: 'bold', color: '#1F2937' },
  scoreTotal: { fontSize: 18, color: '#6B7280', marginLeft: 4, marginTop: 10 },
  resultsTitle: { fontSize: 24, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  resultsSubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  resultsPercent: { fontSize: 15, fontWeight: '700', color: '#6D28D9', marginTop: 8 },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  xpText: { fontSize: 13, fontWeight: '700', color: '#B45309' },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center' },
  badgeChip: {
    backgroundColor: 'rgba(109, 40, 217, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(109, 40, 217, 0.2)',
  },
  badgeChipText: { fontSize: 12, fontWeight: '600', color: '#6D28D9' },
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