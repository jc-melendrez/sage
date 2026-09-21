import { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getQuiz, Quiz } from '@/services/quizService';
import { completeQuiz } from '@/services/gamificationService';
import TakeQuiz from '../../../components/TakeQuiz';

export default function CourseQuizScreen() {
  const router = useRouter();
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getQuiz(Number(quizId));
        if (active) setQuiz(data);
      } catch {
        Alert.alert('Failed to load quiz', 'Please try again.');
        if (active) router.back();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [quizId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6D28D9" />
      </View>
    );
  }

  if (!quiz) return null;

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
        const result = await completeQuiz(score, questions.length);
        return { xp: result.xp, badges: result.badges };
      }}
      onClose={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' },
});