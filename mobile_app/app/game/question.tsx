import { useEffect, useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Animated } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';

function StandingsRow({ player, index, isYou }: { player: any; index: number; isYou: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(player.prevScore)).current;
  const [displayScore, setDisplayScore] = useState(player.prevScore);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 280, delay: index * 90, useNativeDriver: true }).start();
    Animated.timing(scoreAnim, { toValue: player.score, duration: 500, delay: index * 90 + 150, useNativeDriver: false }).start();
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    return () => scoreAnim.removeListener(id);
  }, []);

  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : null;

  return (
    <Animated.View
      style={[
        styles.standingsRow,
        index < 3 && styles.standingsRowTop3,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
      ]}
    >
      <Text style={styles.standingsRank}>{medal || `${index + 1}.`}</Text>
      <Text style={[styles.standingsName, isYou && styles.standingsYou]}>
        {player.displayName}{isYou ? ' (You)' : ''}
      </Text>
      {player.streak >= 3 && <Text style={styles.streakBadge}>🔥{player.streak}</Text>}
      {player.movement > 0 && <Text style={styles.moveUp}>▲{player.movement}</Text>}
      {player.movement < 0 && <Text style={styles.moveDown}>▼{Math.abs(player.movement)}</Text>}
      <Text style={styles.standingsScore}>{displayScore}</Text>
    </Animated.View>
  );
}

export default function QuestionScreen() {
  const router = useRouter();
  const { roomCode } = useLocalSearchParams<{ roomCode: string }>();
  const [questions, setQuestions] = useState<any[]>([]);
  const [questionOrder, setQuestionOrder] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string; points: number } | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [boxChars, setBoxChars] = useState<string[]>([]);
  const [wordLengths, setWordLengths] = useState<number[]>([]);
  const boxRefs = useRef<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [biggestMover, setBiggestMover] = useState<{ name: string; jump: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [timePerQuestion, setTimePerQuestion] = useState(15);
  const [userId, setUserId] = useState<number | null>(null);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());
  const standingsUnsubRef = useRef<(() => void) | null>(null);
  const previousStateRef = useRef<{ [id: string]: { rank: number; score: number } }>({});
  

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
          .map(d => ({
            id: d.id,
            displayName: d.data().displayName,
            score: d.data().score || 0,
            streak: d.data().streak || 0,
          }))
          .sort((a, b) => b.score - a.score);

        const withMovement = sorted.map((p, i) => {
          const prev = previousStateRef.current[p.id];
          return {
            ...p,
            movement: prev ? prev.rank - i : 0,
            prevScore: prev ? prev.score : p.score,
          };
        });
        previousStateRef.current = Object.fromEntries(
          withMovement.map((p, i) => [p.id, { rank: i, score: p.score }])
        );

        const top = withMovement.filter(p => p.movement >= 2).sort((a, b) => b.movement - a.movement)[0];
        setBiggestMover(top ? { name: String(top.id) === String(userId) ? 'You' : top.displayName, jump: top.movement } : null);

        setStandings(withMovement);
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

  useEffect(() => {
    if (question?.type === 'identification') {
      const words = question.correctAnswer.trim().split(/\s+/);
      setWordLengths(words.map((w: string) => w.length));
      setBoxChars(Array(words.join('').length).fill(''));
      boxRefs.current = [];
    }
  }, [currentIndex, questions]);

  const joinWithSpaces = (chars: string[]) => {
    let result = '';
    let i = 0;
    wordLengths.forEach((len, wi) => {
      result += chars.slice(i, i + len).join('');
      i += len;
      if (wi < wordLengths.length - 1) result += ' ';
    });
    return result;
  };

  const handleBoxChange = (text: string, index: number) => {
    const char = text.slice(-1);
    const next = [...boxChars];
    next[index] = char;
    setBoxChars(next);

    if (char && index < boxChars.length - 1) {
      boxRefs.current[index + 1]?.focus();
    }
    if (next.every(c => c)) {
      setTypedAnswer(joinWithSpaces(next));
    }
  };

  const handleBoxKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !boxChars[index] && index > 0) {
      boxRefs.current[index - 1]?.focus();
    }
  };

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
    setTypedAnswer('');
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

        {biggestMover && <Text style={styles.moverBanner}>🚀 {biggestMover.name} jumped {biggestMover.jump} spots!</Text>}
        <View style={styles.resultLeaderboard}>
          <Text style={styles.standingsTitle}>Standings</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {standings.map((p, i) => (
              <StandingsRow key={p.id} player={p} index={i} isYou={String(p.id) === String(userId)} />
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

      {question.type === 'identification' ? (
        <View>
          <View style={styles.boxRow}>
            {(() => {
              let idx = 0;
              return wordLengths.map((len, wi) => {
                const group = boxChars.slice(idx, idx + len).map((char, j) => {
                  const globalIndex = idx + j;
                  return (
                    <TextInput
                      key={globalIndex}
                      ref={(r) => { boxRefs.current[globalIndex] = r; }}
                      style={styles.charBox}
                      value={char}
                      onChangeText={(t) => handleBoxChange(t, globalIndex)}
                      onKeyPress={(e) => handleBoxKeyPress(e, globalIndex)}
                      maxLength={1}
                      editable={!selected}
                      autoCapitalize="characters"
                    />
                  );
                });
                idx += len;
                return <View key={wi} style={styles.wordGroup}>{group}</View>;
              });
            })()}
          </View>
          <TouchableOpacity
            style={[styles.submitBtn, !boxChars.every(c => c) && { opacity: 0.5 }]}
            onPress={() => handleAnswer(joinWithSpaces(boxChars))}
            disabled={!!selected || !boxChars.every(c => c)}
          >
            <Text style={styles.nextBtnText}>Submit</Text>
          </TouchableOpacity>
        </View>
      ) : question.choices.map((choice: string) => (
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
  boxRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 6 },
  wordGroup: { flexDirection: 'row', gap: 4, marginRight: 12, marginBottom: 6 },
  charBox: {
    width: 32, height: 44, borderRadius: 6, borderWidth: 2, borderColor: '#7F77DD',
    backgroundColor: '#1e1b4b', color: '#fff', fontSize: 18, fontWeight: '700',
    textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false, padding: 0,
  },
  submitBtn: { backgroundColor: '#7F77DD', borderRadius: 12, padding: 16, alignItems: 'center' },
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
  standingsRowTop3: { backgroundColor: 'rgba(139, 92, 246, 0.12)', borderRadius: 8, paddingHorizontal: 8 },
  streakBadge: { color: '#F59E0B', fontSize: 12, fontWeight: '700', marginLeft: 4 },
  moveUp: { color: '#10B981', fontSize: 12, fontWeight: '700', marginRight: 6 },
  moveDown: { color: '#EF4444', fontSize: 12, fontWeight: '700', marginRight: 6 },
  moverBanner: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
});