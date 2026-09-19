import { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { OfflineGame, PowerupKey } from '@/services/offlineEngine';
import { getCurrentOfflineGame, saveOfflineGameResult, clearCurrentOfflineGame } from '@/services/offlineGameService';
import { LanPlaySurface } from '@/components/game/LanPlaySurface';

const COLORS = {
  bg: '#0f0c29',
  surface: '#1e1b4b',
  cardBg: '#232052',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  accentBright: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(139, 92, 246, 0.2)',
};

const BASE_PENDING: Record<PowerupKey, boolean> = { freeze: false, hint: false, doublePoints: false, shield: false };

export default function OfflinePlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [qIndex, setQIndex] = useState(0);
  const [pending, setPending] = useState<Record<PowerupKey, boolean>>(BASE_PENDING);
  const [finished, setFinished] = useState(false);
  const engineRef = useRef<OfflineGame | null>(null);
  const savedRef = useRef(false);

  if (!engineRef.current) {
    engineRef.current = getCurrentOfflineGame();
  }

  const engine = engineRef.current;

  if (!engine) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
          <View style={[styles.centerBox, { paddingTop: insets.top }]}>
            <Ionicons name="alert-circle" size={40} color={COLORS.warning} />
            <Text style={styles.waitingTitle}>No game found</Text>
            <Text style={styles.waitingSub}>Start a solo game from Game Center first.</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.dismissAll()} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>Back to Game Center</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    );
  }

  const total = engine.totalQuestions;
  const question = engine.questions[engine.questionOrder[Math.min(qIndex, total - 1)]];
  const isLast = qIndex >= total - 1;

  const finishLocal = () => {
    if (savedRef.current) return;
    savedRef.current = true;
    try {
      saveOfflineGameResult(engine);
    } catch {}
    clearCurrentOfflineGame();
    setFinished(true);
  };

  const onTogglePowerup = (key: PowerupKey) => {
    if (key === 'freeze') {
      if (engine.powerups.freeze > 0) {
        engine.consumePowerup('freeze');
        setPending(prev => ({ ...prev, freeze: true }));
      }
      return;
    }
    if (engine.powerups[key] > 0) {
      setPending(prev => ({ ...prev, [key]: true }));
    }
  };

  const onSubmit = (answer: string, timeTaken: number) => {
    const flags = {
      useHint: !!pending.hint,
      useDoublePoints: !!pending.doublePoints,
      useShield: !!pending.shield,
    };
    if (pending.hint) engine.consumePowerup('hint');
    if (pending.doublePoints) engine.consumePowerup('doublePoints');
    if (pending.shield) engine.consumePowerup('shield');
    setPending(BASE_PENDING);
    return engine.answer(engine.questionOrder[qIndex], answer, timeTaken, flags);
  };

  const onNext = () => {
    setPending(BASE_PENDING);
    if (isLast) {
      finishLocal();
    } else {
      setQIndex(i => i + 1);
    }
  };

  if (finished) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
          <ScrollView contentContainerStyle={[styles.finalScroll, { paddingTop: insets.top + 30 }]}>
            <Ionicons name="trophy" size={44} color={COLORS.warning} />
            <Text style={styles.finalTitle}>Game Over</Text>

            <View style={styles.myScoreCard}>
              <Text style={styles.myScoreLabel}>YOUR SCORE</Text>
              <Text style={styles.myScore}>{engine.score.toLocaleString()}</Text>
              <Text style={styles.myScoreMeta}>
                {engine.correctCount}/{engine.answeredCount} correct of {engine.totalQuestions} questions
              </Text>
              {engine.streak >= 3 && (
                <View style={styles.bestStreak}>
                  <Ionicons name="flame" size={13} color={COLORS.warning} />
                  <Text style={styles.bestStreakText}>Best streak {engine.streak}</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => router.dismissAll()}
              activeOpacity={0.85}
            >
              <Text style={styles.doneBtnText}>Back to Game Center</Text>
            </TouchableOpacity>
            <Text style={styles.savedNote}>Result saved — it will sync to your account when you&apos;re back online.</Text>
          </ScrollView>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
        <LanPlaySurface
          question={question}
          index={qIndex}
          total={total}
          timeLimit={engine.timePerQuestion}
          score={engine.score}
          streak={engine.streak}
          powerups={engine.powerups}
          pending={pending}
          onTogglePowerup={onTogglePowerup}
          onSubmit={onSubmit}
          onNext={onNext}
        />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  background: { flex: 1 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  waitingTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 18, marginTop: 16, textAlign: 'center' },
  waitingSub: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 6, textAlign: 'center' },
  finalScroll: { paddingHorizontal: 24, paddingBottom: 50, alignItems: 'center' },
  finalTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 26, marginTop: 12, marginBottom: 6 },
  myScoreCard: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.purpleVibrant,
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 28,
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
    marginTop: 8,
  },
  myScoreLabel: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12, letterSpacing: 1 },
  myScore: { color: '#FBBF24', fontFamily: 'Montserrat-Black', fontSize: 44, marginVertical: 6 },
  myScoreMeta: { color: COLORS.textSecondary, fontFamily: 'Montserrat-Medium', fontSize: 13 },
  bestStreak: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  bestStreakText: { color: COLORS.warning, fontFamily: 'Montserrat-SemiBold', fontSize: 12 },
  doneBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 15,
    width: '100%',
    alignItems: 'center',
    marginTop: 18,
  },
  doneBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 15 },
  savedNote: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12, marginTop: 14, textAlign: 'center' },
});