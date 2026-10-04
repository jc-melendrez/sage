import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  // ✨ RENAMED to avoid conflict with react-native-reanimated
  Animated as RNAnimated,
  Dimensions,
  ActivityIndicator,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
// ✨ NEW: Reanimated imports for timer shake/pulse
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import firestore from '@react-native-firebase/firestore';
import * as Haptics from 'expo-haptics';
import { getToken, getCurrentUser } from '@/services/authService';
import { createOfflineGame, getCurrentOfflineGame, saveOfflineGameResult, clearCurrentOfflineGame } from '@/services/offlineGameService';
import { getLanClient, lanGame, getLanPlayerId, setLanPlayerId, setLanFinalStandings, getLastLanRoster } from '@/services/lanSession';
import type { LanMessage, LanPlayer } from '@/services/lanProtocol';
import { API_BASE_URL } from '@/config/api';
import TeamRevealOverlay from '@/components/TeamRevealOverlay';
import { Ionicons } from '@expo/vector-icons';
import PowerupPoolHUD from '@/components/game/PowerupPoolHUD';
import StandingsTicker from '@/components/game/StandingsTicker';
import { answerLogFromOutcomes } from '@/services/gameBreakdown';
import ReactionBar from '@/components/game/ReactionBar';
import { sameTeamId, activeMembersByTeam, teamRankValue, type PowerupKey, type TeamEntry, type PlayerAnswerLog } from '@/types/game';
import { pfpSource } from '@/constants/pfps';

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

/**
 * A Firestore timestamp as epoch milliseconds, tolerating the shapes the value
 * arrives in: a Timestamp, a millisecond number, an ISO string, or nothing at
 * all on a room written before the field existed.
 */
function timestampMillis(value: any): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value.seconds != null) return value.seconds * 1000;
  return null;
}

/**
 * Seconds a shared team question allows.
 *
 * Mirrors `question_time_limit` on the server: a question may carry its own
 * `timeLimit`, and the room's `timePerQuestion` is the fallback. Reading it the
 * same way here means the countdown on this screen matches the one the server
 * enforces when a member claims the clock has run out.
 */
function sharedTimeLimit(roomData: any, index: number): number {
  const own = roomData?.questions?.[index]?.timeLimit;
  if (typeof own === 'number' && own > 0) return own;
  const fallback = roomData?.timePerQuestion;
  return typeof fallback === 'number' && fallback > 0 ? fallback : 15;
}

/* ═══════════════════════════════════════════════════════════════
   StandingsRow — restyled to match the HTML drawer
   ═══════════════════════════════════════════════════════════════ */
function StandingsRow({ player, index, isYou }: { player: any; index: number; isYou: boolean }) {
  // ✨ UPDATED: RNAnimated
  const anim = useRef(new RNAnimated.Value(0)).current;
  const scoreAnim = useRef(new RNAnimated.Value(player.prevScore)).current;
  const [displayScore, setDisplayScore] = useState(player.prevScore);

  useEffect(() => {
    RNAnimated.timing(anim, { toValue: 1, duration: 280, delay: index * 90, useNativeDriver: true }).start();
    RNAnimated.timing(scoreAnim, { toValue: player.score, duration: 500, delay: index * 90 + 150, useNativeDriver: false }).start();
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    return () => scoreAnim.removeListener(id);
  }, []);

  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : null;

  return (
    <RNAnimated.View
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
      {pfpSource(player.avatar) ? (
        <Image source={pfpSource(player.avatar)!} style={styles.srAvatar} resizeMode="cover" />
      ) : (
        <View style={styles.srAvatar}>
          <Text style={styles.srAvatarText}>{(player.displayName || '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
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
    </RNAnimated.View>
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

/**
 * Whether a LAN roster entry is the local player. Shared by the roster seed and
 * the leaderboard broadcast so the two can never disagree about which row is
 * "you" — the standings drawer marks the own row by comparing to the literal
 * id 'me', so an un-remapped row silently loses its "(You)" tag.
 *
 * Falls back to name matching because getLanPlayerId() is only populated once
 * the host's 'welcome' message arrives, which can be after the first render.
 */
const isMyLanPlayer = (p: LanPlayer) => {
  const myId = getLanPlayerId();
  return myId ? p.id === myId : p.name === lanGame.playerName;
};

export default function QuestionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roomCode: string; offline?: string; lan?: string; quizTitle?: string }>();
  const roomCode = params.roomCode;
  const isOffline = params.offline === 'true';
  const isLan = params.lan === 'true';
  const [questions, setQuestions] = useState<any[]>([]);
  const [questionOrder, setQuestionOrder] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{
    correct: boolean;
    correctAnswer: string;
    points: number;
    /** Part of `points` earned by answering fast, above the 500 floor. */
    speedBonus?: number;
    /** What the player chose; '' on timeout. */
    picked?: string;
    /* ── team mode ── */
    /** The team's single answer, from the shared reveal. */
    teamAnswer?: string;
    /** How many members backed the team's answer. A count, never a list of names. */
    agreed?: number;
    /** Whether THIS member's own pick matched the team's answer. A voided
     * (tied) question counts as agreeing: there was no team answer to disagree
     * with, and punishing it twice would be wrong. */
    iAgreed?: boolean;
    /** Members who submitted a pick, of those expected. */
    pickers?: number;
    /** The team split and nobody answered for it, so it scored nothing. */
    voided?: boolean;
  } | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [boxChars, setBoxChars] = useState<string[]>([]);
  const [wordLengths, setWordLengths] = useState<number[]>([]);
  const boxRefs = useRef<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [biggestMover, setBiggestMover] = useState<{ name: string; jump: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [timePerQuestion, setTimePerQuestion] = useState(15);
  const [userId, setUserId] = useState<number | string | null>(null);
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
/** Blocks a second tap while the freeze charge is being confirmed. */
const [freezeBusy, setFreezeBusy] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const [roomStatus, setRoomStatus] = useState('waiting');
  const [teamMode, setTeamMode] = useState(false);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myCorrectCount, setMyCorrectCount] = useState(0);
  // Latched once the server refuses an answer. The team-missing case is derived
  // from myTeamId instead, because it is known before the first tap.
  const [isSpectating, setIsSpectating] = useState(false);
  const [teammates, setTeammates] = useState<{ id: string; displayName: string; avatar?: string }[]>([]);
  const [boostingId, setBoostingId] = useState<string | null>(null);
  const [boostedName, setBoostedName] = useState<string | null>(null);
  const [teamAssignments, setTeamAssignments] = useState<any[] | null>(null);
  const [showTeamReveal, setShowTeamReveal] = useState(false);
  const [waitTimer, setWaitTimer] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  /* ── team mode: the ROOM owns the shared question ──
   * One index, one deadline, one answer per team. These come off the room
   * document rather than being tracked locally, because a team that is looking
   * at two different questions is not playing a team game. */
  const [teamIndex, setTeamIndex] = useState(0);
  /** `teamStartedAt` as epoch ms; null until the room writes it. */
  const [teamStartedAt, setTeamStartedAt] = useState<number | null>(null);
  /** Seconds the shared question allows, from the question's own timeLimit. */
  const [teamTimeLimit, setTeamTimeLimit] = useState(15);
  /** Picks submitted so far / expected. Seeded from this member's own pending
   * response, then kept live from the team's published `pickCount`. */
  const [teamPickCount, setTeamPickCount] = useState<{ picked: number; expected: number } | null>(null);
  /** This member's own answer log, so "did I agree with my team?" can be shown
   * for a question that resolved without this client making the last pick. */
  const [ownAnswers, setOwnAnswers] = useState<PlayerAnswerLog>({});
  /** The room's creator. Only they can settle the game and pay placement XP;
   * `hostId` can move to a student who is merely running the room. */
  const [roomOwnerId, setRoomOwnerId] = useState<string | null>(null);
  /** Latches once a forced pick has been sent for this question. */
  const teamForceSentRef = useRef(false);
  /** Latest submit/pick closure for the clock interval, which must not capture
   * a stale render's state. */
  const teamPickRef = useRef<(answer: string, force: boolean) => void>(() => {});
  /** Mirrors of `selected`/`pendingAnswer` for the forced pick at time-out.
   * A ref, not state, because the clock reads it from an interval closure that
   * would otherwise be re-created on every keystroke. */
  const selectedRef = useRef<string | null>(null);
  const pendingAnswerRef = useRef<string | null>(null);
  // A spectator is a player in a team game who has no team assigned. The server
  // rejects their POST /game/answer/ with 403 and ignores them in settlement, so
  // the UI must not offer them an answer path in the first place.
  //
  // Declared up here rather than beside `myTeam` because the auto-advance effect
  // needs it in its dependency array, which is evaluated during render.
  const spectator = isSpectating || (!!teamMode && !myTeamId);

  /**
   * The order this screen walks through.
   *
   * Classic mode gives every player their own shuffled order, so it reads the
   * player's document. Team mode gives the WHOLE ROOM one question at a time,
   * and the room's index is the only index that means anything -- a per-player
   * order here would put teammates on different questions, which is the thing
   * team mode exists to stop.
   */
  const effectiveOrder = teamMode ? questions.map((_, i) => i) : questionOrder;

  // ✨ UPDATED: RNAnimated refs
  const standingsAnim = useRef(new RNAnimated.Value(0)).current;
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());
  const standingsUnsubRef = useRef<(() => void) | null>(null);
  const roomUnsubRef = useRef<(() => void) | null>(null);
  // The players snapshot effect closes over mount-time values, so the
  // subscription cannot read `userId` from state to find our own document.
  const myDocIdRef = useRef<string | null>(null);
  const previousStateRef = useRef<{ [id: string]: { rank: number; score: number } }>({});
  const pendingStandingsRef = useRef<any[] | null>(null);
  const throttleTimerRef = useRef<any>(null);
  const lastFlushAtRef = useRef<number>(0);
  const bootedRef = useRef(false);
  const navigatedRef = useRef(false);
  const lanPlayersRef = useRef<LanPlayer[]>([]);
  const lanPrevStandingsRef = useRef<Record<string, { rank: number; score: number }>>({});
  const lanSubmittedRef = useRef(false);
  // Row id of the saved offline/LAN session, handed to the results screen so it
  // can read the questions and answer log back.
  const lanSavedIdRef = useRef(0);
  const lcRef = useRef<ReturnType<typeof getLanClient>>(null);
  const applyLanLeaderboardRef = useRef<(players: LanPlayer[]) => void>(() => {});
  const finalizeLanGameRef = useRef<() => void>(() => {});

  // ✨ UPDATED: RNAnimated refs for card/result/timerBar
  const cardTranslateX = useRef(new RNAnimated.Value(0)).current;
  const cardRotateY = useRef(new RNAnimated.Value(0)).current;
  const cardOpacity = useRef(new RNAnimated.Value(1)).current;
  const resultFlipAnim = useRef(new RNAnimated.Value(0)).current;
  const isAnimatingRef = useRef(false);
  const autoAdvanceRef = useRef<number | null>(null);
  const [autoCountdown, setAutoCountdown] = useState(0);
  const timerBarAnim = useRef(new RNAnimated.Value(1)).current;
  const spinTimerRef = useRef<any>(null);
  const revealTimerRef = useRef<any>(null);
  const spinDelayRef = useRef(60);
  const cyclesRef = useRef(0);
  // Session-scoped: the first powerup award of a game gets the full roulette,
  // every later one gets a fast spin. Deliberately not reset per question in
  // handleNext — this tracks "has this player already won one", not "this round".
  const hasWonPowerupRef = useRef(false);

  // ✨ NEW: Timer urgency animation (shake + pulse at ≤5s)
  const urgencyAnim = useSharedValue(0);

  const urgencyStyle = useAnimatedStyle(() => {
    const shakeX = interpolate(
      urgencyAnim.value,
      [0, 0.25, 0.5, 0.75, 1],
      [0, -3, 0, 3, 0]
    );
    const scale = interpolate(
      urgencyAnim.value,
      [0, 0.5, 1],
      [1, 1.08, 1]
    );
    return {
      transform: [{ translateX: shakeX }, { scale }],
    };
  });

  /* ── LAN helpers (live leaderboard + wrap-up) ── */
  const applyLanLeaderboard = (players: LanPlayer[]) => {
    lanPlayersRef.current = players;
    const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
    const mine = getCurrentOfflineGame();
    const rows = sorted.map((p, i) => {
      const prev = lanPrevStandingsRef.current[p.id];
      const isMe = isMyLanPlayer(p);
      return {
        id: isMe ? 'me' : p.id,
        displayName: p.name,
        avatar: p.avatar,
        // Your own row is driven by the local engine. LAN scoring is entirely
        // client-side, so the host's broadcast never carries your live
        // score/streak — prefer the local values and fall back to what the
        // host reported if the engine is somehow gone.
        score: isMe ? (mine?.score ?? p.score ?? 0) : p.score ?? 0,
        streak: isMe ? (mine?.streak ?? 0) : 0,
        movement: 0,
        prevScore: prev ? prev.score : 0,
      };
    });
    lanPrevStandingsRef.current = Object.fromEntries(
      sorted.map((p, i) => [p.id, { rank: i, score: p.score ?? 0 }])
    );
    setStandings(rows);
    const top = rows
      .filter(r => r.movement >= 2)
      .sort((a, b) => b.movement - a.movement)[0];
    setBiggestMover(top ? { name: top.id === 'me' ? 'You' : top.displayName, jump: top.movement } : null);
  };

  /**
   * Take the single right to leave this screen.
   *
   * The room listener and the local finish handler can both decide to leave, and
   * POST /game/finish/ makes the server flip the room to 'finished', which
   * streams straight back to that same listener. Whichever path claims first
   * wins; the other becomes a no-op. Claiming after the request instead let
   * both through, which mounted the results screen twice and replayed the
   * podium animation over the top of it.
   */
  const claimNav = () => {
    if (navigatedRef.current) return false;
    navigatedRef.current = true;
    return true;
  };

  const finalizeLanGame = async () => {
    if (!claimNav()) return;
    const game = getCurrentOfflineGame();
    const lc = lcRef.current ?? getLanClient();
    if (game && lc && !lanSubmittedRef.current) {
      lanSubmittedRef.current = true;
      lc.submitResult({
        quizId: game.quizId,
        quizTitle: game.quizTitle,
        quizType: game.quizType,
        timePerQuestion: game.timePerQuestion,
        score: game.score,
        correctCount: game.correctCount,
        answeredCount: game.answeredCount,
        totalQuestions: game.totalQuestions,
        answers: answerLogFromOutcomes(game.outcomeLog),
      });
      // Give the host a moment to broadcast the updated leaderboard so the
      // final screen shows every player, not just the local one.
      await new Promise(r => setTimeout(r, 500));
    }
    const myId = getLanPlayerId();
    const list = [...lanPlayersRef.current];
    if (game) {
      const me = {
        id: myId || 'me',
        name: lanGame.playerName || 'You',
        avatar: lanGame.playerAvatar || undefined,
        connected: true,
        finished: true,
        score: game.score ?? 0,
        correctCount: game.correctCount,
        answeredCount: game.answeredCount,
        totalQuestions: game.totalQuestions,
      };
      const idx = myId
        ? list.findIndex(p => p.id === myId)
        : list.findIndex(p => p.name === me.name);
      if (idx >= 0) list[idx] = me;
      else list.push(me);
    }
    setLanFinalStandings(list);
    if (game) {
      try {
        lanSavedIdRef.current = saveOfflineGameResult(game);
      } catch {}
      clearCurrentOfflineGame();
    }
    router.replace({
      pathname: '/game/final',
      params: {
        roomCode: lanGame.roomCode || 'LAN',
        lan: 'true',
        playerId: myId || '',
        offlineId: String(lanSavedIdRef.current),
      },
    } as any);
  };

  applyLanLeaderboardRef.current = applyLanLeaderboard;
  finalizeLanGameRef.current = finalizeLanGame;

  /* ── all useEffects below ── */

  // ✨ NEW: Trigger shake/pulse when timeLeft <= 5 and not frozen
  useEffect(() => {
    if (timeLeft <= 5 && !isFrozen && timeLeft > 0) {
      urgencyAnim.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 150, easing: Easing.linear }),
          withTiming(0, { duration: 150, easing: Easing.linear })
        ),
        -1, // infinite
        false
      );
    } else {
      urgencyAnim.value = withTiming(0, { duration: 200 });
    }
  }, [timeLeft, isFrozen]);

  useEffect(() => {
    const init = async () => {
      if (isOffline || isLan) {
        let game = getCurrentOfflineGame();
        if (!game && isLan && lanGame.quiz) {
          try {
            game = createOfflineGame(lanGame.quiz, lanGame.timePerQuestion, { order: lanGame.order });
          } catch (e) {
            setEngineError(e instanceof Error ? e.message : String(e));
            return;
          }
        }
        if (!game) return;
        setQuestions(game.questions);
        setQuestionOrder(game.questionOrder);
        setTimePerQuestion(game.timePerQuestion);
        setTimeLeft(game.timePerQuestion);
        setRoomStatus('active');
        setUserId('me');
        setPowerups({ ...game.powerups });
        if (isOffline) {
          setStandings([{
            id: 'me',
            displayName: 'You',
            score: game.score,
            streak: game.streak,
            movement: 0,
            prevScore: 0,
          }]);
        } else {
          const roster = getLastLanRoster();
          // Seed the LAN player list so the final standings show everyone,
          // even if no leaderboard broadcast has been received yet. Your own
          // row is seeded with the real local score/streak, remapped to id
          // 'me' so the drawer tags it "(You)".
          lanPlayersRef.current = roster;
          setStandings(roster.length
            ? roster.map(p => {
                const isMe = isMyLanPlayer(p);
                return {
                  id: isMe ? 'me' : p.id,
                  displayName: p.name,
                  avatar: p.avatar,
                  score: isMe ? game.score : 0,
                  streak: isMe ? game.streak : 0,
                  movement: 0,
                  prevScore: 0,
                };
              })
            : []);
        }
        return;
      }
      const user = await getCurrentUser();
      setUserId(user?.id);
      myDocIdRef.current = user?.id != null ? String(user.id) : null;
      const player = await firestore().collection('gameRooms').doc(roomCode)
        .collection('players').doc(String(user?.id)).get();
      setQuestionOrder(player.data()?.questionOrder || []);
      setMyTeamId(player.data()?.teamId ?? null);
      setMyCorrectCount(player.data()?.correctCount ?? 0);
      const pPowerups = player.data()?.powerups;
      if (pPowerups) setPowerups(pPowerups);
    };
    init();

    if (isOffline || isLan) {
      if (isLan) {
        const lc = getLanClient();
        lcRef.current = lc;
        if (lc) {
          lc.onEvent = (msg: LanMessage) => {
            if (msg.t === 'welcome') {
              setLanPlayerId(msg.playerId);
            } else if (msg.t === 'quiz') {
              if (lanGame.quiz && !getCurrentOfflineGame()) {
                try {
                  const g = createOfflineGame(lanGame.quiz, lanGame.timePerQuestion, { order: lanGame.order });
                  setQuestions(g.questions);
                  setQuestionOrder(g.questionOrder);
                  setTimePerQuestion(g.timePerQuestion);
                  setTimeLeft(g.timePerQuestion);
                  setPowerups({ ...g.powerups });
                } catch (e) {
                  setEngineError(e instanceof Error ? e.message : String(e));
                }
              }
            } else if (msg.t === 'leaderboard') {
              applyLanLeaderboardRef.current(msg.players);
            } else if (msg.t === 'end') {
              finalizeLanGameRef.current();
            }
          };
        }
      }
      return;
    }

    /* ── single room listener: boots the game, tracks the shared team question,
           and navigates when the host ends it ── */
    const roomUnsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .onSnapshot(snap => {
        const data = snap.data();
        if (!data) return;
        if (!bootedRef.current) {
          bootedRef.current = true;
          setQuestions(data.questions || []);
          setTimePerQuestion(data.timePerQuestion || 15);
          setTimeLeft(data.timePerQuestion || 15);
          setRoomStatus(data.status || 'waiting');
          setTeamMode(!!data.teamMode);
          const assignments = data.teamAssignments || null;
          setTeamAssignments(assignments);
          setShowTeamReveal(!!(data.teamMode && data.status === 'active' && assignments));
        }
        // The shared question state is re-read on EVERY snapshot, not just at
        // boot: the host advances the room, and a member who is behind has to
        // catch up to the question everyone else is actually answering.
        if (data.teamMode) {
          const index = data.teamQuestionIndex ?? 0;
          setTeamIndex(index);
          setTeamTimeLimit(sharedTimeLimit(data, index));
          setTeamStartedAt(timestampMillis(data.teamStartedAt));
          setRoomOwnerId(String(data.ownerId ?? data.hostId ?? ''));
        }
        if (data.status === 'finished' && claimNav()) {
          setRoomStatus('finished');
          router.replace({ pathname: '/game/final', params: { roomCode } });
        }
      });
    roomUnsubRef.current = roomUnsub;

    /* ── standings listener: throttled to 500ms to limit re-renders ── */
    const flushStandings = () => {
      throttleTimerRef.current = null;
      lastFlushAtRef.current = Date.now();
      const withMovement = pendingStandingsRef.current;
      if (!withMovement) return;
      previousStateRef.current = Object.fromEntries(
        withMovement.map((p, i) => [p.id, { rank: i, score: p.score }])
      );
      const top = withMovement.filter(p => p.movement >= 2).sort((a, b) => b.movement - a.movement)[0];
      setBiggestMover(top ? { name: String(top.id) === String(userId) ? 'You' : top.displayName, jump: top.movement } : null);
      setStandings(withMovement);
    };

    const standingsUnsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        // Our own stats live on the player doc, read here rather than
        // derived from the standings list.
        const mine = myDocIdRef.current ? snap.docs.find(d => d.id === myDocIdRef.current) : undefined;
        if (mine) {
          setMyCorrectCount(mine.data().correctCount ?? 0);
          // Our own answer log. In a team game this is where "did I agree with
          // my team?" comes from: the server writes each member's own pick and
          // whether it matched, and nobody else's.
          setOwnAnswers(mine.data().answers ?? {});
        }
        pendingStandingsRef.current = snap.docs
          .map(d => ({
            id: d.id,
            displayName: d.data().displayName,
            avatar: d.data().avatar,
            score: d.data().score || 0,
            streak: d.data().streak || 0,
            // Carried for the team standings: the averaging denominator is the
            // count of members who have actually answered, and that can only be
            // counted from the roster.
            teamId: d.data().teamId ?? null,
            answeredCount: d.data().answeredCount || 0,
          }))
          .sort((a, b) => b.score - a.score)
          .map((p, i) => {
            const prev = previousStateRef.current[p.id];
            return { ...p, movement: prev ? prev.rank - i : 0, prevScore: prev ? prev.score : p.score };
          });

        const elapsed = Date.now() - lastFlushAtRef.current;
        if (elapsed >= 500) {
          if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
          flushStandings();
        } else if (!throttleTimerRef.current) {
          throttleTimerRef.current = setTimeout(flushStandings, 500 - elapsed);
        }
      });
    standingsUnsubRef.current = standingsUnsub;

    return () => {
      roomUnsub();
      standingsUnsub();
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isOffline || !userId) return;
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(userId))
      .onSnapshot(snap => {
        const p = snap.data();
        const next = p?.powerups;
        if (!next) return;
        setPowerups(prev => {
          if (
            prev.freeze === next.freeze &&
            prev.hint === next.hint &&
            prev.doublePoints === next.doublePoints &&
            prev.shield === next.shield
          ) return prev;
          return next;
        });
      });
    return () => { unsub(); };
  }, [userId]);

  /* ── LAN: live ticker while waiting for quiz/engine ── */
  useEffect(() => {
    if (!isLan || (questions.length > 0 && questionOrder.length > 0)) return;
    const t = setInterval(() => setWaitTimer(w => w + 1), 1000);
    return () => clearInterval(t);
  }, [isLan, questions.length, questionOrder.length]);

  /* ── LAN: detach client handler when leaving the screen ── */
  useEffect(() => {
    if (!isLan) return;
    return () => {
      const c = getLanClient();
      if (c) c.onEvent = () => {};
    };
  }, [isLan]);

  /* ── teams subscription (team mode only) ── */
  useEffect(() => {
    if (!teamMode) {
      setTeams([]);
      return;
    }
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('teams')
      .onSnapshot(snap => {
        setTeams((snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? []) as TeamEntry[]);
      });
    return () => { unsub(); };
  }, [teamMode, roomCode]);

  /* ── teammates subscription: the boost strip needs names to aim at ── */
  useEffect(() => {
    if (!teamMode || !myTeamId || isLan || isOffline) {
      setTeammates([]);
      return;
    }
    const unsub = firestore()
      .collection('gameRooms').doc(roomCode)
      .collection('players')
      .onSnapshot(snap => {
        setTeammates(
          (snap?.docs ?? [])
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((p: any) => sameTeamId(p.teamId, myTeamId) && !p.isFinished)
            .map((p: any) => ({ id: p.id, displayName: p.displayName, avatar: p.avatar }))
        );
      });
    return () => unsub();
  }, [teamMode, myTeamId, roomCode, isLan, isOffline]);

  useEffect(() => {
    if (!showRoulette || !rouletteTarget) return;
    setRoulettePhase('spinning');
    spinDelayRef.current = 60;
    cyclesRef.current = 0;

    // A powerup is now guaranteed on every 3rd consecutive correct answer, so
    // the full ~6s roulette would fire on a large share of the remaining
    // questions. The first award keeps the full drama; repeat awards (which
    // the player is now expecting) spin fast and get out of the way.
    const isRepeatAward = hasWonPowerupRef.current;
    hasWonPowerupRef.current = true;
    const totalCycles = isRepeatAward ? 4 : 18;
    const revealHoldMs = isRepeatAward ? 800 : 2000;

    const tick = () => {
      cyclesRef.current++;
      if (cyclesRef.current >= totalCycles) {
        const targetIdx = POWERUP_ITEMS.findIndex(i => i.key === rouletteTarget);
        setSpinIndex(targetIdx);
        setRoulettePhase('revealed');
        revealTimerRef.current = setTimeout(() => {
          setShowRoulette(false);
          setRouletteTarget(null);
          setRoulettePhase('idle');
        }, revealHoldMs);
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
    // Team mode is driven by the ROOM's clock, not a local one: every member
    // counts down to the same `teamStartedAt`, so a member who joins late cannot
    // be handed extra time and a member whose phone slept does not stall
    // anyone else. The local interval below deliberately skips team play.
    if (!teamMode || questions.length === 0 || showTeamReveal) return;
    if (teamStartedAt == null) return;
    startTimeRef.current = teamStartedAt;

    const tick = () => {
      const elapsed = (Date.now() - teamStartedAt) / 1000;
      const left = Math.max(0, Math.ceil(teamTimeLimit - elapsed));
      setTimeLeft(left);
      if (left <= 0 && !teamForceSentRef.current) {
        // The shared clock is the server's to enforce: this claims expiry, and
        // the server decides from its own clock whether the round really is
        // over. If it is not, the pending pick stays pending.
        //
        // Resend the LOCKED pick, never a blank one: a forced submit overwrites
        // this member's slot in the tally, so a blank here would erase a choice
        // they already made and under-count the quorum. Blank is only correct
        // for someone who never chose anything.
        teamForceSentRef.current = true;
        teamPickRef.current(selectedRef.current ?? pendingAnswerRef.current ?? '', true);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => clearInterval(timerRef.current);
  }, [teamMode, teamStartedAt, teamTimeLimit, teamIndex, questions.length, showTeamReveal]);

  // A new shared question resets everything the last one left behind.
  useEffect(() => {
    if (!teamMode) return;
    teamForceSentRef.current = false;
    setCurrentIndex(teamIndex);
    selectedRef.current = null;
    pendingAnswerRef.current = null;
    setSelected(null);
    setPendingAnswer(null);
    setResult(null);
    setTeamPickCount({ picked: 0, expected: 0 });
    setTypedAnswer('');
    setBoxChars([]);
    setIsFrozen(false);
    setShowStandings(false);
    standingsAnim.setValue(0);
    setActivePowerups({ hint: false, doublePoints: false, shield: false });
    setHintedChoices([]);
    setShowRoulette(false);
    setRouletteTarget(null);
    setRoulettePhase('idle');
  }, [teamMode, teamIndex]);

  useEffect(() => {
    if (questions.length === 0 || showTeamReveal || teamMode) return;
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
  }, [currentIndex, questions, showTeamReveal, teamMode]);

  useEffect(() => {
    // In team play the shared countdown runs against the ROOM's limit for this
    // question, not the room-wide default, so the bar drains the same length of
    // time the server will.
    const limit = teamMode ? teamTimeLimit : timePerQuestion;
    const target = limit > 0 ? timeLeft / limit : 0;
    // ✨ UPDATED: RNAnimated
    RNAnimated.timing(timerBarAnim, {
      toValue: target,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [timeLeft, isFrozen, teamMode, teamTimeLimit, timePerQuestion]);

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
    // ✨ UPDATED: RNAnimated
    RNAnimated.parallel([
      RNAnimated.spring(cardTranslateX, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
      RNAnimated.timing(cardRotateY, { toValue: 0, duration: 350, useNativeDriver: true }),
      RNAnimated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start(() => { isAnimatingRef.current = false; });
  }, [currentIndex]);

  useEffect(() => {
    if (result) {
      if (Platform.OS !== 'web') {
        if (result.correct) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      resultFlipAnim.setValue(0);
      // ✨ UPDATED: RNAnimated
      RNAnimated.timing(resultFlipAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [result]);

  /* ── auto-advance: countdown then skip ── */
  useEffect(() => {
    // A spectator never sets `result`, but they still need to be carried forward
    // or the game would sit on question one for them forever.
    if (!result && !spectator) { setAutoCountdown(0); return; }

    // If the powerup roulette is already showing, pause the countdown
    // so the reward is actually visible before we auto-advance. The
    // roulette timer will later clear showRoulette, at which point this
    // effect re-runs and the countdown resumes.
    if (showRoulette) { setAutoCountdown(0); return; }

    const isLast = currentIndex + 1 >= effectiveOrder.length;
    // The 2s default is the "you already answered this" skip. A spectator has
    // nothing to answer, so they get a real read of the question instead.
    const total = spectator ? 5 : (isLast ? 3 : 2);
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
  }, [result, showRoulette, spectator]);

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
    if (selected || isFrozen || freezeBusy) return;
    if (!isOffline && !isLan) {
      const poolFreeze = teamMode ? pool.freeze : powerups.freeze;
      if (poolFreeze <= 0) return;
    }
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    if (isOffline || isLan) {
      const game = getCurrentOfflineGame();
      if (!game || !game.consumePowerup('freeze')) return;
      clearInterval(timerRef.current);
      setIsFrozen(true);
      setPowerups({ ...game.powerups });
      return;
    }
    // The charge is decided by the server, not here: in team mode a freeze
    // comes out of the shared pool, and the count must never be able to go
    // negative. Only stop the clock once the backend confirms the spend.
    setFreezeBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/powerups/freeze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode, questionIndex: currentIndex }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not freeze the timer');
      clearInterval(timerRef.current);
      setIsFrozen(true);
      // In team mode the shared pool is a live Firestore team doc, so the
      // server's decrement arrives on its own. Only the personal pool is
      // local state that needs to be updated here.
      if (!teamMode) {
        setPowerups(p => ({ ...p, freeze: Math.max(0, p.freeze - 1) }));
      }
    } catch (e: any) {
      Alert.alert('Freeze failed', e?.message || 'Could not freeze the timer');
    } finally {
      setFreezeBusy(false);
    }
  };

  const myTeam = teamMode ? teams.find(t => sameTeamId(t.id, myTeamId)) ?? null : null;
  // Rank by average per active member, matching the server. A teammate who has
  // not answered yet must not push their team up the table.
  //
  // Mid-game there is no settled `rankScore` yet, so the denominator has to be
  // counted live off the roster. Left to read `score` alone this ranked a
  // three-person team against a one-person team on raw totals, which is the
  // same thing the results screen was fixed for.
  const activeByTeam = activeMembersByTeam(
    (standings as any[]).map(r => ({ teamId: r.teamId, answeredCount: r.answeredCount })),
  );
  const sortedTeams = [...teams].sort(
    (a, b) => teamRankValue(b, activeByTeam[String(b.id)]) - teamRankValue(a, activeByTeam[String(a.id)]),
  );
  const myTeamRank = sortedTeams.findIndex(t => sameTeamId(t.id, myTeamId)) + 1;
  // Team mode spends from the team's shared pool; classic/offline/LAN from the
  // personal one. One source of truth for both the buttons and their guards,
  // so a teammate's award cannot leave this player tapping a dead button.
  const pool = (teamMode && myTeam ? myTeam.powerups : powerups) ?? powerups;

  /* ── team mode: the shared quorum count and the team's reveal ──
   *
   * Two things arrive here that a member cannot get from their own pick
   * response, because that response only ever goes back to whoever submitted
   * last:
   *
   *  1. `pickCount`, a bare number on the team document. Every member watches
   *     it, so the "3 of 4 in" strip is live for the whole team rather than
   *     frozen at whatever the submitter's response said. It carries no ids and
   *     no choices -- the picks live in the server-only collection, so nobody
   *     can work out who is holding the room up.
   *  2. `reveals.q{n}`, the team's single resolved answer. Without it a member
   *     who picked early and then waited had no way to learn the outcome: their
   *     pending request had already been answered, and the only thing left to
   *     them was the next question arriving.
   */
  useEffect(() => {
    if (!teamMode || !myTeam) return;
    const expected = myTeam.memberCount || myTeam.memberIds?.length || 0;
    setTeamPickCount({ picked: myTeam.pickCount ?? 0, expected });

    const reveal = myTeam.reveals?.[`q${teamIndex}`] ?? null;
    if (!reveal) return;
    // Only ever fill a gap: the member who submitted last already has the exact
    // payload from their own response, including the powerup award.
    setResult(prev => prev ?? {
      correct: reveal.correct,
      correctAnswer: reveal.correctAnswer,
      points: reveal.points,
      speedBonus: reveal.speedBonus,
      multiplier: reveal.multiplier,
      picked: ownAnswers?.[`q${teamIndex}`]?.picked ?? selectedRef.current ?? '',
      teamAnswer: reveal.answer,
      agreed: reveal.agreed,
      iAgreed: ownAnswers?.[`q${teamIndex}`]?.agreed ?? false,
      pickers: reveal.pickers,
      voided: reveal.void,
    });
  }, [teamMode, myTeam, teamIndex, ownAnswers]);
  // Classic has no team document to hang the pool HUD on, so synthesize one
  // from the player's own stats. Feeding PowerupPoolHUD the same shape it
  // already renders for a team is what makes the solo pool read identically
  // instead of looking like a different game.
  const poolTeam: TeamEntry | null = teamMode
    ? myTeam
    : {
        id: 'me',
        name: 'Your powerups',
        color: '#F59E0B',
        score: 0,
        correctCount: myCorrectCount,
        answeredCount: 0,
        memberIds: [],
        memberCount: 1,
        teamCorrect: myCorrectCount,
        teamStreak: 0,
        bestStreak: 0,
        powerups,
      };
  const hasPoolPowerups = pool.freeze > 0 || pool.hint > 0 || pool.doublePoints > 0 || pool.shield > 0;

  // In team mode the pool belongs to the team and the server spends from it
  // inside the answer transaction (via the useHint/useDoublePoints/useShield
  // flags). The old client-side `increment(-1)` on the player doc is skipped
  // there, otherwise the same powerup would be charged twice.
  const spendLocally = async (key: PowerupKey) => {
    setPowerups(p => ({ ...p, [key]: Math.max(0, p[key] - 1) }));
    if (teamMode) return;
    const user = await getCurrentUser();
    firestore().collection('gameRooms').doc(roomCode)
      .collection('players').doc(String(user?.id))
      .update({ [`powerups.${key}`]: firestore.FieldValue.increment(-1) });
  };

  const handleHint = async () => {
    if (pool.hint <= 0 || selected || activePowerups.hint) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    if (isOffline || isLan) {
      const game = getCurrentOfflineGame();
      if (!game || !game.consumePowerup('hint')) return;
      setPowerups({ ...game.powerups });
      setActivePowerups(p => ({ ...p, hint: true }));
      const q = questions[effectiveOrder[currentIndex]];
      if (q?.type === 'mcq' && q.choices) {
        const wrong = q.choices.filter((c: string) => c !== q.correctAnswer);
        const shuffled = wrong.sort(() => Math.random() - 0.5);
        setHintedChoices(shuffled.slice(0, 2));
      }
      return;
    }
    setActivePowerups(p => ({ ...p, hint: true }));
    const q = questions[effectiveOrder[currentIndex]];
    if (q?.type === 'mcq' && q.choices) {
      const wrong = q.choices.filter((c: string) => c !== q.correctAnswer);
      const shuffled = wrong.sort(() => Math.random() - 0.5);
      setHintedChoices(shuffled.slice(0, 2));
    }
    await spendLocally('hint');
  };

  const handleDoublePoints = async () => {
    if (pool.doublePoints <= 0 || selected || activePowerups.doublePoints) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    if (isOffline || isLan) {
      const game = getCurrentOfflineGame();
      if (!game || !game.consumePowerup('doublePoints')) return;
      setPowerups({ ...game.powerups });
      setActivePowerups(p => ({ ...p, doublePoints: true }));
      return;
    }
    setActivePowerups(p => ({ ...p, doublePoints: true }));
    await spendLocally('doublePoints');
  };

  const handleShield = async () => {
    if (pool.shield <= 0 || selected || activePowerups.shield) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    if (isOffline || isLan) {
      const game = getCurrentOfflineGame();
      if (!game || !game.consumePowerup('shield')) return;
      setPowerups({ ...game.powerups });
      setActivePowerups(p => ({ ...p, shield: true }));
      return;
    }
    setActivePowerups(p => ({ ...p, shield: true }));
    await spendLocally('shield');
  };

  const handleBoost = async (targetId: string) => {
    if (!teamMode || boostingId) return;
    setBoostingId(targetId);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/teams/boost/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode, playerId: String(targetId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send boost');
      setBoostedName(data.boostTarget === String(targetId)
        ? teammates.find(t => t.id === targetId)?.displayName ?? 'Teammate'
        : null);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Boost failed', e?.message || 'Could not send boost');
    } finally {
      setBoostingId(null);
    }
  };

  /**
   * Lock (or clear) this member's pick, keeping the timer-visible refs in step.
   *
   * `selected`/`pendingAnswer` alone are not enough: the shared clock runs from
   * an interval that closes over an old render, and a forced submit has to know
   * what this member actually chose rather than what some earlier render saw.
   */
  const lockPick = (next: string | null) => {
    selectedRef.current = next;
    setSelected(next);
  };

  /**
   * Record this member's private pick, and read back either "still waiting" or
   * the team's single resolved answer.
   *
   * Everything about the outcome is decided server-side: the tally, the score,
   * the reveal and even whether the clock really expired. A pending response
   * means the pick is locked in and a teammate has not answered yet -- the
   * screen must NOT show a result, because there is not one yet, and must not
   * show what anyone picked, because that is private.
   */
  const submitTeamPick = async (answer: string, force: boolean) => {
    if (isOffline || isLan || spectator) return;
    try {
      const token = await getToken();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API_BASE_URL}/game/teams/pick/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          roomCode,
          questionIndex: teamIndex,
          answer,
          // Time is measured from the ROOM's start stamp, not from when this
          // screen happened to mount, so a late joiner cannot claim a fast
          // answer they did not make.
          timeTaken: teamStartedAt != null ? (Date.now() - teamStartedAt) / 1000 : teamTimeLimit,
          force: force ? 'true' : 'false',
          useHint: activePowerups.hint ? 'true' : 'false',
          useDoublePoints: activePowerups.doublePoints ? 'true' : 'false',
          useShield: activePowerups.shield ? 'true' : 'false',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 403 && /team|spectator/i.test(data.error || '')) {
          setIsSpectating(true);
          lockPick(null);
          pendingAnswerRef.current = null;
          setPendingAnswer(null);
          return;
        }
        // "Time is still on the clock": our countdown and the server's disagreed
        // (a slow request, a clock skew). Nothing was charged and the pick stays
        // valid, so just keep waiting -- the next tick tries again.
        if (res.status === 400 && data.pending) {
          // Allow another forced attempt: the server simply says the round has
          // not closed yet, and the next tick of a still-running clock may.
          teamForceSentRef.current = false;
          return;
        }
        // Stale question: the room moved on without us. The room listener pulls
        // us onto the current one, and the local card is reset by that effect.
        if (res.status === 409) {
          setError(null);
          lockPick(null);
          pendingAnswerRef.current = null;
          setPendingAnswer(null);
          setTeamPickCount(null);
          setResult(null);
          return;
        }
        throw new Error(data.error || `Server error ${res.status}`);
      }

      if (data.pending) {
        // Locked in, waiting on the rest of the team. No result, no reveal.
        setTeamPickCount({ picked: data.picked ?? 0, expected: data.expected ?? 0 });
        setError(null);
        return;
      }

      setTeamPickCount(null);
      setResult({
        correct: !!data.correct,
        correctAnswer: data.correctAnswer,
        points: data.pointsAwarded ?? 0,
        speedBonus: data.speedBonus ?? 0,
        picked: answer,
        teamAnswer: data.answer ?? '',
        agreed: data.agreed ?? 0,
        iAgreed: data.void ? true : !!answer && answer === (data.answer ?? ''),
        pickers: data.pickers ?? 0,
        voided: !!data.void,
      });
      if (data.powerupEarned) {
        setShowRoulette(true);
        setRouletteTarget(data.powerupEarned);
      }
    } catch (e: any) {
      console.error(e);
      const msg = e.name === 'AbortError'
        ? 'Server timed out. Check your connection and try again.'
        : e.message || 'Network error. Check your connection.';
      // A pick that never reached the server must not look like a scored one.
      // It can be re-sent: the server treats a member's own pick as idempotent.
      setError(msg);
      lockPick(null);
      pendingAnswerRef.current = answer || null;
      setPendingAnswer(answer || null);
      teamForceSentRef.current = false;
    }
  };
  teamPickRef.current = (answer, force) => { void submitTeamPick(answer, force); };

  /**
   * Move the room on to the next shared question.
   *
   * The room owns the index, so this is a request rather than a local
   * increment: advancing only this screen is what used to leave a member
   * answering a question nobody else could see. The server refuses the step
   * while the current question is still open, so a member cannot skip it for
   * everyone else.
   */
  const advanceTeamQuestion = async () => {
    if (isOffline || isLan) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/teams/advance/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode, questionIndex: teamIndex + 1 }),
      });
      await res.json().catch(() => ({}));
      // Every outcome here is fine: 200 moved the room, 409 means somebody else
      // already did (or the round is still open, and the next attempt will
      // land). The room listener is what actually moves this screen.
      return res.ok;
    } catch {
      return false;
    }
  };

  /**
   * End of a team game.
   *
   * Everyone votes that they are done; only the room OWNER actually settles it.
   * Navigation is left to the room listener, which fires when the server has
   * really closed the room -- a member who votes must not be dropped onto a
   * results screen for a game that is still running.
   */
  const finishTeamGame = async () => {
    try {
      const token = await getToken();
      const isOwner = roomOwnerId != null && String(roomOwnerId) === String(userId);
      await fetch(`${API_BASE_URL}/game/finish/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ roomCode, confirm: isOwner ? 'true' : 'false' }),
      });
    } catch {
      // Never strand the player on a dead card; the host can still end it.
    }
  };

  const handleAnswer = async (answer: string | null) => {
    if (selected || spectator) return;
    if (teamMode) {
      // Team play submits a private PICK, not an answer: the team has one
      // answer and the server tallies it. Nothing here decides the outcome.
      clearInterval(timerRef.current);
      lockPick(answer || '');
      pendingAnswerRef.current = answer;
      setPendingAnswer(answer);
      setError(null);
      await submitTeamPick(answer || '', false);
      return;
    }
    clearInterval(timerRef.current);
    lockPick(answer || '');
    pendingAnswerRef.current = answer;
    setPendingAnswer(answer);
    setError(null);
    const timeTaken = (Date.now() - startTimeRef.current) / 1000;
    const actualIndex = effectiveOrder[currentIndex];
    if (isOffline || isLan) {
      const game = getCurrentOfflineGame();
      if (!game) return;
      const outcome = game.answer(actualIndex, answer || '', timeTaken, {
        useHint: activePowerups.hint,
        useDoublePoints: activePowerups.doublePoints,
        useShield: activePowerups.shield,
      });
      setResult({
        correct: outcome.correct,
        correctAnswer: outcome.correctAnswer,
        points: outcome.pointsAwarded,
        speedBonus: outcome.speedBonus,
        picked: outcome.picked,
      });
      setPowerups({ ...game.powerups });
      setMyCorrectCount(game.correctCount);
      if (isOffline) {
        setStandings([{
          id: 'me',
          displayName: 'You',
          score: game.score,
          streak: game.streak,
          movement: 0,
          prevScore: 0,
        }]);
      } else {
        // LAN: only your own row moves. Everyone else stays on the roster
        // until the host broadcasts a leaderboard at the end of the game.
        // Matching on name as well as id makes the row self-heal if the seed
        // ran before 'welcome' gave us a player id to compare against.
        setStandings(prev => prev.map(r =>
          (r.id === 'me' || r.displayName === lanGame.playerName)
            ? { ...r, id: 'me', score: game.score, streak: game.streak }
            : r
        ));
      }
      if (outcome.powerupEarned) {
        setShowRoulette(true);
        setRouletteTarget(outcome.powerupEarned);
      }
      return;
    }
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
        // The server decides who may compete. If it says this player has no
        // team, drop into watch-only rather than letting them retry into
        // another 403.
        if (res.status === 403 && /team/i.test(err.error || '')) {
          setIsSpectating(true);
          selectedRef.current = null;
          pendingAnswerRef.current = null;
          setSelected(null);
          setPendingAnswer(null);
          setError(null);
          return;
        }
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setResult({
        correct: !!data.correct,
        correctAnswer: data.correctAnswer,
        points: data.pointsAwarded ?? 0,
        speedBonus: data.speedBonus ?? 0,
        picked: answer || '',
      });
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

  const handleRetry = () => {
    if (!pendingAnswer) return;
    setError(null);
    handleAnswer(pendingAnswer);
  };

  const toggleStandings = () => {
    const toValue = showStandings ? 0 : 1;
    setShowStandings(!showStandings);
    // ✨ UPDATED: RNAnimated
    RNAnimated.spring(standingsAnim, { toValue, friction: 8, tension: 60, useNativeDriver: true }).start();
  };

  const handleNext = async () => {
    if (teamMode && !isOffline && !isLan) {
      if (teamIndex + 1 >= questions.length) {
        await finishTeamGame();
        return;
      }
      // The room owns the index: ask it to move, and let the room listener pull
      // this screen onto whatever question the team is actually on.
      await advanceTeamQuestion();
      return;
    }
    if (currentIndex + 1 >= effectiveOrder.length) {
      if (isLan) {
        finalizeLanGameRef.current();
        return;
      }
      if (isOffline) {
        const game = getCurrentOfflineGame();
        // The results screen reads the questions and the answer log back out of
        // this row, so the id has to travel with the navigation.
        const savedId = game ? saveOfflineGameResult(game) : 0;
        clearCurrentOfflineGame();
        if (!claimNav()) return;
        router.replace({
          pathname: '/game/final',
          params: {
            roomCode: 'OFFLINE',
            offline: 'true',
            offlineId: String(savedId),
            quizTitle: params.quizTitle || game?.quizTitle || '',
            score: String(game?.score ?? 0),
            correctCount: String(game?.correctCount ?? 0),
            totalQuestions: String(game?.totalQuestions ?? 0),
          },
        });
        return;
      }
      // Claim before the request goes out. The finish call makes the server flip the
      // room to 'finished', which arrives back on the room listener above; taking
      // the claim first means that listener loses the race instead of winning it.
      // Losing the claim means the room already settled, so this call is redundant.
      if (!claimNav()) return;
      try {
        const token = await getToken();
        await fetch(`${API_BASE_URL}/game/finish/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ roomCode }),
        });
      } catch {
        // Never strand the player on a dead question card if the call fails.
      }
      router.replace({ pathname: '/game/final', params: { roomCode } });
      return;
    }
    isAnimatingRef.current = true;
    // ✨ UPDATED: RNAnimated
    RNAnimated.parallel([
      RNAnimated.timing(cardTranslateX, { toValue: -SCREEN_WIDTH * 0.9, duration: 300, useNativeDriver: true }),
      RNAnimated.timing(cardRotateY, { toValue: -14, duration: 300, useNativeDriver: true }),
      RNAnimated.timing(cardOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      cardTranslateX.setValue(SCREEN_WIDTH * 0.85);
      cardRotateY.setValue(12);
      cardOpacity.setValue(0);
      setCurrentIndex(i => i + 1);
      setSelected(null);
      setResult(null);
      setTypedAnswer('');
      setPendingAnswer(null);
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
        {isLan ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={COLORS.purplePrimary} />
            <Text style={styles.waitingTitle}>
              {engineError ? 'Could not start the game' : `Waiting for host (${waitTimer}s)`}
            </Text>
            <Text style={styles.waitingSub}>
              {engineError ? 'Ask the host to start, then rejoin.' : 'Receiving the quiz…'}
            </Text>
            {engineError && <Text style={styles.waitingError}>{engineError}</Text>}
            {waitTimer >= 12 && !engineError && (
              <Text style={styles.waitingWarn}>Still waiting — check everyone is on the same Wi-Fi.</Text>
            )}
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (!claimNav()) return;
                router.replace('/(tabs)/games' as any);
              }}
            >
              <Text style={styles.backButtonText}>Back to Game Center</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.loadingText}>Loading questions...</Text>
        )}
      </View>
    );
  }

  const actualIndex = questionOrder[currentIndex];
  const question = questions[actualIndex];
  const playerRank = standings.findIndex(p => String(p.id) === String(userId)) + 1;
  const isDanger = !isFrozen && timeLeft <= 5;
  const visibleChoices = question.type === 'mcq'
    ? question.choices.filter((c: string) => !hintedChoices.includes(c))
    : [];
  // In team play the room owns the question order, so "last" is a fact about the
  // room's index rather than about this screen's own shuffle.
  const isLastQuestion = (teamMode ? teamIndex : currentIndex) + 1 >= (effectiveOrder.length || questions.length);
  // Only the room's OWNER can settle a team game; everyone else is voting that
  // they are done. Saying so on the button stops a member from tapping "Finish"
  // and expecting the game to end.
  const isRoomOwner = roomOwnerId != null && String(roomOwnerId) === String(userId);
  const nextLabel = teamMode
    ? (isLastQuestion ? (isRoomOwner ? 'End game 🏁' : 'Done — waiting for host') : 'Next →')
    : (isLastQuestion ? 'Finish 🏁' : 'Next →');

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <KeyboardSafeView
      style={styles.container}
    >
      <View style={[styles.container, styles.containerSafe, { paddingTop: insets.top + 16 }]}>
      {/* ── frozen screen tint ── */}
      {isFrozen && <View style={styles.frozenTint} pointerEvents="none" />}

      {/* ── HEADER ROW ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.progressText}>
            <Text style={styles.progressCurrent}>{currentIndex + 1}</Text>
            {' / '}
            {effectiveOrder.length || questions.length}
          </Text>
          {myTeam && (
            <View style={[styles.teamPill, { borderColor: myTeam.color + '66', backgroundColor: myTeam.color + '14' }]}>
              <View style={[styles.teamPillDot, { backgroundColor: myTeam.color }]} />
              <Text style={styles.teamPillName} numberOfLines={1}>{myTeam.name}</Text>
              <Text style={[styles.teamPillScore, { color: myTeam.color }]}>{(myTeam.score ?? 0).toLocaleString()}</Text>
            </View>
          )}
        </View>

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

        {/* ✨ NEW: Wrapped timer badge in Reanimated Animated.View with urgencyStyle */}
        <Animated.View style={[
          styles.timerBadge,
          isFrozen && styles.timerBadgeFrozen,
          isDanger && styles.timerBadgeDanger,
          urgencyStyle,
        ]}>
          <Text style={[
            styles.timerBadgeText,
            isFrozen && styles.timerBadgeTextFrozen,
            isDanger && styles.timerBadgeTextDanger,
          ]}>
            {isFrozen ? '❄️ FROZEN' : `${timeLeft}s`}
          </Text>
        </Animated.View>
      </View>

      {/* ── TIMER PROGRESS BAR (smooth animated) ── */}
      <View style={styles.timerBarTrack}>
        {/* ✨ UPDATED: RNAnimated */}
        <RNAnimated.View style={[
          styles.timerBarFill,
          isDanger && styles.timerBarFillDanger,
          isFrozen && styles.timerBarFillFrozen,
          { width: timerBarAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]} />
      </View>

      {/* ── POWERUP POOL (team doc, or the player's own in classic) ── */}
      {poolTeam && !spectator && !result && (
        <PowerupPoolHUD
          team={poolTeam}
          pool={pool}
          active={activePowerups}
          shared={teamMode}
        />
      )}

      {/* ── LIVE STANDINGS ──
          Between the powerup pool and the banners: close enough to the question
          to read at a glance, out of the way of the answer options. Hidden while
          the reveal is up, so it never competes with the team result. */}
      {!showTeamReveal && !result && (
        <StandingsTicker
          teams={teams}
          players={standings}
          teamMode={teamMode}
          myUserId={userId != null ? String(userId) : null}
          questionNumber={teamMode ? teamIndex : currentIndex}
          questionCount={questions.length}
        />
      )}

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

      {/* ── SPECTATOR NOTICE ──
          Latched from the server's 403, so this only ever appears when it has
          actually decided this player cannot compete. */}
      {spectator && (
        <View style={styles.spectatorBanner}>
          <Text style={styles.spectatorIcon}>👁</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.spectatorTitle}>Watching only</Text>
            <Text style={styles.spectatorBody}>
              You&rsquo;re not on a team, so you&rsquo;re not scoring. You can follow every question and the standings.
            </Text>
          </View>
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
        {/* ✨ UPDATED: RNAnimated */}
        <RNAnimated.View
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
        </RNAnimated.View>

        {/* ── IN FLIGHT (optimistic) ── */}
        {selected && !result && !error && (
          <View style={styles.processingStrip}>
            {teamMode ? (
              <>
                {/* Not "Checking answer...": there is no answer to check yet. The
                    pick is locked in and the team is deciding. The count comes
                    from the team's published `pickCount`, so it is live for
                    everyone rather than frozen at what the submitter saw -- and
                    it is a bare number, so nobody can tell WHO is still out. */}
                <Text style={styles.processingText}>
                  {teamPickCount && teamPickCount.expected > 0 && teamPickCount.picked >= teamPickCount.expected
                    ? "Locked in \u00b7 deciding your team's answer..."
                    : `Locked in \u00b7 ${teamPickCount?.picked ?? 1} of ${teamPickCount?.expected ?? '\u2013'} picked`}
                </Text>
                {!!teamPickCount?.expected && (
                  <View style={styles.quorumDots}>
                    {Array.from({ length: teamPickCount.expected }).map((_, i) => (
                      <View
                        key={i}
                        style={[styles.quorumDot, i < teamPickCount.picked && styles.quorumDotOn]}
                      />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <ActivityIndicator size="small" color={COLORS.purpleVibrant} />
                <Text style={styles.processingText}>Checking answer...</Text>
              </>
            )}
          </View>
        )}

        {/* ── RESULT STRIP ── */}
        {result && (
          /* ✨ UPDATED: RNAnimated */
          <RNAnimated.View
            style={[
              styles.resultStrip,
              result.correct ? styles.resultStripCorrect : styles.resultStripWrong,
              {
                opacity: resultFlipAnim,
                transform: [{ translateY: resultFlipAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
              },
            ]}
          >
            <View style={styles.resultStripMain}>
              <Text style={styles.resultStripLabel}>
                {teamMode
                  ? (result.voided
                      ? "\U0001f91d Split vote \u2014 no majority, so it scored nothing"
                      : result.correct
                        ? `✅ Team correct!`
                        : `✗ Team answered: ${result.teamAnswer || "\u2014"}`)
                  : (result.correct ? `✅ Correct!` : `✗ Incorrect`)}
              </Text>
              {/* Speed shown as its own line: a single "+840" hides the fact
                  that part of it was earned by being quick, which is the
                  reward the timer is actually asking for. */}
              {result.correct ? (
                <Text style={[styles.resultStripPts, styles.ptsGreen]}>
                  +{result.points}
                  {(result.speedBonus ?? 0) > 0 ? `  (${result.speedBonus} speed)` : ''}
                </Text>
              ) : (
                <Text style={styles.resultAnswerLine}>Answer: {result.correctAnswer}</Text>
              )}
            </View>
            {/* Team mode: what the TEAM picked, and whether this member was part
                of it. Sits outside the label row so the strip stays two clean
                lines. Never who disagreed -- only this member's own position,
                which they already know. */}
            {teamMode && !result.voided && !!result.teamAnswer && (
              <Text style={styles.teamAgreementLine}>
                Team picked: {result.teamAnswer}
                {typeof result.agreed === 'number' ? `  \u00b7  ${result.agreed} agreed` : ''}
              </Text>
            )}
            {teamMode && !result.voided && result.iAgreed != null && (
              <Text style={[styles.teamAgreementLine, styles.teamOwnLine]}>
                {result.iAgreed
                  ? 'You agreed with your team'
                  : 'You did not pick before time ran out'}
              </Text>
            )}
            {!result.correct && question.explanation ? (
              <Text style={styles.resultExplanation}>{question.explanation}</Text>
            ) : null}
          </RNAnimated.View>
        )}

        {/* ── MCQ CHOICES ── */}
        {!spectator && question.type === 'mcq' && (
          <View style={styles.choicesWrap}>
            {visibleChoices.map((choice: string) => {
              const isCorrect = result && choice === result.correctAnswer;
              const isWrongPick = result && choice === selected && !result.correct;
              const isDimmed = result && !isCorrect && choice !== selected;
              const isPending = selected === choice && !result && !error;
              return (
                <TouchableOpacity
                  key={choice}
                  style={[
                    styles.choice,
                    isCorrect && styles.choiceCorrect,
                    isWrongPick && styles.choiceWrong,
                    isDimmed && styles.choiceDimmed,
                    isPending && styles.choicePending,
                  ]}
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleAnswer(choice);
                  }}
                  disabled={!!selected}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.choiceChip,
                    isCorrect && styles.choiceChipCorrect,
                    isWrongPick && styles.choiceChipWrong,
                    isPending && styles.choiceChipPending,
                  ]}>
                    <Text style={[
                      styles.choiceChipText,
                      isCorrect && styles.choiceChipTextCorrect,
                      isWrongPick && styles.choiceChipTextWrong,
                      isPending && styles.choiceChipTextPending,
                    ]}>
                      {isCorrect ? '✓' : isWrongPick ? '✗' : letterOf(choice)}
                    </Text>
                  </View>
                  <Text style={[
                    styles.choiceText,
                    isCorrect && styles.choiceTextCorrect,
                    isWrongPick && styles.choiceTextWrong,
                    isPending && styles.choiceTextPending,
                  ]}>
                    {textOf(choice)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── IDENTIFICATION INPUT ── */}
        {!spectator && question.type === 'identification' && (
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
                onPress={() => {
                  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleAnswer(joinWithSpaces(boxChars));
                }}
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
          /* ✨ UPDATED: RNAnimated */
          <RNAnimated.View
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
                isLastQuestion ? styles.nextBtnFinish : styles.nextBtnAccent,
              ]}
              onPress={() => { if (autoAdvanceRef.current !== null) { clearInterval(autoAdvanceRef.current); autoAdvanceRef.current = null; } handleNext(); }}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.nextBtnText,
                isLastQuestion ? styles.nextBtnTextFinish : styles.nextBtnTextAccent,
              ]}>
                {nextLabel}
              </Text>
              {autoCountdown > 0 && (
                <Text style={styles.nextBtnCountdown}>{autoCountdown}s</Text>
              )}
            </TouchableOpacity>
          </RNAnimated.View>
        )}
      </ScrollView>

      {/* ── BOOST A TEAMMATE ── */}
      {teamMode && !result && !isOffline && !isLan && (pool.doublePoints > 0 || boostedName) && (
        <View style={styles.boostWrap}>
          <View style={styles.boostLabelRow}>
            <Ionicons name="flash" size={11} color={COLORS.textMuted} />
            <Text style={styles.boostLabel}>BOOST A TEAMMATE · 2x THEIR NEXT ANSWER</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.boostRow}>
            {teammates
              .filter(t => userId == null || String(t.id) !== String(userId))
              .map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.boostChip}
                  onPress={() => handleBoost(t.id)}
                  disabled={!!boostingId}
                  activeOpacity={0.7}
                >
                  {pfpSource(t.avatar) ? (
                    <Image source={pfpSource(t.avatar)!} style={styles.boostAvatar} resizeMode="cover" />
                  ) : (
                    <View style={styles.boostAvatarFallback}>
                      <Text style={styles.boostInitial}>{(t.displayName || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.boostName} numberOfLines={1}>{t.displayName}</Text>
                </TouchableOpacity>
              ))}
            {teammates.filter(t => userId == null || String(t.id) !== String(userId)).length === 0 && (
              <Text style={styles.boostEmpty}>No teammates left to boost</Text>
            )}
          </ScrollView>
          {boostedName && (
            <Text style={styles.boostSent}>🔥 {boostedName} is boosted — save it for a hard one!</Text>
          )}
        </View>
      )}

      {/* ── REACTION BAR ── */}
      {/* Team mode only. Reactions cheer on a shared team, but in classic
          every player is competing alone, so cheering on other players is
          meaningless rather than supportive. */}
      {!isOffline && !isLan && !result && teamMode && (
        <ReactionBar
          roomCode={roomCode}
          enabled={roomStatus === 'active'}
          myId={userId != null ? String(userId) : null}
          teams={teams}
        />
      )}

      {/* ── POWERUP BAR (pinned bottom) ── */}
{!spectator && !selected && !result && hasPoolPowerups && (
          <View style={styles.powerupBar}>
          {/* Freeze is solo-only. There is no per-player timer in a team game to
              stop -- one shared countdown belongs to everybody -- and the server
              answers a team freeze with 400 `teamTimer: true`. Offering a button
              that is guaranteed to fail is worse than not offering it. */}
          {pool.freeze > 0 && !teamMode && (
            <TouchableOpacity
              style={[styles.puBtn, isFrozen && styles.puBtnFreezeActive]}
              onPress={handleFreeze}
              disabled={!!selected || isFrozen || freezeBusy}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{pool.freeze}</Text></View>
              <Text style={styles.puIcon}>❄️</Text>
              <Text style={[styles.puLabel, isFrozen && styles.puLabelCyan]}>Freeze</Text>
            </TouchableOpacity>
          )}
          {pool.hint > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, activePowerups.hint && styles.puBtnUsed]}
              onPress={handleHint}
              disabled={!!selected || activePowerups.hint}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{pool.hint}</Text></View>
              <Text style={styles.puIcon}>💡</Text>
              <Text style={[styles.puLabel, activePowerups.hint && styles.puLabelYellow]}>Hint</Text>
            </TouchableOpacity>
          )}
          {pool.doublePoints > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, activePowerups.doublePoints && styles.puBtnUsed]}
              onPress={handleDoublePoints}
              disabled={!!selected || activePowerups.doublePoints}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{pool.doublePoints}</Text></View>
              <Text style={styles.puIcon}>⚡</Text>
              <Text style={[styles.puLabel, activePowerups.doublePoints && styles.puLabelYellow]}>2x Pts</Text>
            </TouchableOpacity>
          )}
          {pool.shield > 0 && (
            <TouchableOpacity
              style={[styles.puBtn, activePowerups.shield && styles.puBtnShieldActive]}
              onPress={handleShield}
              disabled={!!selected || activePowerups.shield}
              activeOpacity={0.7}
            >
              <View style={styles.puCountBadge}><Text style={styles.puCountText}>{pool.shield}</Text></View>
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
          {/* ✨ UPDATED: RNAnimated */}
          <RNAnimated.View
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
              {teamMode && (
                <View style={styles.standingsTeamsBlock}>
                  <Text style={styles.standingsBlockLabel}>TEAMS</Text>
                  {sortedTeams.map((t, i) => {
                    const isMyTeam = sameTeamId(t.id, myTeamId);
                    return (
                      <View key={t.id} style={[styles.srRow, i < 3 && styles.srRowTop3, isMyTeam && styles.srRowYou]}>
                        <Text style={styles.srRank}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}</Text>
                        <View style={styles.srNameWrap}>
                          <Text style={[styles.srName, isMyTeam && styles.srNameYou]} numberOfLines={1}>
                            {t.name}
                            {isMyTeam && <Text style={styles.srYouTag}> (You)</Text>}
                          </Text>
                          <Text style={styles.srSub} numberOfLines={1}>
                            {t.teamCorrect ?? 0} correct · {t.memberCount ?? 0} players
                          </Text>
                        </View>
                        <View style={[styles.teamStandDot, { backgroundColor: t.color }]} />
                        <Text style={styles.srScore}>{(t.score ?? 0).toLocaleString()}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              {standings.map((p, i) => (
                <StandingsRow key={p.id} player={p} index={i} isYou={String(p.id) === String(userId)} />
              ))}
            </ScrollView>
          </RNAnimated.View>
        </View>
      )}

      <View style={styles.safeBottom} />
      </View>

      {showTeamReveal && teamAssignments && (
        <TeamRevealOverlay
          assignments={teamAssignments}
          myUserId={userId}
          onComplete={() => setShowTeamReveal(false)}
        />
      )}
    </KeyboardSafeView>
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
  },
  containerSafe: { paddingHorizontal: 20 },
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  teamPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 150,
  },
  teamPillDot: { width: 8, height: 8, borderRadius: 4 },
  teamPillName: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.textPrimary, flexShrink: 1 },
  teamPillScore: { fontSize: 12, fontFamily: FONTS.black },
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

  /* ── processing strip ── */
  processingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.3)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  processingText: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: '#C4B5FD',
  },
  /* Team quorum: one dot per member, filled as their pick lands. Dots rather
     than avatars on purpose -- the count is public, the identities are not. */
  quorumDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  quorumDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(196,181,253,0.25)',
  },
  quorumDotOn: {
    backgroundColor: '#34D399',
  },

  /* ── result strip ── */
  resultStrip: {
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 14,
  },
  // The strip became a column when the explanation was added, so the label and
  // the points share a row of their own instead of sitting on one line.
  resultStripMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultAnswerLine: {
    marginLeft: 12,
    fontSize: 13,
    fontFamily: FONTS.bold,
    color: '#34D399',
  },
  /* The team's own pick and where this member stood on it. */
  teamAgreementLine: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
  },
  /* Brighter than the line above it: whether you backed your team is the whole
     point of the mechanic and should not read as fine print. */
  teamOwnLine: {
    fontFamily: FONTS.bold,
    color: '#C4B5FD',
  },
  resultExplanation: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
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

  /* ── spectator notice ── */
  spectatorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    backgroundColor: 'rgba(148,163,184,0.10)',
  },
  spectatorIcon: { fontSize: 20 },
  spectatorTitle: {
    fontSize: 13,
    fontFamily: FONTS.extraBold,
    color: COLORS.textPrimary,
  },
  spectatorBody: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
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
  choicePending: {
    backgroundColor: 'rgba(139,92,246,0.16)',
    borderColor: 'rgba(167,139,250,0.6)',
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
  choiceChipPending: { backgroundColor: COLORS.purpleVibrant },
  choiceChipText: {
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    color: '#DDD6FE',
  },
  choiceChipTextCorrect: { color: '#fff' },
  choiceChipTextWrong: { color: '#fff' },
  choiceChipTextPending: { color: '#fff' },
  choiceText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.semiBold,
    color: '#E2E8F0',
  },
  choiceTextCorrect: { color: '#34D399' },
  choiceTextWrong: { color: '#F87171' },
  choiceTextPending: { color: '#DDD6FE' },

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
  standingsTeamsBlock: { marginBottom: 10 },
  standingsBlockLabel: {
    fontSize: 10,
    fontFamily: FONTS.extraBold,
    letterSpacing: 2,
    color: COLORS.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  teamStandDot: { width: 10, height: 10, borderRadius: 5 },

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
  srAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(124,58,237,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  srAvatarText: { fontSize: 14, fontFamily: FONTS.bold, color: '#E2E8F0' },
  srNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  srName: { fontSize: 14, fontFamily: FONTS.bold, color: '#E2E8F0' },
  srSub: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 1 },

  boostWrap: { gap: 6 },
  boostLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  boostLabel: { fontSize: 8, fontFamily: FONTS.extraBold, color: COLORS.textMuted, letterSpacing: 0.5 },
  boostRow: { gap: 7, alignItems: 'center', paddingRight: 8 },
  boostChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.surface, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(244,114,182,0.35)',
    paddingLeft: 4, paddingRight: 12, paddingVertical: 4,
  },
  boostAvatar: { width: 24, height: 24, borderRadius: 12 },
  boostAvatarFallback: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(244,114,182,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  boostInitial: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#F472B6' },
  boostName: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, maxWidth: 96 },
  boostEmpty: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted, paddingVertical: 6 },
  boostSent: { fontSize: 10, fontFamily: FONTS.semiBold, color: '#F9A8D4' },
  srNameYou: { color: COLORS.accent },
  srYouTag: { color: COLORS.accent, fontFamily: FONTS.extraBold, fontSize: 12 },
  srStreak: { fontSize: 12 },
  srMoveUp: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#34D399', width: 36, textAlign: 'center' },
  srMoveDown: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#F87171', width: 36, textAlign: 'center' },
  srMoveSame: { fontSize: 11, fontFamily: FONTS.extraBold, color: '#64748B', width: 36, textAlign: 'center' },
  srScore: { fontSize: 16, fontFamily: FONTS.black, color: '#fff', minWidth: 52, textAlign: 'right' },

  /* LAN waiting screen */
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  waitingTitle: { color: COLORS.textPrimary, fontFamily: FONTS.bold, fontSize: 18, marginTop: 20, textAlign: 'center' },
  waitingSub: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 13, marginTop: 6, textAlign: 'center' },
  waitingWarn: { color: '#FBBF24', fontFamily: FONTS.medium, fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20, marginHorizontal: 24 },
  waitingError: { color: '#F87171', fontFamily: FONTS.medium, fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20, marginHorizontal: 24 },
  backButton: { marginTop: 24, backgroundColor: COLORS.purplePrimary, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, alignItems: 'center' },
  backButtonText: { color: COLORS.textPrimary, fontFamily: FONTS.semiBold, fontSize: 14 },
});