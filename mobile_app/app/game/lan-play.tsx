import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { OfflineGame, PowerupKey } from '@/services/offlineEngine';
import { saveOfflineGameResult } from '@/services/offlineGameService';
import { LanPlaySurface } from '@/components/game/LanPlaySurface';
import { lanClient, lanGame } from '@/services/lanSession';
import { LanMessage, LanPlayer } from '@/services/lanProtocol';

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

export default function LanPlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [finished, setFinished] = useState(false);
  const [endBanner, setEndBanner] = useState('');
  const [qIndex, setQIndex] = useState(0);
  const [pending, setPending] = useState<Record<PowerupKey, boolean>>(BASE_PENDING);
  const [standings, setStandings] = useState<LanPlayer[]>([]);
  const [, setQuizTick] = useState(0);
  const [waitTimer, setWaitTimer] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineRef = useRef<OfflineGame | null>(null);
  const submittedRef = useRef(false);
  const savedRef = useRef(false);
  const finishCalledRef = useRef(false);

  const engine = engineRef.current;
  const quiz = lanGame.quiz;

  if (!engine && quiz) {
    try {
      engineRef.current = new OfflineGame(quiz, lanGame.timePerQuestion, { order: lanGame.order });
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : String(e));
      console.warn('OfflineGame build failed', e);
    }
  }

  const finish = useCallback((reason?: string) => {
    if (finishCalledRef.current) return;
    finishCalledRef.current = true;
    if (reason) setEndBanner(reason);
    const g = engineRef.current;
    if (g && !savedRef.current) {
      savedRef.current = true;
      try {
        saveOfflineGameResult(g);
      } catch {}
    }
    if (g && lanClient && !submittedRef.current) {
      submittedRef.current = true;
      lanClient.submitResult({
        quizId: g.quizId,
        quizTitle: g.quizTitle,
        quizType: g.quizType,
        timePerQuestion: g.timePerQuestion,
        score: g.score,
        correctCount: g.correctCount,
        answeredCount: g.answeredCount,
        totalQuestions: g.totalQuestions,
      });
    }
    setFinished(true);
  }, []);

  const onMessage = useCallback(
    (msg: LanMessage) => {
      if (msg.t === 'quiz') {
        lanGame.quiz = msg.quiz;
        lanGame.order = msg.order ?? lanGame.order;
        if (msg.timePerQuestion) lanGame.timePerQuestion = msg.timePerQuestion;
        setQuizTick(t => t + 1);
        return;
      }
      if (msg.t === 'leaderboard') {
        setStandings(msg.players);
        return;
      }
      if (msg.t === 'end' && !finishCalledRef.current) {
        finish(msg.reason || 'Game over');
      }
    },
    [finish]
  );

  useEffect(() => {
    if (lanClient) lanClient.onEvent = onMessage;
    return () => {
      if (lanClient) lanClient.onEvent = () => {};
    };
  }, [onMessage]);

  useEffect(() => {
    if (engine || engineError) return;
    const t = setInterval(() => setWaitTimer(w => w + 1), 1000);
    return () => clearInterval(t);
  }, [engine, engineError]);

  if (!engine) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
          <View style={[styles.centerBox, { paddingTop: insets.top }]}>
            <ActivityIndicator color={COLORS.purpleLight} size="large" />
            <Text style={styles.waitingTitle}>Waiting for the host to start…</Text>
            <Text style={styles.waitingSub}>The quiz will appear here in a moment</Text>

            {engineError && (
              <Text style={styles.waitingError}>
                Could not build the quiz: {engineError}
              </Text>
            )}

            {!engineError && waitTimer >= 12 && (
              <Text style={styles.waitingWarn}>
                Still waiting. Make sure both phones are on the same hotspot and the host tapped INVITE, then START.
              </Text>
            )}

            {(engineError || waitTimer >= 12) && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
              >
                <Text style={styles.backButtonText}>Go Back</Text>
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>
      </View>
    );
  }

  const total = engine.totalQuestions;
  const question = engine.questions[engine.questionOrder[Math.min(qIndex, total - 1)]];
  const isLast = qIndex >= total - 1;

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
      finish();
    } else {
      setQIndex(i => i + 1);
    }
  };

  if (finished) {
    const sorted = standings.length > 0 ? [...standings].sort((a, b) => b.score - a.score) : [];
    const me = sorted.findIndex(p => p.name === lanGame.playerName);
    const myScore = engine.score;
    const rows = sorted.length > 0 ? sorted : [];
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.background}>
          <ScrollView contentContainerStyle={[styles.finalScroll, { paddingTop: insets.top + 30 }]}>
            <Ionicons name="trophy" size={44} color={COLORS.warning} />
            <Text style={styles.finalTitle}>Game Over</Text>
            {endBanner ? <Text style={styles.finalBanner}>{endBanner}</Text> : null}

            <View style={styles.myScoreCard}>
              <Text style={styles.myScoreLabel}>YOUR SCORE — {lanGame.playerName}</Text>
              <Text style={styles.myScore}>{myScore.toLocaleString()}</Text>
              <Text style={styles.myScoreMeta}>
                {engine.correctCount}/{engine.answeredCount} correct
              </Text>
            </View>

            <Text style={styles.standingsTitle}>FINAL STANDINGS</Text>
            {rows.length === 0 ? (
              <View style={styles.noBoardCard}>
                <Text style={styles.noBoardText}>
                  Scoreboard remains empty — real-time feed unavailable.
                </Text>
              </View>
            ) : (
              rows.map((p, i) => {
                const isMe = p.name === lanGame.playerName;
                return (
                  <View key={p.id} style={[styles.rankRow, isMe && styles.rankRowMe]}>
                    <Text style={styles.rankNum}>{i + 1}</Text>
                    <Ionicons name="person" size={16} color={isMe ? COLORS.accentBright : COLORS.purpleLight} />
                    <Text style={[styles.rankName, isMe && styles.rankNameMe]}>
                      {p.name}
                      {isMe ? ' (you)' : ''}
                    </Text>
                    <Text style={styles.rankScore}>{p.score.toLocaleString()}</Text>
                  </View>
                );
              })
            )}

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => {
                if (lanGame.selfPlay) {
                  router.back();
                } else {
                  router.dismissAll();
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.doneBtnText}>
                {lanGame.selfPlay ? 'Back to my host scoreboard' : 'Back to Game Center'}
              </Text>
            </TouchableOpacity>
            {me >= 0 && me === 0 && rows.length > 1 ? (
              <Text style={styles.winnerNote}>Winner! Your result is saved and ready to sync.</Text>
            ) : (
              <Text style={styles.savedNote}>Your result was saved — it will sync to your account when you&apos;re back online.</Text>
            )}
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
          timeLimit={lanGame.timePerQuestion}
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
  waitingTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 18, marginTop: 20, textAlign: 'center' },
  waitingSub: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 6, textAlign: 'center' },
  waitingWarn: { color: COLORS.warning, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20, marginHorizontal: 24 },
  waitingError: { color: COLORS.danger, fontFamily: 'Montserrat-Medium', fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20, marginHorizontal: 24 },
  backButton: { marginTop: 24, backgroundColor: COLORS.purplePrimary, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, alignItems: 'center' },
  backButtonText: { color: COLORS.textPrimary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 },
  finalScroll: { paddingHorizontal: 24, paddingBottom: 50, alignItems: 'center' },
  finalTitle: { color: COLORS.textPrimary, fontFamily: 'Montserrat-Bold', fontSize: 26, marginTop: 12, marginBottom: 6 },
  finalBanner: { color: COLORS.warning, fontFamily: 'Montserrat-Medium', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  myScoreCard: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.purpleVibrant,
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 28,
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
  },
  myScoreLabel: { color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 12, letterSpacing: 1 },
  myScore: { color: '#FBBF24', fontFamily: 'Montserrat-Black', fontSize: 44, marginVertical: 6 },
  myScoreMeta: { color: COLORS.textSecondary, fontFamily: 'Montserrat-Medium', fontSize: 13 },
  standingsTitle: {
    color: COLORS.textSecondary,
    fontFamily: 'Montserrat-Bold',
    fontSize: 13,
    letterSpacing: 1,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  noBoardCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 18, width: '100%' },
  noBoardText: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 13, textAlign: 'center' },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    width: '100%',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rankRowMe: { borderColor: COLORS.accentBright, backgroundColor: 'rgba(34, 211, 238, 0.08)' },
  rankNum: { color: COLORS.textMuted, fontFamily: 'Montserrat-Bold', fontSize: 14, width: 22 },
  rankName: { flex: 1, color: COLORS.textSecondary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 },
  rankNameMe: { color: COLORS.accentBright },
  rankScore: { color: '#FBBF24', fontFamily: 'Montserrat-Bold', fontSize: 15 },
  doneBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 15,
    width: '100%',
    alignItems: 'center',
    marginTop: 18,
  },
  doneBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 15 },
  winnerNote: { color: COLORS.success, fontFamily: 'Montserrat-SemiBold', fontSize: 12, marginTop: 14, textAlign: 'center' },
  savedNote: { color: COLORS.textMuted, fontFamily: 'Montserrat-Medium', fontSize: 12, marginTop: 14, textAlign: 'center' },
});