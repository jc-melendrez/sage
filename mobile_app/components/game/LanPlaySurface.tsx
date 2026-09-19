import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GameQuestion, AnswerOutcome, PowerupKey } from '@/services/offlineEngine';

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

interface LanPlaySurfaceProps {
  question: GameQuestion;
  index: number;
  total: number;
  timeLimit: number;
  score: number;
  streak: number;
  powerups: Record<PowerupKey, number>;
  pending: Record<PowerupKey, boolean>;
  onTogglePowerup: (key: PowerupKey) => void;
  onSubmit: (answer: string, timeTaken: number) => AnswerOutcome;
  onNext: () => void;
}

const LETTERS = ['A', 'B', 'C', 'D'];

export function LanPlaySurface({
  question,
  index,
  total,
  timeLimit,
  score,
  streak,
  powerups,
  pending,
  onTogglePowerup,
  onSubmit,
  onNext,
}: LanPlaySurfaceProps) {
  const [typed, setTyped] = useState('');
  const [answer, setAnswer] = useState('');
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [wrongIndexes, setWrongIndexes] = useState<number[]>([]);
  const [remaining, setRemaining] = useState(timeLimit);
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  const answeredRef = useRef(false);
  const startRef = useRef(Date.now());

  const timeTaken = Math.min((Date.now() - startRef.current) / 1000, timeLimit);

  useEffect(() => {
    answeredRef.current = false;
    setTyped('');
    setAnswer('');
    setOutcome(null);
    setHintShown(false);
    setWrongIndexes([]);
    setRemaining(timeLimit);
    setFrozen(!!pending.freeze);
    frozenRef.current = !!pending.freeze;
    startRef.current = Date.now();
    const timer = setInterval(() => {
      setRemaining(prev => {
        if (frozenRef.current || answeredRef.current) return prev;
        if (prev <= 1) {
          if (!answeredRef.current) {
            answeredRef.current = true;
            submit('');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.question, index]);

  useEffect(() => {
    if (!pending.hint) return;
    setHintShown(true);
    if (question.type === 'mcq') {
      const wrong = question.choices
        ? question.choices.map((c, i) => (c === question.correctAnswer ? -1 : i)).filter(i => i >= 0)
        : [];
      const pick = wrong[Math.floor(Math.random() * wrong.length)];
      if (pick != null) setWrongIndexes(prev => (prev.includes(pick) ? prev : [...prev, pick]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.hint]);

  const isChosen = (c: string) => answer !== '' && answer === c;

  const submit = (value: string) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    const clean = question.type === 'identification' ? value.trim() : value;
    setAnswer(clean);
    const res = onSubmit(clean, timeTaken);
    setOutcome(res);
  };

  const renderChoices = () =>
    question.choices?.map((choice, i) => {
      const letter = `${LETTERS[i]}.`;
      const chosen = isChosen(choice);
      const isCorrectPick = choice === question.correctAnswer;
      const reveal = outcome != null;
      const struck = wrongIndexes.includes(i) || (reveal && !chosen && !isCorrectPick);

      let bgColor = 'rgba(139, 92, 246, 0.08)';
      let borderColor = COLORS.border;
      let textColor = COLORS.textSecondary;
      if (chosen && reveal) {
        bgColor = isCorrectPick ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        borderColor = isCorrectPick ? COLORS.success : COLORS.danger;
        textColor = isCorrectPick ? COLORS.success : COLORS.danger;
      } else if (isCorrectPick && reveal) {
        bgColor = 'rgba(16, 185, 129, 0.12)';
        borderColor = COLORS.success;
        textColor = COLORS.success;
      } else if (chosen) {
        borderColor = COLORS.purpleVibrant;
        textColor = COLORS.textPrimary;
      }

      const disabled = answer !== '' || struck;
      return (
        <TouchableOpacity
          key={choice}
          style={[styles.choice, { backgroundColor: bgColor, borderColor }]}
          activeOpacity={0.85}
          onPress={() => !disabled && submit(choice)}
          disabled={disabled}
        >
          <Text style={[styles.choiceLetter, { color: textColor }]}>{letter}</Text>
          <Text style={[styles.choiceText, { color: textColor }, struck && styles.struck]} numberOfLines={3}>
            {choice.replace(/^[A-E]\.\s*/i, '')}
          </Text>
          {isCorrectPick && reveal && <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />}
          {chosen && reveal && !isCorrectPick && <Ionicons name="close-circle" size={20} color={COLORS.danger} />}
        </TouchableOpacity>
      );
    });

  const toggleFreeze = () => {
    if (powerups.freeze <= 0) return;
    onTogglePowerup('freeze');
    setFrozen(true);
    frozenRef.current = true;
  };

  const barColor = remaining <= 3 ? COLORS.danger : remaining <= 8 ? COLORS.warning : COLORS.purpleVibrant;
  const pct = Math.max(0, Math.min(100, (remaining / timeLimit) * 100));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <Text style={styles.progressText}>
            {index + 1} / {total}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((index + 1) / total) * 100}%` }]} />
          </View>
        </View>

        <View style={styles.scoreRow}>
          <View style={styles.scoreChip}>
            <Ionicons name="star" size={14} color="#FBBF24" />
            <Text style={styles.scoreText}>{score.toLocaleString()}</Text>
          </View>
          {streak >= 2 && (
            <View style={styles.streakChip}>
              <Ionicons name="flame" size={14} color={COLORS.warning} />
              <Text style={styles.streakText}>{streak}</Text>
            </View>
          )}
        </View>

        <View style={styles.powerupsRow}>
          {(['freeze', 'hint', 'doublePoints', 'shield'] as PowerupKey[]).map(key => {
            const meta = {
              freeze: { icon: 'snow', label: 'Freeze', tint: COLORS.accentBright },
              hint: { icon: 'bulb', label: 'Hint', tint: COLORS.warning },
              doublePoints: { icon: 'flash', label: '2x', tint: COLORS.purpleLight },
              shield: { icon: 'shield', label: 'Shield', tint: COLORS.success },
            }[key];
            const active = !!pending[key];
            const count = powerups[key];
            const onPress = key === 'freeze' ? toggleFreeze : () => count > 0 && onTogglePowerup(key);
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.powerupChip,
                  active && styles.powerupChipActive,
                  powerups[key] <= 0 && styles.powerupChipEmpty,
                ]}
                activeOpacity={0.8}
                onPress={onPress}
              >
                <Ionicons name={meta.icon as any} size={16} color={active ? '#fff' : meta.tint} />
                <Text style={[styles.powerupText, active && styles.powerupTextActive]}>{meta.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.question}>{question.question}</Text>
          {hintShown && (
            <Text style={styles.hintLine}>
              Tip: {question.type === 'identification' ? `starts with "${question.correctAnswer.trim().charAt(0).toUpperCase()}"` : 'one option is eliminated'}
            </Text>
          )}
        </View>

        <View style={styles.timerWrap}>
          <View style={[styles.timerBar, { width: `${pct}%`, backgroundColor: barColor }]} />
          <View style={styles.timerMeta}>
            <Text style={styles.timerText}>{frozen ? 'Frozen' : `${remaining}s`}</Text>
            {frozen && <Ionicons name="snow" size={14} color={COLORS.accentBright} />}
          </View>
        </View>

        {question.type === 'mcq' ? (
          <View style={styles.choices}>{renderChoices()}</View>
        ) : (
          <View style={styles.idWrap}>
            <TextInput
              style={styles.input}
              value={typed}
              onChangeText={setTyped}
              placeholder="Type your answer"
              placeholderTextColor={COLORS.textMuted}
              editable={!outcome}
              returnKeyType="done"
              onSubmitEditing={() => typed.trim() && submit(typed.trim())}
            />
            <TouchableOpacity
              style={styles.inputBtn}
              activeOpacity={0.85}
              onPress={() => typed.trim() && submit(typed.trim())}
              disabled={!!outcome}
            >
              <Text style={styles.inputBtnText}>Answer</Text>
            </TouchableOpacity>
          </View>
        )}

        {outcome && (
          <View style={[styles.resultCard, { borderColor: outcome.correct ? COLORS.success : COLORS.danger }]}>
            <Ionicons
              name={outcome.correct ? 'checkmark-circle' : 'close-circle'}
              size={26}
              color={outcome.correct ? COLORS.success : COLORS.danger}
            />
            <View style={styles.resultBody}>
              <Text style={styles.resultTitle}>
                {outcome.correct ? `Correct! +${outcome.pointsAwarded}` : 'Incorrect'}
              </Text>
              <Text style={styles.resultAnswer}>
                Answer: {question.correctAnswer.replace(/^[A-E]\.\s*/i, '')}
              </Text>
              {outcome.powerupEarned && (
                <Text style={styles.resultPowerup}>Power-up earned: {outcome.powerupEarned}</Text>
              )}
            </View>
            <TouchableOpacity style={styles.nextBtn} onPress={onNext} activeOpacity={0.85}>
              <Text style={styles.nextBtnText}>Next</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  progressText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Montserrat-SemiBold', width: 48 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(139,92,246,0.25)' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: COLORS.purpleVibrant },
  scoreRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  scoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  scoreText: { color: '#FBBF24', fontSize: 14, fontFamily: 'Montserrat-Bold' },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  streakText: { color: COLORS.warning, fontSize: 13, fontFamily: 'Montserrat-Bold' },
  powerupsRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  powerupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
  },
  powerupChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  powerupChipEmpty: { opacity: 0.4 },
  powerupText: { color: COLORS.textSecondary, fontSize: 11, fontFamily: 'Montserrat-SemiBold' },
  powerupTextActive: { color: '#fff' },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  question: { color: COLORS.textPrimary, fontSize: 19, fontFamily: 'Montserrat-Bold', lineHeight: 27 },
  hintLine: { color: COLORS.warning, fontSize: 13, fontFamily: 'Montserrat-Medium', marginTop: 10 },
  timerWrap: { marginBottom: 18 },
  timerBar: { height: 5, borderRadius: 3, marginBottom: 6 },
  timerMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  timerText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Montserrat-SemiBold' },
  choices: { gap: 10 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  choiceLetter: { fontFamily: 'Montserrat-Bold', fontSize: 14, width: 22 },
  choiceText: { flex: 1, fontFamily: 'Montserrat-Medium', fontSize: 14, lineHeight: 20 },
  struck: { textDecorationLine: 'line-through', opacity: 0.5 },
  idWrap: { marginBottom: 8 },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.textPrimary,
    fontSize: 16,
    marginBottom: 12,
  },
  inputBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  inputBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 15 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  resultBody: { flex: 1 },
  resultTitle: { color: COLORS.textPrimary, fontSize: 15, fontFamily: 'Montserrat-Bold', marginBottom: 3 },
  resultAnswer: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Montserrat-Medium' },
  resultPowerup: { color: COLORS.warning, fontSize: 12, fontFamily: 'Montserrat-SemiBold', marginTop: 3 },
  nextBtn: { backgroundColor: COLORS.purpleVibrant, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  nextBtnText: { color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 14 },
});