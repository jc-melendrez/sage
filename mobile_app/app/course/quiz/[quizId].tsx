import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getQuiz, Quiz, startQuizAttempt } from '@/services/quizService';
import { completeQuiz } from '@/services/gamificationService';
import TakeQuiz from '../../../components/TakeQuiz';

export default function CourseQuizScreen() {
  const router = useRouter();
  const { quizId, courseId } = useLocalSearchParams<{ quizId: string; courseId?: string }>();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [closed, setClosed] = useState<string | null>(null);
  const [alreadyTaken, setAlreadyTaken] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getQuiz(Number(quizId));
        if (!active) return;

        if (data.attempted) {
          setAlreadyTaken(true);
        } else if (data.available_until && new Date(data.available_until).getTime() <= Date.now()) {
          setClosed(`This quiz closed on ${new Date(data.available_until).toLocaleString()}.`);
        } else {
          setQuiz(data);
        }
      } catch {
        Alert.alert('Failed to load quiz', 'Please try again.');
        if (active) router.back();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [quizId, router]);

  const handleBegin = async () => {
    if (!quiz) return;
    setStarting(true);
    try {
      await startQuizAttempt(quiz.id);
      setStarted(true);
    } catch (err) {
      Alert.alert(
        'Cannot take quiz',
        err instanceof Error ? err.message : 'This quiz is no longer available.',
      );
      router.back();
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6D28D9" />
      </View>
    );
  }

  if (closed || alreadyTaken) {
    return (
      <View style={styles.center}>
        <View style={styles.blockedCard}>
          <View style={styles.blockedIconCircle}>
            <Ionicons name={alreadyTaken ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={40} color={alreadyTaken ? '#10B981' : '#F59E0B'} />
          </View>
          <Text style={styles.blockedTitle}>
            {alreadyTaken ? 'Already Taken' : 'Quiz Closed'}
          </Text>
          <Text style={styles.blockedText}>
            {alreadyTaken
              ? 'You already took this quiz. Each quiz can only be taken once.'
              : closed}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!quiz) return null;

  if (!started) {
    return (
      <View style={styles.center}>
        <View style={styles.blockedCard}>
          <View style={styles.blockedIconCircle}>
            <Ionicons name="document-text-outline" size={40} color="#6D28D9" />
          </View>
          <Text style={styles.blockedTitle}>{quiz.title}</Text>
          <Text style={styles.blockedText}>
            {quiz.questions.length} questions
            {quiz.available_until
              ? ` · closes ${new Date(quiz.available_until).toLocaleString()}`
              : ''}
          </Text>
          <Text style={styles.takeOnceNote}>
            You can only take this quiz once — make it count.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, starting && { opacity: 0.6 }]}
            onPress={handleBegin}
            disabled={starting}
          >
            {starting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryBtnText}>Begin Quiz</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const questions = quiz.questions.map((q) => ({
    id: q.id,
    question: q.question_text,
    type: (quiz.quiz_type || 'Multiple Choice') as any,
    options: q.options,
    correct_answer: q.correct_answer,
  }));

  return (
    <TakeQuiz
      quizTitle={quiz.title}
      questions={questions}
      onFinish={async (score) => {
        const result = await completeQuiz(
          score,
          questions.length,
          courseId ? Number(courseId) : undefined,
          quiz.id,
        );
        return { xp: result.xp, badges: result.badges };
      }}
      onClose={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', padding: 24 },
  blockedCard: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  blockedIcon: { fontSize: 44, marginBottom: 12 },
  blockedIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  blockedTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', textAlign: 'center', marginBottom: 8 },
  blockedText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  takeOnceNote: {
    fontSize: 13,
    color: '#B45309',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 14,
    marginBottom: 4,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#6D28D9',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    alignSelf: 'stretch',
    minHeight: 48,
  },
  primaryBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});