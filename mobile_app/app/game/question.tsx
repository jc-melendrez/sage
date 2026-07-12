import { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
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
  const [standings, setStandings] = useState<{ id: string; displayName: string; score: number }[]>([]);
  const [timeLeft, setTimeLeft] = useState(15);
  const [timePerQuestion, setTimePerQuestion] = useState(15);
  const [userId, setUserId] = useState<number | null>(null);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());
  const standingsUnsubRef = useRef<(() => void) | null>(null);
  

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

    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        const sorted = snap.docs
          .map(d => ({ id: d.id, displayName: d.data().displayName, score: d.data().score || 0 }))
          .sort((a, b) => b.score - a.score);
        setStandings(sorted);
      });
    standingsUnsubRef.current = unsub;

    return () => { unsub(); };
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

  if (result) {
    return (
      <View style={styles.resultContainer}>
        <View style={styles.resultTop}>
          <Text style={styles.resultBigIcon}>{result.correct ? '✅' : '❌'}</Text>
          <Text style={styles.resultBigText}>{result.correct ? 'Correct!' : 'Wrong!'}</Text>
          {result.correct && <Text style={styles.resultPoints}>+{result.points} pts</Text>}
        </View>

        <View style={styles.resultLeaderboard}>
          <Text style={styles.standingsTitle}>Standings</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {standings.map((p, i) => (
              <View key={p.id} style={styles.standingsRow}>
                <Text style={styles.standingsRank}>{i + 1}.</Text>
                <Text
                  style={[
                    styles.standingsName,
                    String(p.id) === String(userId) && styles.standingsYou,
                  ]}
                >
                  {p.displayName}{String(p.id) === String(userId) ? ' (You)' : ''}
                </Text>
                <Text style={styles.standingsScore}>{p.score}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <TouchableOpacity style={styles.nextBtnFull} onPress={handleNext}>
          <Text style={styles.nextBtnText}>
            {currentIndex + 1 >= questionOrder.length ? 'Finish' : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.progress}>{currentIndex + 1} / {questionOrder.length}</Text>
        <View style={[styles.timerBadge, timeLeft <= 5 && { backgroundColor: '#e53e3e' }]}>
          <Text style={styles.timerText}>{timeLeft}s</Text>
        </View>
      </View>

      <Text style={styles.question}>{question.question}</Text>

      {question.choices.map((choice: string) => (
        <TouchableOpacity
          key={choice}
          style={[styles.choice, { backgroundColor: choice === selected ? '#7F77DD' : '#1e1b4b' }]}
          onPress={() => handleAnswer(choice)}
          disabled={!!selected}
        >
          <Text style={styles.choiceText}>{choice}</Text>
        </TouchableOpacity>
      ))}
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
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  resultContainer: {
    flex: 1,
    backgroundColor: '#0f0c29',
    padding: 24,
    paddingTop: 60,
    justifyContent: 'space-between',
  },
  resultTop: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resultBigIcon: {
    fontSize: 56,
    marginBottom: 8,
  },
  resultBigText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  resultPoints: {
    color: '#7F77DD',
    fontSize: 18,
    fontWeight: '700',
  },
  resultLeaderboard: {
    flex: 1,
    backgroundColor: '#1e1b4b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  nextBtnFull: {
    backgroundColor: '#7F77DD',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },

  standingsTitle: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  standingsRank: {
    color: '#94A3B8',
    width: 24,
    fontSize: 14,
    fontWeight: '700',
  },
  standingsName: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
  },
  standingsYou: {
    color: '#7F77DD',
    fontWeight: '700',
  },
  standingsScore: {
    color: '#7F77DD',
    fontSize: 14,
    fontWeight: '700',
  },
});