import { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';

export default function QuestionScreen() {
  const router = useRouter();
  const { roomCode } = useLocalSearchParams<{ roomCode: string }>();
  const [questions, setQuestions] = useState<any[]>([]);
  const [questionOrder, setQuestionOrder] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string; points: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [timePerQuestion, setTimePerQuestion] = useState(15);
  const [userId, setUserId] = useState<number | null>(null);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const init = async () => {
      const user = await getCurrentUser();
      setUserId(user?.id);

      const room = await firestore().collection('gameRooms').doc(roomCode).get();
      const data = room.data();
      setQuestions(data?.questions || []);
      setTimePerQuestion(data?.timePerQuestion || 15);
      setTimeLeft(data?.timePerQuestion || 15);

      const player = await firestore().collection('gameRooms').doc(roomCode)
        .collection('players').doc(String(user?.id)).get();
      setQuestionOrder(player.data()?.questionOrder || []);
    };
    init();
  }, []);

  useEffect(() => {
    if (questions.length === 0) return;
    startTimeRef.current = Date.now();
    setTimeLeft(timePerQuestion);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (!selected) handleAnswer(null);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [currentIndex, questions]);

  const handleAnswer = async (answer: string | null) => {
    if (selected) return;
    clearInterval(timerRef.current);
    setSelected(answer || '');
    const timeTaken = (Date.now() - startTimeRef.current) / 1000;
    const actualIndex = questionOrder[currentIndex];

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/answer/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode, questionIndex: actualIndex, answer: answer || '', timeTaken }),
      });
      const data = await res.json();
      setResult({ correct: data.correct, correctAnswer: data.correctAnswer, points: data.pointsAwarded });
    } catch (e) {
      console.error(e);
    }
  };

  const handleNext = async () => {
    if (currentIndex + 1 >= questionOrder.length) {
      // Done — finish game
      const token = await getToken();
      await fetch(`${API_BASE_URL}/game/finish/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode }),
      });
      router.replace({ pathname: '/game/final', params: { roomCode } });
      return;
    }
    setCurrentIndex(i => i + 1);
    setSelected(null);
    setResult(null);
  };

  if (questions.length === 0 || questionOrder.length === 0) {
    return <View style={styles.container}><Text style={styles.title}>Loading questions...</Text></View>;
  }

  const actualIndex = questionOrder[currentIndex];
  const question = questions[actualIndex];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.progress}>{currentIndex + 1} / {questionOrder.length}</Text>
        <View style={[styles.timerBadge, timeLeft <= 5 && { backgroundColor: '#e53e3e' }]}>
          <Text style={styles.timerText}>{timeLeft}s</Text>
        </View>
      </View>

      <Text style={styles.question}>{question.question}</Text>

      {question.choices.map((choice: string) => {
        let bg = '#1e1b4b';
        if (result) {
          if (choice === result.correctAnswer) bg = '#1D9E75';
          else if (choice === selected) bg = '#e53e3e';
        } else if (choice === selected) bg = '#7F77DD';

        return (
          <TouchableOpacity
            key={choice}
            style={[styles.choice, { backgroundColor: bg }]}
            onPress={() => handleAnswer(choice)}
            disabled={!!selected}
          >
            <Text style={styles.choiceText}>{choice}</Text>
          </TouchableOpacity>
        );
      })}

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{result.correct ? '✅ Correct!' : '❌ Wrong!'}</Text>
          {result.correct && <Text style={styles.points}>+{result.points} pts</Text>}
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>{currentIndex + 1 >= questionOrder.length ? 'Finish' : 'Next →'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0c29', padding: 24, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  progress: { color: '#aaa', fontSize: 16 },
  timerBadge: { backgroundColor: '#7F77DD', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  timerText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  question: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 28, lineHeight: 28 },
  choice: { borderRadius: 12, padding: 16, marginBottom: 12 },
  choiceText: { color: '#fff', fontSize: 16 },
  resultBox: { marginTop: 16, alignItems: 'center' },
  resultText: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  points: { color: '#7F77DD', fontSize: 16, marginBottom: 12 },
  nextBtn: { backgroundColor: '#7F77DD', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});