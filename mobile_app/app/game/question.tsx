import { useEffect, useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Animated, Dimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 🎨 Unified Purple Palette (Dark Theme Variant)
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
  const [error, setError] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [powerups, setPowerups] = useState({ freeze: 0, hint: 0, doublePoints: 0, shield: 0 });
  const [activePowerups, setActivePowerups] = useState({ hint: false, doublePoints: false, shield: false });
  const [hintedChoices, setHintedChoices] = useState<string[]>([]);
  const [powerupEarned, setPowerupEarned] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const standingsAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());
  const standingsUnsubRef = useRef<(() => void) | null>(null);
  const previousStateRef = useRef<{ [id: string]: { rank: number; score: number } }>({});
  const floatAnim = useRef(new Animated.Value(0)).current;
  const floatScale = useRef(new Animated.Value(0)).current;

  // ─── Flash Card Animation Refs ───────────────────────────────────────────────
  const cardTranslateX = useRef(new Animated.Value(0)).current;
  const cardRotateY = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const resultFlipAnim = useRef(new Animated.Value(0)).current;
  const isAnimatingRef = useRef(false);

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
    if (!powerupEarned) {
      floatAnim.setValue(0);
      floatScale.setValue(0);
      return;
    }
    // Floating bounce animation
    floatAnim.setValue(0);
    floatScale.setValue(0);
    Animated.parallel([
      Animated.spring(floatAnim, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.sequence([
        Animated.spring(floatScale, { toValue: 1.3, friction: 4, tension: 100, useNativeDriver: true }),
        Animated.spring(floatScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      ]),
    ]).start();
    const t = setTimeout(() => setPowerupEarned(null), 2500);
    return () => clearTimeout(t);
  }, [powerupEarned]);

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

  // ─── Card entrance animation when question changes ───────────────────────────
  useEffect(() => {
    if (questions.length === 0 || questionOrder.length === 0) return;
    // Animate the new card sliding in from the right
    cardTranslateX.setValue(SCREEN_WIDTH * 0.85);
    cardRotateY.setValue(12);
    cardOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(cardTranslateX, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.timing(cardRotateY, { toValue: 0, duration: 350, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      isAnimatingRef.current = false;
    });
  }, [currentIndex]);

  // ─── Result feedback banner animation ─────────────────────────────────────────
  useEffect(() => {
    if (result) {
      resultFlipAnim.setValue(0);
      Animated.timing(resultFlipAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  }, [result]);

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
    // Pick 2 wrong choices to hide for MCQ
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
    setPowerupEarned(null);
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

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      setResult({ correct: data.correct, correctAnswer: data.correctAnswer, points: data.pointsAwarded });
      if (data.powerupEarned) {
        const icons: Record<string, string> = { freeze: '❄️', hint: '💡', doublePoints: '⚡', shield: '🛡️' };
        setPowerupEarned(icons[data.powerupEarned] || data.powerupEarned);
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
          if (t <= 1) {
            clearInterval(timerRef.current);
            if (!selected) handleAnswer(null);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
  };

  const handleRetry = () => {
    setError(null);
    handleAnswer(pendingAnswer);
  };

  const toggleStandings = () => {
    const toValue = showStandings ? 0 : 1;
    setShowStandings(!showStandings);
    Animated.spring(standingsAnim, {
      toValue,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    }).start();
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

    // ─── Flash card exit animation: slide + rotate off to the left ───────────
    isAnimatingRef.current = true;
    Animated.parallel([
      Animated.timing(cardTranslateX, {
        toValue: -SCREEN_WIDTH * 0.9,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardRotateY, {
        toValue: -14,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Reset card position for entrance
      cardTranslateX.setValue(SCREEN_WIDTH * 0.85);
      cardRotateY.setValue(12);
      cardOpacity.setValue(0);

      // ─── Original state transitions (unchanged logic) ──────────────────────
      setCurrentIndex(i => i + 1);
      setSelected(null);
      setResult(null);
      setTypedAnswer('');
      setIsFrozen(false);
      setShowStandings(false);
      standingsAnim.setValue(0);
      setActivePowerups({ hint: false, doublePoints: false, shield: false });
      setHintedChoices([]);
      setPowerupEarned(null);
    });
  };

  if (questions.length === 0 || questionOrder.length === 0) {
    return <View style={styles.container}><Text style={styles.progress}>Loading questions...</Text></View>;
  }

  const actualIndex = questionOrder[currentIndex];
  const question = questions[actualIndex];

  // Compute player's current rank for the header badge
  const playerRank = standings.findIndex(p => String(p.id) === String(userId)) + 1;

  // ─── Single Unified View (No Separate Result Screen) ─────────────────────────
  return (
    <View style={styles.container}>
      {/* ─── Header: Progress | Standings Button | Timer ─────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.progress}>{currentIndex + 1} / {questionOrder.length}</Text>

        {/* Standings Toggle Button — always visible */}
        <TouchableOpacity
          style={[styles.standingsHeaderBtn, showStandings && styles.standingsHeaderBtnActive]}
          onPress={toggleStandings}
          activeOpacity={0.7}
        >
          <Text style={styles.standingsHeaderIcon}>🏆</Text>
          {playerRank > 0 && (
            <Text style={styles.standingsHeaderRank}>#{playerRank}</Text>
          )}
        </TouchableOpacity>

        <View style={[styles.timerBadge, isFrozen && { backgroundColor: '#0E7490' }, !isFrozen && timeLeft <= 5 && { backgroundColor: '#e53e3e' }]}>
          <Text style={styles.timerText}>{isFrozen ? '❄️ FROZEN' : `${timeLeft}s`}</Text>
        </View>
      </View>

      {/* ─── Standings Overlay Drawer (slides down below header) ─────────────── */}
      {showStandings && (
        <Animated.View
          style={[
            styles.standingsOverlay,
            {
              opacity: standingsAnim,
              transform: [{
                translateY: standingsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-20, 0],
                }),
              }],
            },
          ]}
        >
          <View style={styles.standingsOverlayInner}>
            <View style={styles.standingsOverlayHeader}>
              <Text style={styles.standingsTitle}>Standings</Text>
              {biggestMover && (
                <Text style={styles.moverBannerInline}>🚀 {biggestMover.name} +{biggestMover.jump}</Text>
              )}
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.standingsScroll}>
              {standings.map((p, i) => (
                <StandingsRow key={p.id} player={p} index={i} isYou={String(p.id) === String(userId)} />
              ))}
            </ScrollView>
          </View>
        </Animated.View>
      )}

      {/* Powerup Earned — Floating Icon */}
      {powerupEarned && (
        <Animated.View style={[styles.floatOverlay, { opacity: floatAnim, transform: [{ translateY: floatAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }, { scale: floatScale }] }]}>
          <Text style={styles.floatIcon}>{powerupEarned}</Text>
          <Text style={styles.floatLabel}>Powerup earned!</Text>
        </Animated.View>
      )}

      {/* Powerup Bar — only shows owned powerups */}
      {!selected && !result && (powerups.freeze > 0 || powerups.hint > 0 || powerups.doublePoints > 0 || powerups.shield > 0) && (
        <View style={styles.powerupBar}>
          {powerups.freeze > 0 && (
            <TouchableOpacity
              style={[styles.powerupBtn, isFrozen && styles.powerupBtnActive]}
              onPress={handleFreeze}
              disabled={!!selected || isFrozen}
              activeOpacity={0.7}
            >
              <Text style={styles.powerupIcon}>❄️</Text>
              <Text style={[styles.powerupLabel, isFrozen && { color: '#67E8F9' }]}>Freeze</Text>
            </TouchableOpacity>
          )}
          {powerups.hint > 0 && (
            <TouchableOpacity
              style={[styles.powerupBtn, activePowerups.hint && styles.powerupBtnActive]}
              onPress={handleHint}
              disabled={!!selected || activePowerups.hint}
              activeOpacity={0.7}
            >
              <Text style={styles.powerupIcon}>💡</Text>
              <Text style={[styles.powerupLabel, activePowerups.hint && { color: '#FDE68A' }]}>Hint</Text>
            </TouchableOpacity>
          )}
          {powerups.doublePoints > 0 && (
            <TouchableOpacity
              style={[styles.powerupBtn, activePowerups.doublePoints && styles.powerupBtnActive]}
              onPress={handleDoublePoints}
              disabled={!!selected || activePowerups.doublePoints}
              activeOpacity={0.7}
            >
              <Text style={styles.powerupIcon}>⚡</Text>
              <Text style={[styles.powerupLabel, activePowerups.doublePoints && { color: '#FDE68A' }]}>2x Pts</Text>
            </TouchableOpacity>
          )}
          {powerups.shield > 0 && (
            <TouchableOpacity
              style={[styles.powerupBtn, activePowerups.shield && styles.powerupBtnActive]}
              onPress={handleShield}
              disabled={!!selected || activePowerups.shield}
              activeOpacity={0.7}
            >
              <Text style={styles.powerupIcon}>🛡️</Text>
              <Text style={[styles.powerupLabel, activePowerups.shield && { color: '#67E8F9' }]}>Shield</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Active Powerup Banners */}
      {!selected && !result && (activePowerups.doublePoints || activePowerups.shield) && (
        <View style={styles.powerupBannerRow}>
          {activePowerups.doublePoints && (
            <View style={[styles.powerupBanner, { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#F59E0B' }]}>
              <Text style={styles.powerupBannerText}>⚡ 2x Points Active!</Text>
            </View>
          )}
          {activePowerups.shield && (
            <View style={[styles.powerupBanner, { backgroundColor: 'rgba(34, 211, 238, 0.2)', borderColor: '#22D3EE' }]}>
              <Text style={styles.powerupBannerText}>🛡️ Shield Active!</Text>
            </View>
          )}
        </View>
      )}

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ─── Flash Card Container ─────────────────────────────────────────────── */}
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
        {/* Top highlight edge for physical card feel */}
        <View style={styles.cardTopHighlight} />

        {/* Card index tab */}
        <View style={styles.cardIndexTab}>
          <Text style={styles.cardIndexText}>Q{currentIndex + 1}</Text>
        </View>

        <Text style={styles.question}>{question.question}</Text>

        {question.type === 'identification' ? (
          <View>
            {activePowerups.hint && question.correctAnswer && (
              <View style={styles.hintHint}>
                <Text style={styles.hintHintText}>💡 Starts with: "{question.correctAnswer.charAt(0).toUpperCase()}"</Text>
              </View>
            )}
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
        ) : question.choices.filter((choice: string) => !hintedChoices.includes(choice)).map((choice: string) => {
          const isCorrect = result && choice === result.correctAnswer;
          const isWrongSelected = result && choice === selected && !result.correct;
          return (
            <TouchableOpacity
              key={choice}
              style={[
                styles.choice,
                isCorrect && styles.choiceCorrect,
                isWrongSelected && styles.choiceWrong,
                {
                  opacity: result && choice !== result.correctAnswer && choice !== selected ? 0.4 : 1,
                },
              ]}
              onPress={() => handleAnswer(choice)}
              disabled={!!selected}
            >
              <Text style={[styles.choiceText, isCorrect && { color: '#10B981' }, isWrongSelected && { color: '#EF4444' }]}>
                {isCorrect ? '✓ ' : isWrongSelected ? '✗ ' : ''}{choice}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
      {/* ─── End Flash Card ───────────────────────────────────────────────────── */}

      {/* ─── Next Button (appears after answering) ────────────────────────────── */}
      {result && (
        <Animated.View
          style={{
            marginTop: 20,
            opacity: resultFlipAnim.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0.5, 1],
            }),
            transform: [{
              translateY: resultFlipAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            }],
          }}
        >
          <TouchableOpacity style={styles.nextBtnFull} onPress={handleNext} activeOpacity={0.8}>
            <Text style={styles.nextBtnText}>
              {currentIndex + 1 >= questionOrder.length ? 'Finish 🏁' : 'Next →'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, padding: 24, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  progress: { color: '#aaa', fontSize: 16, fontFamily: FONTS.semiBold },
  timerBadge: { backgroundColor: COLORS.accent, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 5 },
  timerText: { color: '#fff', fontWeight: 'bold', fontSize: 16, fontFamily: FONTS.bold },

  // ─── Standings Header Button ──────────────────────────────────────────────────
  standingsHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(127, 119, 221, 0.15)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(127, 119, 221, 0.3)',
  },
  standingsHeaderBtnActive: {
    backgroundColor: 'rgba(127, 119, 221, 0.35)',
    borderColor: COLORS.accent,
  },
  standingsHeaderIcon: {
    fontSize: 14,
  },
  standingsHeaderRank: {
    color: COLORS.purpleLight,
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },

  // ─── Standings Overlay Drawer ─────────────────────────────────────────────────
  standingsOverlay: {
    position: 'absolute',
    top: 100,
    left: 24,
    right: 24,
    zIndex: 100,
    maxHeight: SCREEN_HEIGHT * 0.55,
  },
  standingsOverlayInner: {
    backgroundColor: 'rgba(15, 12, 41, 0.95)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: COLORS.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
    maxHeight: SCREEN_HEIGHT * 0.55,
  },
  standingsOverlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  standingsScroll: {
    maxHeight: SCREEN_HEIGHT * 0.4,
  },
  moverBannerInline: {
    color: COLORS.warning,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONTS.semiBold,
  },

  // ─── Flash Card Styles ────────────────────────────────────────────────────────
  flashCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 24,
    paddingTop: 28,
    borderWidth: 1.5,
    borderColor: COLORS.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  cardTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(127, 119, 221, 0.4)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  cardIndexTab: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(127, 119, 221, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(127, 119, 221, 0.3)',
  },
  cardIndexText: {
    color: COLORS.accent,
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },

  question: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 24, lineHeight: 28, fontFamily: FONTS.bold },
  choice: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(127, 119, 221, 0.25)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  choiceText: { color: '#fff', fontSize: 16, fontFamily: FONTS.medium },
  choiceCorrect: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10B981',
  },
  choiceWrong: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#EF4444',
  },
  boxRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 6 },
  wordGroup: { flexDirection: 'row', gap: 4, marginRight: 12, marginBottom: 6 },
  charBox: {
    width: 32, height: 44, borderRadius: 8, borderWidth: 2, borderColor: COLORS.accent,
    backgroundColor: '#1e1b4b', color: '#fff', fontSize: 18, fontWeight: '700',
    textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false, padding: 0,
    shadowColor: 'rgba(127, 119, 221, 0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 2,
  },
  submitBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16, fontFamily: FONTS.bold },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  errorText: { color: '#FCA5A5', fontSize: 14, marginBottom: 12, textAlign: 'center', fontFamily: FONTS.medium },
  retryBtn: {
    backgroundColor: '#e53e3e',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
    alignSelf: 'center',
    shadowColor: '#e53e3e',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  retryBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14, fontFamily: FONTS.bold },

  // ─── Next Button (below card) ─────────────────────────────────────────────────
  nextBtnFull: {
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },

  // ─── Standings (shared) ───────────────────────────────────────────────────────
  standingsTitle: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: FONTS.semiBold,
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
    fontFamily: FONTS.bold,
  },
  standingsName: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    fontFamily: FONTS.regular,
  },
  standingsYou: {
    color: COLORS.accent,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
  standingsScore: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
  standingsRowTop3: { backgroundColor: 'rgba(139, 92, 246, 0.12)', borderRadius: 8, paddingHorizontal: 8 },
  streakBadge: { color: '#F59E0B', fontSize: 12, fontWeight: '700', marginLeft: 4 },
  moveUp: { color: '#10B981', fontSize: 12, fontWeight: '700', marginRight: 6 },
  moveDown: { color: '#EF4444', fontSize: 12, fontWeight: '700', marginRight: 6 },
  moverBanner: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 10, fontFamily: FONTS.bold },

  // Powerup styles
  powerupBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  powerupBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    minWidth: 64,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  powerupBtnActive: {
    backgroundColor: '#0E7490',
    borderColor: '#67E8F9',
    opacity: 1,
  },
  powerupIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  powerupLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
    fontFamily: FONTS.semiBold,
  },
  powerupBannerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  powerupBanner: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  powerupBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
  floatOverlay: {
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    shadowColor: 'rgba(16, 185, 129, 0.3)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  floatIcon: {
    fontSize: 40,
    marginBottom: 4,
  },
  floatLabel: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONTS.bold,
  },
  hintHint: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  hintHintText: {
    color: '#FDE68A',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: FONTS.semiBold,
  },
});