import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = {
  bg: '#0f0c29',
  bgSecondary: '#1a1640',
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  cardBg: '#232052',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  accent: '#7F77DD',
  accentBright: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(139, 92, 246, 0.2)',
  cardBorder: 'rgba(127, 119, 221, 0.3)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

/* ── helper: pull the letter chip out of "A. Paris" ── */
const letterOf = (c: string) => c.charAt(0);
const textOf = (c: string) => c;

/* ═══════════════════════════════════════════════════════════════
   StandingsRow — restyled to match the HTML drawer
   ═══════════════════════════════════════════════════════════════ */
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
        styles.srRow,
        index < 3 && styles.srRowTop3,
        isYou && styles.srRowYou,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <Text style={styles.srRank}>{medal || `${index + 1}`}</Text>

      <View style={styles.srNameWrap}>
        <Text style={[styles.srName, isYou && styles.srNameYou]}>
          {player.displayName}
          {isYou && <Text style={styles.srYouTag}> (You)</Text>}
        </Text>
        {player.streak >= 3 && <Text style={styles.srStreak}>🔥{player.streak}</Text>}
      </View>

      {player.movement > 0 && <Text style={styles.srMoveUp}>▲{player.movement}</Text>}
      {player.movement < 0 && <Text style={styles.srMoveDown}>▼{Math.abs(player.movement)}</Text>}
      {player.movement === 0 && <Text style={styles.srMoveSame}>—</Text>}

      <Text style={styles.srScore}>{displayScore.toLocaleString()}</Text>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   QuestionScreen
   ═══════════════════════════════════════════════════════════════ */
const POWERUP_ITEMS = [
  { key: 'freeze', icon: '❄️', label: 'Freeze', color: '#60A5FA' },
  { key: 'hint', icon: '💡', label: 'Hint', color: '#FBBF24' },
  { key: 'doublePoints', icon: '⚡', label: '2x Pts', color: '#A78BFA' },
  { key: 'shield', icon: '🛡️', label: 'Shield', color: '#34D399' },
];

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
  const [error, setError] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [powerups, setPowerups] = useState({ freeze: 0, hint: 0, doublePoints: 0, shield: 0 });
  const [activePowerups, setActivePowerups] = useState({ hint: false, doublePoints: false, shield: false });
  const [hintedChoices, setHintedChoices] = useState<string[]>([]);
  const [showRoulette, setShowRoulette] = useState(false);
  const [rouletteTarget, setRouletteTarget] = useState<string | null>(null);
  const [spinIndex, setSpinIndex] = useState(0);
  const [roulettePhase, setRoulettePhase] = useState<'idle' | 'spinning' | 'revealed'>('idle');
  const [isFrozen, setIsFrozen] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const standingsAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());
  const standingsUnsubRef = useRef<(() => void) | null>(null);
  const previousStateRef = useRef<{ [id: string]: { rank: number; score: number } }>({});

  const cardTranslateX = useRef(new Animated.Value(0)).current;
  const cardRotateY = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const resultFlipAnim = useRef(new Animated.Value(0)).current;
  const isAnimatingRef = useRef(false);
  const autoAdvanceRef = useRef<number | null>(null);
  const [autoCountdown, setAutoCountdown] = useState(0);
  const timerBarAnim = useRef(new Animated.Value(1)).current;
  const spinTimerRef = useRef<any>(null);
  const revealTimerRef = useRef<any>(null);
  const spinDelayRef = useRef(60);
  const cyclesRef = useRef(0);

  /* ── all useEffects below are UNCHANGED ── */

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
      const pPowerups = player.data()?.powerups;
      if (pPowerups) setPowerups(pPowerups);
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
          return { ...p, movement: prev ? prev.rank - i : 0, prevScore: prev ? prev.score : p.score };
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
    if (!userId) return;
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(userId))
      .onSnapshot(snap => {
        const p = snap.data();
        if (p?.powerups) setPowerups(p.powerups);
      });
    return () => { unsub(); };
  }, [userId]);

  useEffect(() => {
    if (!showRoulette || !rouletteTarget) return;

    setRoulettePhase('spinning');
    spinDelayRef.current = 60;
    cyclesRef.current = 0;

    const tick = () => {
      cyclesRef.current++;

      if (cyclesRef.current >= 18) {
        const targetIdx = POWERUP_ITEMS.findIndex(i => i.key === rouletteTarget);
        setSpinIndex(targetIdx);
        setRoulettePhase('revealed');
        revealTimerRef.current = setTimeout(() => {
          setShowRoulette(false);
          setRouletteTarget(null);
          setRoulettePhase('idle');
        }, 2000);
        return;
      }

      setSpinIndex(prev => (prev + 1) % POWERUP_ITEMS.length);
      spinDelayRef.current = Math.min(spinDelayRef.current + 20, 400);
      spinTimerRef.current = setTimeout(tick, spinDelayRef.current);
    };

    spinTimerRef.current = setTimeout(tick, 60);

    return () => {
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, [showRoulette, rouletteTarget]);

  useEffect(() => {
    if (questions.length === 0) return;
    startTimeRef.current = Date.now();
    setTimeLeft(timePerQuestion);
    timerBarAnim.setValue(1);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); if (!selected) handleAnswer(null); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [currentIndex, questions]);

  useEffect(() => {
    const target = isFrozen ? (timePerQuestion > 0 ? timeLeft / timePerQuestion : 0) : (timePerQuestion > 0 ? timeLeft / timePerQuestion : 0);
    Animated.timing(timerBarAnim, {
      toValue: target,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [timeLeft, isFrozen]);

  useEffect(() => {
    if (question?.type === 'identification') {
      const words = question.correctAnswer.trim().split(/\s+/);
      setWordLengths(words.map((w: string) => w.length));
      setBoxChars(Array(words.join('').length).fill(''));
      boxRefs.current = [];
    }
  }, [currentIndex, questions]);

  useEffect(() => {
    if (questions.length === 0 || questionOrder.length === 0) return;
    cardTranslateX.setValue(SCREEN_WIDTH * 0.85);
    cardRotateY.setValue(12);
    cardOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(cardTranslateX, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.timing(cardRotateY, { toValue: 0, duration: 350, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start(() => { isAnimatingRef.current = false; });
  }, [currentIndex]);

  useEffect(() => {
    if (result) {
      resultFlipAnim.setValue(0);
      Animated.timing(resultFlipAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [result]);

  /* ── auto-advance: countdown then skip ── */
  useEffect(() => {
    if (!result) { setAutoCountdown(0); return; }
    const isLast = currentIndex + 1 >= questionOrder.length;
    const total = isLast ? 3 : 2;
    setAutoCountdown(total);
    autoAdvanceRef.current = window.setInterval(() => {
      setAutoCountdown(prev => {
        if (prev <= 1) {
          clearInterval(autoAdvanceRef.current!);
          autoAdvanceRef.current = null;
          handleNext();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (autoAdvanceRef.current !== null) { clearInterval(autoAdvanceRef.current); autoAdvanceRef.current = null; } };
  }, [result]);

  /* ── all handlers below are UNCHANGED ── */

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
    if (char && index < boxChars.length - 1) boxRefs.current[index + 1]?.focus();
    if (next.every(c => c)) setTypedAnswer(joinWithSpaces(next));
  };

  const handleBoxKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !boxChars[index] && index > 0)
      boxRefs.current[index - 1]?.focus();
  };

  const handleFreeze = async () => {
    if (powerups.freeze <= 0 || selected || isFrozen) return;
    clearInterval(timerRef.current);
    setIsFrozen(true);
    setPowerups(p => ({ ...p, freeze: p.freeze - 1 }));
    const user = await getCurrentUser();
    const playerRef = firestore().collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(user?.id));
    playerRef.update({ 'powerups.freeze': firestore.FieldValue.increment(-1) });
  };

  const handleHint = async () => {
    if (powerups.hint <= 0 || selected || activePowerups.hint) return;
    setPowerups(p => ({ ...p, hint: p.hint - 1 }));
    setActivePowerups(p => ({ ...p, hint: true }));
    const q = questions[questionOrder[currentIndex]];
    if (q?.type === 'mcq' && q.choices) {
      const wrong = q.choices.filter((c: string) => c !== q.correctAnswer);
      const shuffled = wrong.sort(() => Math.random() - 0.5);
      setHintedChoices(shuffled.slice(0, 2));
    }
    const user = await getCurrentUser();
    const playerRef = firestore().collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(user?.id));
    playerRef.update({ 'powerups.hint': firestore.FieldValue.increment(-1) });
  };

  const handleDoublePoints = async () => {
    if (powerups.doublePoints <= 0 || selected || activePowerups.doublePoints) return;
    setPowerups(p => ({ ...p, doublePoints: p.doublePoints - 1 }));
    setActivePowerups(p => ({ ...p, doublePoints: true }));
    const user = await getCurrentUser();
    const playerRef = firestore().collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(user?.id));
    playerRef.update({ 'powerups.doublePoints': firestore.FieldValue.increment(-1) });
  };

  const handleShield = async () => {
    if (powerups.shield <= 0 || selected || activePowerups.shield) return;
    setPowerups(p => ({ ...p, shield: p.shield - 1 }));
    setActivePowerups(p => ({ ...p, shield: true }));
    const user = await getCurrentUser();
    const playerRef = firestore().collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(user?.id));
    playerRef.update({ 'powerups.shield': firestore.FieldValue.increment(-1) });
  };

  const handleAnswer = async (answer: string | null) => {
    if (selected) return;
    clearInterval(timerRef.current);
    setSelected(answer || '');
    setPendingAnswer(answer);
    setError(null);
    const timeTaken = (Date.now() - startTimeRef.current) / 1000;
    const actualIndex = questionOrder[currentIndex];
    try {
      const token = await getToken();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API_BASE_URL}/game/answer/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          roomCode,
          questionIndex: actualIndex,
          answer: answer || '',
          timeTaken,
          useHint: activePowerups.hint ? 'true' : 'false',
          useDoublePoints: activePowerups.doublePoints ? 'true' : 'false',
          useShield: activePowerups.shield ? 'true' : 'false',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Server error ${res.status}`); }
      const data = await res.json();
      setResult({ correct: data.correct, correctAnswer: data.correctAnswer, points: data.pointsAwarded });
      if (data.powerupEarned) {
        setShowRoulette(true);
        setRouletteTarget(data.powerupEarned);
      }
    } catch (e: any) {
      console.error(e);
      const msg = e.name === 'AbortError'
        ? 'Server timed out. Check your connection and try again.'
        : e.message || 'Network error. Check your connection.';
      setError(msg);
      setSelected(null);
      setPendingAnswer(null);
      startTimeRef.current = Date.now();
      setTimeLeft(timePerQuestion);
      timerRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) { clearInterval(timerRef.current); if (!selected) handleAnswer(null); return 0; }
          return t - 1;
        });
      }, 1000);
    }
  };

  const handleRetry = () => { setError(null); handleAnswer(pendingAnswer); };

  const toggleStandings = () => {
    const toValue = showStandings ? 0 : 1;
    setShowStandings(!showStandings);
    Animated.spring(standingsAnim, { toValue, friction: 8, tension: 60, useNativeDriver: true }).start();
  };

  const handleNext = async () => {
    if (currentIndex + 1 >= questionOrder.length) {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/game/finish/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode }),
      });
      router.replace({ pathname: '/game/final', params: { roomCode } });
      return;
    }
    isAnimatingRef.current = true;
    Animated.parallel([
      Animated.timing(cardTranslateX, { toValue: -SCREEN_WIDTH * 0.9, duration: 300, useNativeDriver: true }),
      Animated.timing(cardRotateY, { toValue: -14, duration: 300, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      cardTranslateX.setValue(SCREEN_WIDTH * 0.85);
      cardRotateY.setValue(12);
      cardOpacity.setValue(0);
      setCurrentIndex(i => i + 1);
      setSelected(null);
      setResult(null);
      setTypedAnswer('');
      setIsFrozen(false);
      setShowStandings(false);
      standingsAnim.setValue(0);
      setActivePowerups({ hint: false, doublePoints: false, shield: false });
      setHintedChoices([]);
      setShowRoulette(false);
      setRouletteTarget(null);
      setRoulettePhase('idle');
    });
  };

  /* ── loading guard ── */
  if (questions.length === 0 || questionOrder.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading questions...</Text>
      </View>
    );
  }

  const actualIndex = questionOrder[currentIndex];
  const question = questions[actualIndex];
  const playerRank = standings.findIndex(p => String(p.id) === String(userId)) + 1;
  const isDanger = !isFrozen && timeLeft <= 5;
  const hasPowerups = powerups.freeze > 0 || powerups.hint > 0 || powerups.doublePoints > 0 || powerups.shield > 0;
  const visibleChoices = question.type === 'mcq'
    ? question.choices.filter((c: string) => !hintedChoices.includes(c))
    : [];

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <View style={styles.container}>

      {/* ── frozen screen tint ── */}
      {isFrozen && <View style={styles.frozenTint} />}

      {/* ── HEADER ROW ── */}
      <View style={styles.header}>
        <Text style={styles.progressText}>
          <Text style={styles.progressCurrent}>{currentIndex + 1}</Text>
          {' / '}
          {questionOrder.length}
        </Text>

        <TouchableOpacity
          style={[styles.standingsToggle, showStandings && styles.standingsToggleActive]}
          onPress={toggleStandings}
          activeOpacity={0.7}
        >
          <Text style={styles.standingsToggleIcon}>🏆</Text>
          {playerRank > 0 && (
            <View style={styles.rankBadge}>
              <Text style={styles.rankBadgeText}>#{playerRank}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={[
          styles.timerBadge,
          isFrozen && styles.timerBadgeFrozen,
          isDanger && styles.timerBadgeDanger,
        ]}>
          <Text style={[
            styles.timerBadgeText,
            isFrozen && styles.timerBadgeTextFrozen,
            isDanger && styles.timerBadgeTextDanger,
          ]}>
            {isFrozen ? '❄️ FROZEN' : `${timeLeft}s`}
          </Text>
        </View>
      </View>

      {/* ── TIMER PROGRESS BAR (smooth animated) ── */}
      <View style={styles.timerBarTrack}>
        <Animated.View style={[
          styles.timerBarFill,
          isDanger && styles.timerBarFillDanger,
          isFrozen && styles.timerBarFillFrozen,
          { width: timerBarAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]} />
      </View>

      {/* ── ACTIVE POWERUP BANNERS ── */}
      {!selected && !result && (activePowerups.doublePoints || activePowerups.shield) && (
        <View style={styles.bannerRow}>
          {activePowerups.doublePoints && (
            <View style={[styles.banner, styles.banner2x]}>
              <Text style={styles.bannerText2x}>⚡ 2x Points Active!</Text>
            </View>
          )}
          {activePowerups.shield && (
            <View style={[styles.banner, styles.bannerShield]}>
              <Text style={styles.bannerTextShield}>🛡️ Shield Active!</Text>
            </View>
          )}
        </View>
      )}

      {/* ── ERROR ── */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── SCROLLABLE MIDDLE ── */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!showStandings}
      >
        {/* ── FLASH CARD (animated) ── */}
        <Animated.View
          style={[
            styles.flashCard,
            {
              opacity: cardOpacity,
              transform: [
                { perspective: 1200 },
                { translateX: cardTranslateX },
                { rotateY: cardRotateY.interpolate({ inputRange: [-14, 0, 12], outputRange: ['-14deg', '0deg', '12deg'] }) },
              ],
            },
          ]}
        >
          <View style={styles.cardHighlight} />

          <View style={styles.qTab}>
            <Text style={styles.qTabText}>Q{currentIndex + 1}</Text>
          </View>

          <Text style={styles.questionText}>{question.question}</Text>
        </Animated.View>

        {/* ── RESULT STRIP ── */}
        {result && (
          <Animated.View
            style={[
              styles.resultStrip,
              result.correct ? styles.resultStripCorrect : styles.resultStripWrong,
              {
                opacity: resultFlipAnim,
                transform: [{ translateY: resultFlipAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
              },
            ]}
          >
            <Text style={styles.resultStripLabel}>
              {result.correct ? '✅ Correct!' : `✗ Wrong — Answer: ${result.correctAnswer}`}
            </Text>
            <Text style={[styles.resultStripPts, result.correct ? styles.ptsGreen : styles.ptsRed]}>
              +{result.points}
            </Text>
          </Animated.View>
        )}

        {/* ── MCQ CHOICES ── */}
        {question.type === 'mcq' && (
          <View style={styles.choicesWrap}>
            {visibleChoices.map((choice: string) => {
              const isCorrect = result && choice === result.correctAnswer;
              const isWrongPick = result && choice === selected && !result.correct;
              const isDimmed = result && !isCorrect && choice !== selected;
              return (
                <TouchableOpacity
                  key={choice}
                  style={[
                    styles.choice,
                    isCorrect && styles.choiceCorrect,
                    isWrongPick && styles.choiceWrong,
                    isDimmed && styles.choiceDimmed,
                  ]}
                  onPress={() => handleAnswer(choice)}
                  disabled={!!selected}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.choiceChip,
                    isCorrect && styles.choiceChipCorrect,
                    isWrongPick && styles.choiceChipWrong,
                  ]}>
                    <Text style={[
                      styles.choiceChipText,
                      isCorrect && styles.choiceChipTextCorrect,
                      isWrongPick && styles.choiceChipTextWrong,
                    ]}>
                      {isCorrect ? '✓' : isWrongPick ? '✗' : letterOf(choice)}
                    </Text>
                  </View>
                  <Text style={[
                    styles.choiceText,
                    isCorrect && styles.choiceTextCorrect,
                    isWrongPick && styles.choiceTextWrong,
                  ]}>
                    {textOf(choice)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── IDENTIFICATION INPUT ── */}
        {question.type === 'identification' && (
          <View style={styles.idArea}>
            {activePowerups.hint && question.correctAnswer && (
              <View style={styles.hintBanner}>
                <Text style={styles.hintBannerText}>
                  💡 Starts with: <Text style={styles.hintLetter}>{question.correctAnswer.charAt(0).toUpperCase()}</Text>
                </Text>
              </View>
            )}

            <View style={styles.idWords}>
              {(() => {
                let idx = 0;
                return wordLengths.map((len, wi) => {
                  const group = boxChars.slice(idx, idx + len).map((char, j) => {
                    const gi = idx + j;
                    return (
                      <TextInput
                        key={gi}
                        ref={(r) => { boxRefs.current[gi] = r; }}
                        style={[styles.charBox, char ? styles.charBoxFilled : null]}
                        value={char}
                        onChangeText={(t) => handleBoxChange(t, gi)}
                        onKeyPress={(e) => handleBoxKeyPress(e, gi)}
                        maxLength={1}
                        editable={!selected}
                        autoCapitalize="characters"
                        selectionColor={COLORS.accentBright}
                      />
                    );
                  });
                  idx += len;
                  return <View key={wi} style={styles.idWord}>{group}</View>;
                });
              })()}
            </View>

            {!result && (
              <TouchableOpacity
                style={[styles.submitBtn, !boxChars.every(c => c) && styles.submitBtnDisabled]}
                onPress={() => handleAnswer(joinWithSpaces(boxChars))}
                disabled={!!selected || !boxChars.every(c => c)}
                activeOpacity={0.8}
              >
                <Text style={styles.submitBtnText}>Submit</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── NEXT / FINISH (auto-advance countdown, tappable to skip) ── */}
        {result && (
          <Animated.View
            style={[
              styles.nextWrap,
              {
                opacity: resultFlipAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.5, 1] }),
                transform: [{ translateY: resultFlipAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
              },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.nextBtn,
                currentIndex + 1 >= questionOrder.length ? styles.nextBtnFinish : styles.nextBtnAccent,
              ]}
              onPress={() => { if (autoAdvanceRef.current !== null) { clearInterval(autoAdvanceRef.current); autoAdvanceRef.current = null; } handleNext(); }}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.nextBtnText,
                currentIndex + 1 >= questionOrder.length ? styles.nextBtnTextFinish : styles.nextBtnTextAccent,
              ]}>
                {currentIndex + 1 >= questionOrder.length ? 'Finish 🏁' : 'Next →'}
              </Text>
              {autoCountdown > 0 && (
                <Text style={styles.nextBtnCountdown}>{autoCountdown}s</Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>

      {/* ── POWERUP BAR (pinned bottom) ── */}
      {!selected && !result && hasPowerups && (
        <View style={styles.powerupBar}>
          {powerups.freeze > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, isFrozen && styles.puBtnFreezeActive]}
              onPress={handleFreeze}
              disabled={!!selected || isFrozen}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{powerups.freeze}</Text></View>
              <Text style={styles.puIcon}>❄️</Text>
              <Text style={[styles.puLabel, isFrozen && styles.puLabelCyan]}>Freeze</Text>
            </TouchableOpacity>
          )}
          {powerups.hint > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, activePowerups.hint && styles.puBtnUsed]}
              onPress={handleHint}
              disabled={!!selected || activePowerups.hint}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{powerups.hint}</Text></View>
              <Text style={styles.puIcon}>💡</Text>
              <Text style={[styles.puLabel, activePowerups.hint && styles.puLabelYellow]}>Hint</Text>
            </TouchableOpacity>
          )}
          {powerups.doublePoints > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, activePowerups.doublePoints && styles.puBtnUsed]}
              onPress={handleDoublePoints}
              disabled={!!selected || activePowerups.doublePoints}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{powerups.doublePoints}</Text></View>
              <Text style={styles.puIcon}>⚡</Text>
              <Text style={[styles.puLabel, activePowerups.doublePoints && styles.puLabelYellow]}>2x Pts</Text>
            </TouchableOpacity>
          )}
          {powerups.shield > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, activePowerups.shield && styles.puBtnShieldActive]}
              onPress={handleShield}
              disabled={!!selected || activePowerups.shield}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{powerups.shield}</Text></View>
              <Text style={styles.puIcon}>🛡️</Text>
              <Text style={[styles.puLabel, activePowerups.shield && styles.puLabelCyan]}>Shield</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── POWERUP ROULETTE OVERLAY ── */}
      {showRoulette && (
        <View style={styles.rouletteOverlay}>
          <View style={[styles.rouletteCard, roulettePhase === 'revealed' && styles.rouletteCardRevealed]}>
            <Text style={styles.rouletteLabel}>
              {roulettePhase === 'revealed' ? 'YOU GOT' : 'POWER-UP'}
            </Text>
            <View style={styles.rouletteIconWrap}>
              <Text style={[styles.rouletteIcon, roulettePhase === 'revealed' && { color: POWERUP_ITEMS[spinIndex].color }]}>
                {POWERUP_ITEMS[spinIndex].icon}
              </Text>
            </View>
            <Text style={[styles.rouletteItemName, { color: POWERUP_ITEMS[spinIndex].color }]}>
              {POWERUP_ITEMS[spinIndex].label}
            </Text>
            <Text style={styles.rouletteHint}>
              {roulettePhase === 'revealed' ? 'Added to your kit!' : '...'}
            </Text>
          </View>
        </View>
      )}

      {/* ── STANDINGS OVERLAY ── */}
      {showStandings && (
        <View style={styles.standingsOverlay}>
          <TouchableOpacity style={styles.standingsBackdrop} activeOpacity={1} onPress={toggleStandings} />
          <Animated.View
            style={[
              styles.standingsDrawer,
              {
                opacity: standingsAnim,
                transform: [{ translateY: standingsAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
              },
            ]}
          >
            <View style={styles.standingsDrawerHeader}>
              <Text style={styles.standingsDrawerTitle}>STANDINGS</Text>
            </View>
            {biggestMover && (
              <View style={styles.moverBanner}>
                <Text style={styles.moverBannerText}>🚀 {biggestMover.name} jumped +{biggestMover.jump} ranks!</Text>
              </View>
            )}
            <ScrollView showsVerticalScrollIndicator={false} style={styles.standingsScroll}>
              {standings.map((p, i) => (
                <StandingsRow key={p.id} player={p} index={i} isYou={String(p.id) === String(userId)} />
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      )}

      <View style={styles.safeBottom} />
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  /* ── layout ── */
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
    marginTop: 80,
  },
  frozenTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(14,116,144,0.05)',
    zIndex: 1,
    borderRadius: 0,
  },
  safeBottom: { height: 34 },

  /* ── header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    zIndex: 10,
  },
  progressText: {
    fontSize: 15,
    fontFamily: FONTS.extraBold,
    color: COLORS.textSecondary,
  },
  progressCurrent: {
    color: COLORS.purplePrimary,
  },

  /* standings toggle */
  standingsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(127,119,221,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.25)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  standingsToggleActive: {
    backgroundColor: 'rgba(127,119,221,0.35)',
    borderColor: 'rgba(127,119,221,0.5)',
  },
  standingsToggleIcon: { fontSize: 14 },
  rankBadge: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rankBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: FONTS.extraBold,
  },

  /* timer badge */
  timerBadge: {
    backgroundColor: COLORS.accentBright,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerBadgeDanger: { backgroundColor: '#e53e3e' },
  timerBadgeFrozen: { backgroundColor: '#0E7490' },
  timerBadgeText: {
    color: COLORS.bg,
    fontSize: 16,
    fontFamily: FONTS.black,
  },
  timerBadgeTextDanger: { color: '#fff' },
  timerBadgeTextFrozen: { color: '#A5F3FC', fontSize: 12 },

  /* timer progress bar */
  timerBarTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 16,
  },
  timerBarFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: COLORS.accentBright,
  },
  timerBarFillDanger: { backgroundColor: '#e53e3e' },
  timerBarFillFrozen: { backgroundColor: '#0E7490' },

  /* ── active powerup banners ── */
  bannerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  banner: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  banner2x: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderColor: 'rgba(245,158,11,0.3)',
  },
  bannerShield: {
    backgroundColor: 'rgba(34,211,238,0.08)',
    borderColor: 'rgba(34,211,238,0.25)',
  },
  bannerText2x: { color: '#FBBF24', fontSize: 12, fontFamily: FONTS.bold },
  bannerTextShield: { color: '#67E8F9', fontSize: 12, fontFamily: FONTS.bold },

  /* ── error ── */
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: '#e53e3e',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 28,
    alignItems: 'center',
    alignSelf: 'center',
  },
  retryBtnText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bold },

  /* ── scroll area ── */
  scrollArea: { flex: 1 },
  scrollContent: { paddingBottom: 16 },

  /* ── flash card ── */
  flashCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 24,
    paddingTop: 28,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 16,
  },
  cardHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  qTab: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 14,
  },
  qTabText: {
    color: COLORS.accentBright,
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1,
  },
  questionText: {
    color: '#fff',
    fontSize: 20,
    fontFamily: FONTS.bold,
    lineHeight: 29,
  },

  /* ── result strip ── */
  resultStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 14,
  },
  resultStripCorrect: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
  },
  resultStripLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: '#34D399',
  },
  resultStripWrong: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  ptsGreen: { color: '#34D399' },
  ptsRed: { color: '#F87171' },
  resultStripPts: {
    fontSize: 18,
    fontFamily: FONTS.black,
    marginLeft: 12,
  },

  /* ── MCQ choices ── */
  choicesWrap: {
    marginTop: 20,
    gap: 12,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(127,119,221,0.2)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  choiceCorrect: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderColor: 'rgba(16,185,129,0.5)',
  },
  choiceWrong: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.45)',
  },
  choiceDimmed: { opacity: 0.35 },

  choiceChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceChipCorrect: { backgroundColor: COLORS.success },
  choiceChipWrong: { backgroundColor: COLORS.danger },
  choiceChipText: {
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    color: '#DDD6FE',
  },
  choiceChipTextCorrect: { color: '#fff' },
  choiceChipTextWrong: { color: '#fff' },

  choiceText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.semiBold,
    color: '#E2E8F0',
  },
  choiceTextCorrect: { color: '#34D399' },
  choiceTextWrong: { color: '#F87171' },

  /* ── identification ── */
  idArea: {
    marginTop: 24,
    alignItems: 'center',
    gap: 20,
  },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  hintBannerText: { fontSize: 13, fontFamily: FONTS.bold, color: '#FBBF24' },
  hintLetter: { fontFamily: FONTS.black },

  idWords: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  idWord: { flexDirection: 'row', gap: 5 },
  charBox: {
    width: 36,
    height: 48,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(34,211,238,0.35)',
    backgroundColor: COLORS.surface,
    color: '#fff',
    fontSize: 20,
    fontFamily: FONTS.extraBold,
    textAlign: 'center',
    padding: 0,
    includeFontPadding: false,
  },
  charBoxFilled: {
    borderColor: COLORS.accentBright,
    backgroundColor: 'rgba(34,211,238,0.08)',
  },

  submitBtn: {
    backgroundColor: COLORS.purpleDark,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#fff', fontSize: 15, fontFamily: FONTS.extraBold },

  /* ── next / finish ── */
  nextWrap: { marginTop: 20 },
  nextBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnAccent: { backgroundColor: COLORS.accentBright },
  nextBtnFinish: { backgroundColor: COLORS.purplePrimary },
  nextBtnText: { fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  nextBtnCountdown: { fontSize: 12, fontFamily: FONTS.medium, opacity: 0.7, marginLeft: 8 },
  nextBtnTextAccent: { color: COLORS.bg },
  nextBtnTextFinish: { color: '#fff' },

  /* ── powerup bar ── */
  powerupBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  puBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(127,119,221,0.2)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 68,
    position: 'relative',
  },
  puBtnFreezeActive: {
    backgroundColor: 'rgba(14,116,144,0.3)',
    borderColor: '#0E7490',
  },
  puBtnShieldActive: {
    backgroundColor: 'rgba(14,116,144,0.2)',
    borderColor: 'rgba(34,211,238,0.4)',
  },
  puBtnUsed: { opacity: 0.5 },
  puCountBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.purplePrimary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  puCountText: { color: '#fff', fontSize: 10, fontFamily: FONTS.extraBold },
  puIcon: { fontSize: 20, marginBottom: 2 },
  puLabel: {
    fontSize: 9,
    fontFamily: FONTS.bold,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  puLabelCyan: { color: '#A5F3FC' },
  puLabelYellow: { color: '#FDE68A' },

  /* ── powerup roulette overlay ── */
  rouletteOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(10,8,30,0.82)',
    zIndex: 200,
  },
  rouletteCard: {
    width: 220,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: 'rgba(139,92,246,0.4)',
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 24,
    shadowColor: 'rgba(124,58,237,0.3)',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 48,
    elevation: 30,
  },
  rouletteCardRevealed: {
    borderColor: '#FBBF24',
    shadowColor: 'rgba(251,191,36,0.4)',
  },
  rouletteLabel: {
    fontSize: 13,
    fontFamily: FONTS.extraBold,
    color: COLORS.textMuted,
    letterSpacing: 2,
    marginBottom: 16,
  },
  rouletteIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.2)',
  },
  rouletteIcon: {
    fontSize: 48,
  },
  rouletteItemName: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    marginBottom: 8,
  },
  rouletteHint: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },

  /* ── standings overlay ── */
  standingsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  standingsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,8,30,0.75)',
  },
  standingsDrawer: {
    position: 'absolute',
    top: 110,
    left: 0,
    right: 0,
    backgroundColor: COLORS.bgSecondary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    maxHeight: SCREEN_HEIGHT * 0.55,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 60,
    elevation: 20,
  },
  standingsDrawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  standingsDrawerTitle: {
    fontSize: 16,
    fontFamily: FONTS.black,
    letterSpacing: 2,
    color: '#DDD6FE',
  },
  moverBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginBottom: 14,
    alignSelf: 'flex-start',
  },
  moverBannerText: { fontSize: 11, fontFamily: FONTS.bold, color: '#34D399' },
  standingsScroll: { maxHeight: SCREEN_HEIGHT * 0.38 },

  /* standings rows */
  srRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
  },
  srRowTop3: {
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.2)',
  },
  srRowYou: {
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
  },
  srRank: { width: 32, fontSize: 18, textAlign: 'center', fontFamily: FONTS.bold, color: COLORS.textMuted },
  srNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  srName: { fontSize: 14, fontFamily: FONTS.bold, color: '#E2E8F0' },
  srNameYou: { color: COLORS.accent },
  srYouTag: { color: COLORS.accent, fontFamily: FONTS.extraBold, fontSize: 12 },
  srStreak: { fontSize: 12 },
  srMoveUp: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#34D399', width: 36, textAlign: 'center' },
  srMoveDown: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#F87171', width: 36, textAlign: 'center' },
  srMoveSame: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#64748B', width: 36, textAlign: 'center' },
  srScore: { fontSize: 16, fontFamily: FONTS.black, color: '#fff', minWidth: 52, textAlign: 'right' },
});