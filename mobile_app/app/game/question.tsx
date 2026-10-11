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
import { createOfflineGame, getCurrentOfflineGame, saveOfflineGameResult, clearCurrentOfflineGame, type OfflineParticipant } from '@/services/offlineGameService';
import { getLanClient, lanGame, getLanPlayerId, setLanPlayerId, setLanFinalStandings, getLastLanRoster, getLanHostServer, getLanTeams, setLanTeams, resetLanState } from '@/services/lanSession';
import type { LanMessage, LanPlayer, LanTeam } from '@/services/lanProtocol';
import { useCurrentUser } from '@/contexts/UserContext';
import { API_BASE_URL } from '@/config/api';
import TeamRevealOverlay from '@/components/TeamRevealOverlay';
import { Ionicons } from '@expo/vector-icons';
import PowerupPoolHUD from '@/components/game/PowerupPoolHUD';
import StandingsTicker from '@/components/game/StandingsTicker';
import { answerLogFromOutcomes } from '@/services/gameBreakdown';
import { TYPED_QUESTION_TYPES } from '@/services/offlineEngine';
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

/* ── helper: pull the letter chip out of "A. Paris" ──
 *
 * Both coerce through String: a choice that arrived as a number (or null, from a
 * hand-written or AI-generated question) used to make `charAt` throw and take the
 * whole screen down. A malformed option should cost one chip, not the round. */
const letterOf = (c: unknown) => String(c ?? '').charAt(0);
const textOf = (c: unknown) => String(c ?? '');

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

/**
 * True when two snapshots carry identical content.
 *
 * Used to stop a Firestore listener from handing React a brand-new array for a
 * delivery that changed nothing. Firestore re-delivers the whole document set
 * on metadata changes and on remote events, so rebuilding the array on every
 * delivery made every downstream `useEffect` dep change for no reason. That is
 * not cosmetic here: one of those effects writes `result`, and `result` gates
 * the auto-advance countdown, so an unrelated snapshot silently restarted the
 * countdown and replayed the reveal haptics.
 *
 * JSON comparison is safe for this data: it is plain Firestore JSON with no
 * cycles, and the doc order Firestore returns (by document id) is stable.
 */
function sameSnapshot(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
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
   SpectatorTeamPanel — what a spectator can actually watch
   ═══════════════════════════════════════════════════════════════ */
/**
 * Live team state for someone who is not on a team.
 *
 * A spectator used to get one static line explaining they were not scoring,
 * which made standing by a room pointless: everything happening in it -- who has
 * locked in, what each team is deciding, where the scores sit -- was already on
 * this subscription but hidden behind the fact that the viewer cannot answer.
 *
 * Every field read here comes from the room document (`pickCount`, `score`,
 * `reveals`) or the roster snapshot (`standings`, which carries every player in
 * the room whether or not the viewer is on their team). Nothing here needs a
 * second subscription, and nothing is a pick the spectator could not already
 * have read for themselves.
 */
function SpectatorTeamPanel({
  teams,
  roster,
  questionIndex,
}: {
  teams: TeamEntry[];
  roster: any[];
  questionIndex: number;
}) {
  return (
    <View style={styles.specPanel}>
      <View style={styles.specHead}>
        <Ionicons name="eye" size={14} color={COLORS.accent} />
        <Text style={styles.specHeadTitle}>TEAMS</Text>
        <Text style={styles.specHeadMeta}>Question {questionIndex + 1}</Text>
      </View>

      {teams.map(team => {
        const reveal = team.reveals?.[`q${questionIndex}`] ?? null;
        // Quorum is against the members who are actually here, not the seats:
        // a team of three in a five-seat room resolves at three, and counting
        // to five would leave the dots permanently incomplete.
        const expected = team.memberCount || team.memberIds?.length || 0;
        const picked = team.pickCount ?? 0;
        const settled = !!reveal;
        const members = roster
          .filter(p => sameTeamId(p.teamId, team.id))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        return (
          <View key={String(team.id)} style={styles.specRow}>
            <View style={styles.specRowTop}>
              <View style={[styles.specDot, { backgroundColor: team.color || '#8B5CF6' }]} />
              <Text style={styles.specName} numberOfLines={1}>{team.name}</Text>
              {settled ? (
                <Ionicons
                  name={reveal.void ? 'remove-circle' : reveal.correct ? 'checkmark-circle' : 'close-circle'}
                  size={15}
                  color={reveal.void ? COLORS.textMuted : reveal.correct ? '#34D399' : '#F87171'}
                />
              ) : (
                <Text style={styles.specPickCount}>{picked}/{expected || '–'}</Text>
              )}
              <Text style={styles.specScore}>{(team.score ?? 0).toLocaleString()}</Text>
            </View>

            {/* A revealed team shows what it decided; an unresolved one shows
                how far it is from deciding. Never both, and never a pick the
                spectator cannot see. */}
            {settled ? (
              <Text style={styles.specAnswer} numberOfLines={2}>
                {reveal.void
                  ? 'Split vote — nobody scored'
                  : `${reveal.answer} · ${reveal.agreed}/${reveal.expected || expected} agreed`}
              </Text>
            ) : expected > 0 ? (
              <View style={styles.specDots}>
                {Array.from({ length: Math.min(expected, 10) }).map((_, i) => (
                  <View key={i} style={[styles.specDotSm, i < picked && styles.specDotSmOn]} />
                ))}
              </View>
            ) : null}

            {members.length > 0 && (
              <View style={styles.specAvatars}>
                {members.slice(0, 6).map((m, i) => (
                  pfpSource(m.avatar) ? (
                    <Image
                      key={`${m.id}-${i}`}
                      source={pfpSource(m.avatar)!}
                      style={styles.specAvatar}
                      resizeMode="cover"
                    />
                  ) : (
                    <View key={`${m.id}-${i}`} style={styles.specAvatarFallback}>
                      <Text style={styles.specAvatarText}>
                        {(m.displayName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )
                ))}
                {members.length > 6 && (
                  <Text style={styles.specMore}>+{members.length - 6}</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
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

/** Longest run of consecutive correct answers in a LAN player's log. */
function bestStreakFromAnswers(answers?: LanPlayer['answers']): number {
  if (!answers) return 0;
  const indices = Object.keys(answers)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (const index of indices) {
    if (answers[String(index)]?.correct) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/**
 * Map a LAN roster into the participant rows the offline sync stores.
 *
 * Your own row carries your Django user id (the app's identity everywhere else)
 * rather than the LAN player id, so the activity detail can tag it "(you)". A
 * peer's LAN id is all the host knows, so it is sent as-is and simply renders as
 * another player.
 */
function buildLanParticipants(
  players: LanPlayer[],
  opts: { myLanId: string; myUserId: number | string | null; myName: string; myAvatar?: string | null },
): OfflineParticipant[] {
  return players.map((p) => {
    const isMe = opts.myLanId ? p.id === opts.myLanId : p.name === opts.myName;
    return {
      user_id: isMe && opts.myUserId != null ? opts.myUserId : p.id,
      name: p.name || 'Player',
      score: p.score ?? 0,
      correct: p.correctCount ?? 0,
      answered: p.answeredCount ?? 0,
      bestStreak: bestStreakFromAnswers(p.answers),
      avatar: (isMe ? opts.myAvatar : p.avatar) ?? null,
    };
  });
}

export default function QuestionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roomCode: string; offline?: string; lan?: string; quizTitle?: string }>();
  const roomCode = params.roomCode;
  const isOffline = params.offline === 'true';
  const isLan = params.lan === 'true';
  // The signed-in profile carries the Django id the activity snapshot keys
  // "you" off, and the name/avatar an offline solo result is attributed with.
  const { user: currentUser } = useCurrentUser();
  const meName = [currentUser?.first_name, currentUser?.last_name].filter(Boolean).join(' ')
    || currentUser?.username || 'You';
  const [questions, setQuestions] = useState<any[]>([]);
  const [questionOrder, setQuestionOrder] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Whether this member's answer for the CURRENT question has been submitted.
   *
   * This has to be separate from `selected`, because `selected` holds the answer
   * *text* and a timeout submits the empty string. `''` is falsy, so every guard
   * written as `if (selected) return` fell straight through after a timeout: the
   * options stayed tappable and Submit stayed live, the player's next real tap
   * posted a SECOND answer for the same index, and the server's idempotency
   * cache (`answeredQuestions`) handed back the blank verdict -- a correct
   * answer shown as Incorrect with the streak destroyed and no way to recover.
   *
   * A latch is also the honest model: running out of time IS an attempt, scored
   * as a miss. So the question is locked either way, and the answer text is
   * only ever what to display.
   */
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState<{
    correct: boolean;
    correctAnswer: string;
    points: number;
    /** Part of `points` earned by answering fast, above the 500 floor. */
    speedBonus?: number;
    /** What the player chose; '' on timeout. Also the member's own team pick,
     * which the disagreement copy quotes back to them. */
    picked?: string;
    /* ── team mode ── */
    /** The team's single answer, from the shared reveal. */
    teamAnswer?: string;
    /** How many members backed the team's answer. A count, never a list of names. */
    agreed?: number;
    /**
     * Whether THIS member's own pick matched the team's answer.
     *
     * Three states, and the distinction is the whole point:
     *  - `true`  picked with the team.
     *  - `false` picked against the team. Distinct from having not picked at
     *    all, which is a different piece of feedback.
     *  - `null`  there was no team answer to compare against -- the question was
     *    voided by a tie. The server sends null rather than true here; folding
     *    it into `true` made a 2-2 split report "you agreed with your team" to
     *    all four players, including the two on the losing side.
     */
    iAgreed?: boolean | null;
    /** Members who submitted a pick, of those expected. */
    pickers?: number;
    /** The team split and nobody answered for it, so it scored nothing. */
    voided?: boolean;
    /**
     * This is the client's own guess at the verdict, shown the instant the clock
     * hits zero -- not the server's word. It flips the card immediately instead
     * of leaving a timed-out question sitting blank, and it is deliberately wrong
     * about `correct` (nothing was picked). A reveal that arrives later replaces
     * it wholesale; see the merge in the team listener. Never set on a result
     * that came back from `POST answer/`.
     */
    provisional?: boolean;
  } | null>(null);
  const [boxChars, setBoxChars] = useState<string[]>([]);
  const [wordLengths, setWordLengths] = useState<number[]>([]);
  const boxRefs = useRef<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [biggestMover, setBiggestMover] = useState<{ name: string; jump: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [timePerQuestion, setTimePerQuestion] = useState(15);
  const [userId, setUserId] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * True from the moment an answer goes out until the server's verdict lands.
   *
   * A timeout now resolves locally (running out of time is a miss, so the card
   * should flip at once rather than sitting on a dead timer for a round-trip),
   * but that local verdict is provisional. Gating the auto-advance on this is
   * what stops the room moving on with the real score still in flight.
   */
  const [submitting, setSubmitting] = useState(false);
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
  /** The room's creator. Only they can settle the game;
   * `hostId` can move to a student who is merely running the room. */
  const [roomOwnerId, setRoomOwnerId] = useState<string | null>(null);
  /** Latches once a forced pick has been sent for this question. */
  const teamForceSentRef = useRef(false);
  /**
   * A one-shot retry scheduled for the exact moment the server says the shared
   * question closes.
   *
   * The half-second clock tick used to re-force on every tick instead, so a
   * client whose clock ran fractionally ahead of the server's kept hammering
   * `/game/teams/pick/` for as long as the skew lasted. The server's
   * `secondsLeft` is authoritative, so one scheduled retry replaces the spin.
   */
  const teamRetryTimerRef = useRef<any>(null);
  /** Latest submit/pick closure for the clock interval, which must not capture
   * a stale render's state. */
  const teamPickRef = useRef<(answer: string, force: boolean) => void>(() => {});
  /** Mirrors of `selected`/`pendingAnswer` for the forced pick at time-out.
   * A ref, not state, because the clock reads it from an interval closure that
   * would otherwise be re-created on every keystroke. */
  const selectedRef = useRef<string | null>(null);
  const pendingAnswerRef = useRef<string | null>(null);
  /**
   * Mirror of `answered` for the timer callbacks.
   *
   * Those run from a `setState` updater created by a render that has long since
   * been replaced, so a `selected` read inside them is whatever that stale
   * render captured -- which is why the old `if (!selected)` expiry check was
   * dead code. A ref is always current.
   */
  const answeredRef = useRef(false);
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
  // Whether the question currently on screen ran out before it was answered.
  // Set by the blank-submit (classic) and force-submit (team) paths, cleared on
  // every question change. The auto-advance countdown reads it to pick 1.5s over
  // 2s. A ref, not state: it is written in the same tick that sets the result and
  // read by an effect keyed on `result`, so a state update would land too late.
  const timedOutRef = useRef(false);
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
  // LAN team list for the header pill. Kept in state so a `teams` broadcast
  // re-renders the pill, while the session copy (`setLanTeams`) is what the
  // results screen reads at the very end.
  const [lanTeamList, setLanTeamList] = useState<LanTeam[]>([]);
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
      const meName = lanGame.playerName || 'You';
      // The host relays our own row back in the final leaderboard, already
      // carrying the answers we submitted and our team. Rebuilding it from
      // scratch dropped both, which left the viewer with no review of their own
      // play and no team placement on the results screen.
      const existing = myId
        ? list.find(p => p.id === myId)
        : list.find(p => p.name === meName);
      const me = {
        ...(existing ?? {}),
        id: myId || 'me',
        name: meName,
        avatar: lanGame.playerAvatar || undefined,
        connected: true,
        finished: true,
        score: game.score ?? 0,
        correctCount: game.correctCount,
        answeredCount: game.answeredCount,
        totalQuestions: game.totalQuestions,
        answers: answerLogFromOutcomes(game.outcomeLog),
        teamId: existing?.teamId,
      };
      const idx = existing ? list.indexOf(existing) : -1;
      if (idx >= 0) list[idx] = me;
      else list.push(me);
    }
    setLanFinalStandings(list);
    if (game) {
      try {
        // Persist the whole roster, not just this device's line, so the synced
        // activity row replays the online "Final standings" for a LAN game.
        const participants = buildLanParticipants(list, {
          myLanId: myId,
          myUserId: currentUser?.id ?? null,
          myName: lanGame.playerName || 'You',
          myAvatar: lanGame.playerAvatar || null,
        });
        lanSavedIdRef.current = saveOfflineGameResult(game, participants);
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
        ...(getLanTeams().length > 0 ? { teamMode: 'true' } : {}),
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
          // Seed the LAN player list (and team names) so the final standings
          // show everyone, even if no leaderboard broadcast has arrived yet.
          // Your own row is seeded with the real local score/streak, remapped
          // to id 'me' so the drawer tags it "(You)".
          const seedTeams = getLanTeams();
          if (seedTeams.length > 0) setLanTeamList(seedTeams);
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
            } else if (msg.t === 'teams') {
              const list = msg.teams ?? [];
              setLanTeams(list);
              setLanTeamList(list);
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
        // Who may settle this room. Deliberately outside the `teamMode` branch:
        // it used to sit inside it, so a classic room -- which has no `teamMode`
        // field at all -- left `roomOwnerId` null forever. `isOwner` was then
        // always false, the client never sent `confirm`, and `_settle` (whose
        // only caller is the confirm branch) never ran: no settlement, no
        // Recent Activity row, and `status` never reached 'finished' so the
        // results screen never settled either. It read as a missing feature
        // rather than a request that was never made.
        setRoomOwnerId(String(data.ownerId ?? data.hostId ?? ''));
        // The shared question state is re-read on EVERY snapshot, not just at
        // boot: the host advances the room, and a member who is behind has to
        // catch up to the question everyone else is actually answering.
        if (data.teamMode) {
          const index = data.teamQuestionIndex ?? 0;
          setTeamIndex(index);
          setTeamTimeLimit(sharedTimeLimit(data, index));
          setTeamStartedAt(timestampMillis(data.teamStartedAt));
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
        const next = (snap?.docs?.map(d => ({ id: d.id, ...d.data() })) ?? []) as TeamEntry[];
        // Keep the previous array when the delivery is identical. See
        // `sameSnapshot`: this listener used to rebuild `teams` on every
        // snapshot, which re-ran the reveal effect below, which produced a new
        // `result` object, which restarted the auto-advance countdown and
        // replayed the reveal haptics -- several times a second, which is what
        // made a team's lock-in look like it was stuck.
        setTeams(prev => (sameSnapshot(prev, next) ? prev : next));
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
      // Both bounds: below zero while question 1's stamp is still ahead of the
      // clock (the countdown/reveal grace) so the badge cannot show MORE than
      // the limit, and at zero once the round is genuinely over so the tick
      // below can claim expiry.
      const left = Math.min(teamTimeLimit, Math.max(0, Math.ceil(teamTimeLimit - elapsed)));
      setTimeLeft(left);
      if (left <= 0 && !teamForceSentRef.current && teamRetryTimerRef.current == null) {
        // The shared clock is the server's to enforce: this claims expiry, and
        // the server decides from its own clock whether the round really is
        // over. If it is not, it answers `pending` with the remaining time and
        // `submitTeamPick` schedules the single retry -- so the tick must not
        // force again in the meantime (`teamRetryTimerRef` is the latch).
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
    // 250ms, not 500ms: this is the loop that notices expiry, so its period is
    // the floor on how late the timeout feedback can be. The classic clock ticks
    // at the same rate, so a timed-out team question behaves like a timed-out
    // classic one instead of feeling twice as sluggish.
    timerRef.current = setInterval(tick, 250);
    return () => {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (teamRetryTimerRef.current != null) {
        clearTimeout(teamRetryTimerRef.current);
        teamRetryTimerRef.current = null;
      }
    };
  }, [teamMode, teamStartedAt, teamTimeLimit, teamIndex, questions.length, showTeamReveal]);

  // A new shared question resets everything the last one left behind.
  useEffect(() => {
    if (!teamMode) return;
    teamForceSentRef.current = false;
    setCurrentIndex(teamIndex);
    // The room moved, so whatever we were waiting to advance past is done.
    setError(null);
    selectedRef.current = null;
    pendingAnswerRef.current = null;
    markAnswered(false);
    setSelected(null);
    setPendingAnswer(null);
    setResult(null);
    setTeamPickCount({ picked: 0, expected: 0 });
    setBoxChars([]);
    setIsFrozen(false);
    setActivePowerups({ hint: false, doublePoints: false, shield: false });
    setHintedChoices([]);
    setShowRoulette(false);
    setRouletteTarget(null);
    setRoulettePhase('idle');
    timedOutRef.current = false;
    // The bar has to snap back to full here. Classic does this in its own reset
    // effect (line ~879) and team mode did not, so the drain animation below
    // resumed from whatever the previous question had left it at and spent its
    // first 900ms animating backwards to full. The bar looked like it was
    // rewinding while the new question was already being answered.
    timerBarAnim.setValue(1);
  }, [teamMode, teamIndex]);

  useEffect(() => {
    // Both lists are required before the clock may start. `questionOrder` is
    // fetched separately from `questions` (the player doc vs the room doc), and
    // the render gate below refuses to draw the card until it has both -- so a
    // clock that only waited on `questions` was already draining while the card
    // still said "Loading questions...", and the student met a half-spent timer
    // on the very first question.
    if (
      questions.length === 0
      || questionOrder.length === 0
      || showTeamReveal
      || teamMode
    ) return;
    startTimeRef.current = Date.now();
    setTimeLeft(timePerQuestion);
    timerBarAnim.setValue(1);
    const tick = () => {
      // Wall clock, not `setTimeLeft(t => t - 1)`. Decrementing a counter once
      // per tick drifts by however long the interval is delayed, so the displayed
      // time and the real deadline separate over a long question. This also makes
      // the poll period the only thing standing between the clock hitting zero and
      // the timeout firing, which is why it is 250ms and not 1000.
      const left = Math.max(0, Math.ceil(timePerQuestion - (Date.now() - startTimeRef.current) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        // `answeredRef`, not `selected`: this closure was built by a render
        // that has since been replaced, so a `selected` read here could never
        // be anything but that stale render's value and the guard was dead.
        if (!answeredRef.current) handleAnswer(null);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentIndex, questions, questionOrder, showTeamReveal, teamMode, timePerQuestion]);

  useEffect(() => {
    // In team play the shared countdown runs against the ROOM's limit for this
    // question, not the room-wide default, so the bar drains the same length of
    // time the server will.
    const limit = teamMode ? teamTimeLimit : timePerQuestion;
    const target = limit > 0 ? timeLeft / limit : 0;
    // ✨ UPDATED: RNAnimated
    // Skip the tween when the bar is already where it is going. Without this the
    // effect fires on every reset, where target is 1 and the bar is already 1,
    // and starts a pointless animation that delays the first real tick -- so the
    // bar sat visibly still for the first second of the question.
    const current = (timerBarAnim as unknown as { __getValue?: () => number }).__getValue?.();
    if (current != null && Math.abs(current - target) < 0.001) return;
    // 250ms linear, matching the poll period exactly. This was 900ms against a
    // 1000ms tick: every new curve outlasted the step it was animating, so each
    // tween was still running when the next one began and restarted from the
    // live value partway. The bar therefore never actually reached its target --
    // it trailed the number by a few hundred ms and stepped down in visible
    // lurches. One tween per poll, spanning exactly one poll, drains smoothly.
    RNAnimated.timing(timerBarAnim, {
      toValue: target,
      duration: 250,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [timeLeft, isFrozen, teamMode, teamTimeLimit, timePerQuestion]);

  useEffect(() => {
    // Both typed families need the same letter-box row, so this keys off the
    // shared list rather than `type === 'identification'`. `fill_in_blank` used
    // to render NOTHING at all -- no input, no boxes, no way to answer -- because
    // the gate named one type and the offline engine already knew there were two.
    // `TYPED_QUESTION_TYPES` is the single source of truth; it is also what
    // `offlineEngine` grades against, so a type that looks typed here is typed
    // there.
    if (!(TYPED_QUESTION_TYPES as readonly string[]).includes(question?.type)) {
      // Clear rather than early-return: the previous question's row is still in
      // `wordLengths`, and the typed render gate below keys off the CURRENT
      // question's type, so a stale row would reappear word-for-word the next
      // time a typed question came up with a shorter answer.
      setWordLengths([]);
      setBoxChars([]);
      boxRefs.current = [];
      return;
    }
    const raw = String(question?.correctAnswer ?? '').trim();
    if (!raw) {
      // An empty answer yields a zero-length row, and `[].every(...)` is true --
      // so Submit lit up with nothing to send and the question scored free. There
      // is no answer to lay out; leave the boxes empty and let the Submit guard
      // below keep the button dead.
      setWordLengths([]);
      setBoxChars([]);
      boxRefs.current = [];
      return;
    }
    const words = raw.split(/\s+/);
    setWordLengths(words.map(w => w.length));
    // Length derived from the SAME words as `wordLengths`. It used to be built
    // from `words.join('')`, which is fine, but the two were computed in
    // separate statements over separate arrays -- and the letter-box render
    // slices `boxChars` by `wordLengths`, so any drift left the tail of the row
    // unrenderable and silently shorter than the answer. One array, two views.
    setBoxChars(Array(words.join('').length).fill(''));
    boxRefs.current = [];
    // `question` is `questions[questionOrder[currentIndex]]`, so ALL THREE are
    // inputs -- this effect used to list only `currentIndex` and `questions`.
    // `questionOrder` arrives from a different fetch than `questions` (the
    // player doc vs the room doc), and when it landed late the effect had
    // already run against `question = {}`, early-returned, and never re-ran:
    // the card rendered with no box row at all, or with the previous
    // question's word split, and the student could not type the full answer.
    // Naming `question` itself is impossible: it is declared further down this
    // render, and the deps array is evaluated before that declaration is
    // reached.
  }, [currentIndex, questions, questionOrder]);

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

  // One haptic and one flip per *question*, not per `result` object.
  //
  // On a timeout the client publishes a provisional verdict so the card flips
  // on the same frame the clock expires, then overwrites it with the server's
  // real one. That is two distinct objects with the same `correct`, so keying the
  // effect on `[result]` alone fired the Error haptic twice and replayed the
  // 400ms flip on top of itself -- a stutter that read as two buzzes.
  const verdictLatchedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!result) return;
    if (verdictLatchedRef.current === currentIndex) return;
    verdictLatchedRef.current = currentIndex;
    if (Platform.OS !== 'web') {
      if (result.correct) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    resultFlipAnim.setValue(0);
    // ✨ UPDATED: RNAnimated
    RNAnimated.timing(resultFlipAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [result, currentIndex]);

  /* ── auto-advance: countdown then skip ── */
  useEffect(() => {
    // A spectator never sets `result`, but they still need to be carried forward
    // or the game would sit on question one for them forever.
    if (!result && !spectator) { setAutoCountdown(0); return; }

    // The provisional timeout verdict flips the card immediately, but the real
    // score is still in flight. Advancing now would move the room on before the
    // server had recorded anything, which is how a timed-out question used to
    // end up unrecorded. Wait for the verdict, then count down as normal.
    if (submitting) { setAutoCountdown(0); return; }

    // If the powerup roulette is already showing, pause the countdown
    // so the reward is actually visible before we auto-advance. The
    // roulette timer will later clear showRoulette, at which point this
    // effect re-runs and the countdown resumes.
    if (showRoulette) { setAutoCountdown(0); return; }

    const isLast = currentIndex + 1 >= effectiveOrder.length;
    // A spectator has nothing to answer, so they get a real read of the question.
    // A timed-out question gets less: the clock already ran out on it, so the
    // player is waiting on a card they never got to choose -- 1.5s is enough to
    // read the correct answer without feeling stuck.
    const total = spectator ? 5 : (isLast ? 3 : timedOutRef.current ? 1.5 : 2);
    setAutoCountdown(total);
    // Absolute deadline rather than decrementing a counter. A 1s decrement on a
    // 1s interval drifts by however long each React render takes, and the
    // fractional 1.5s total has no representation in whole ticks -- so the skip
    // could fire a full second late. Deadline + 250ms poll is both exact and
    // immune to a throttled interval.
    const deadline = Date.now() + total * 1000;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setAutoCountdown(remaining / 1000);
      if (remaining <= 0) {
        if (autoAdvanceRef.current !== null) { clearInterval(autoAdvanceRef.current); autoAdvanceRef.current = null; }
        handleNext();
      }
    };
    autoAdvanceRef.current = window.setInterval(tick, 250);
    tick();
    return () => { if (autoAdvanceRef.current !== null) { clearInterval(autoAdvanceRef.current); autoAdvanceRef.current = null; } };
  }, [result, showRoulette, spectator, submitting]);

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

  /**
   * Whether the letter-box row is fully and legitimately filled.
   *
   * The `length > 0` half is load-bearing: `[].every(c => c)` is `true`, so a
   * question whose `correctAnswer` is empty produced a zero-box row that read as
   * complete. Submit lit up, sent `''`, and the server graded the empty string
   * against the empty answer -- a question nobody could fail, handed out for
   * free.
   */
  const boxesComplete = boxChars.length > 0 && boxChars.every(c => !!c);

  const handleBoxChange = (text: string, index: number) => {
    const char = text.slice(-1);
    // Functional update. The old copy-then-set read `boxChars` from the render
    // that owned this handler, so two keystrokes landing before a re-render both
    // wrote the SAME base array and the second silently dropped the first
    // letter -- which then read as a wrong answer for a correctly typed one.
    setBoxChars(prev => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      next[index] = char;
      return next;
    });
    if (char && index < boxChars.length - 1) boxRefs.current[index + 1]?.focus();
  };

  const handleBoxKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !boxChars[index] && index > 0)
      boxRefs.current[index - 1]?.focus();
  };

  const handleFreeze = async () => {
    if (answered || isFrozen || freezeBusy) return;
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
    setTeamPickCount(prev => {
      const picked = myTeam.pickCount ?? 0;
      // Same reasoning as the `result` wrapper below: an identical count is not
      // news, and handing back a new object re-renders the whole card on every
      // delivery.
      if (prev && prev.picked === picked && prev.expected === expected) return prev;
      return { picked, expected };
    });

    const reveal = myTeam.reveals?.[`q${teamIndex}`] ?? null;
    if (!reveal) return;
    // Two independent Firestore documents describe this reveal, and they arrive
    // in no guaranteed order: `reveals.q{n}` on the team document, and the
    // member's own verdict on `answers.q{n}` on their player document.
    //
    // This used to be `prev ?? {...}`, which latched whichever arrived first. When
    // the team document won the race, `iAgreed` was written as `false` because
    // the member's own log had not loaded yet, and the later, correct value was
    // thrown away -- the player was told they disagreed with their team for the
    // rest of the question. So the shared fields still fill only a gap, but the
    // two per-member fields are always taken from the member's own log, and
    // `??` is deliberately avoided on `agreed`: null means the question was
    // voided by a tie, and coalescing it to false would report a split vote as a
    // disagreement.
    const own = ownAnswers?.[`q${teamIndex}`];
    setResult(prev => {
      // A provisional verdict is the client's own guess at the timeout, so the
      // reveal must win outright rather than merely filling a gap. `prev?.correct
      // ?? reveal.correct` would keep the guess instead -- and since the guess is
      // always `correct: false`, a team that did in fact answer correctly before
      // the clock ran out would be shown as wrong for the rest of the question,
      // and scored 0 in front of everyone. Everything the reveal speaks to is
      // taken from the reveal when `prev` is provisional; the per-member fields
      // below are exempt either way because they are already the truth about this
      // member.
      const take = (mine: any, theirs: any) => (prev?.provisional ? theirs : (mine ?? theirs));
      const next = {
        ...(prev ?? {}),
        correct: take(prev?.correct, reveal.correct),
        // Not `take(...)`: a non-provisional `prev` can carry
        // `correctAnswer: ''` (the blank verdict the timeout path writes), and
        // `'' ?? theirs` keeps it because `??` only falls through on null or
        // undefined -- so the reveal's answer was discarded and the strip
        // printed an empty line. An empty string here means "I don't have it".
        correctAnswer: prev?.provisional
          ? reveal.correctAnswer
          : (prev?.correctAnswer || reveal.correctAnswer),
        points: take(prev?.points, reveal.points),
        speedBonus: take(prev?.speedBonus, reveal.speedBonus),
        picked: own?.picked ?? prev?.picked ?? selectedRef.current ?? '',
        teamAnswer: take(prev?.teamAnswer, reveal.answer),
        agreed: take(prev?.agreed, reveal.agreed),
        iAgreed: own?.agreed !== undefined ? own.agreed : prev?.iAgreed,
        pickers: take(prev?.pickers, reveal.pickers),
        voided: take(prev?.voided, reveal.void),
        provisional: false,
      };
      // Returning the SAME object when nothing changed is the point of this
      // wrapper. A bare object literal always has a new identity, and `result`
      // gates the auto-advance countdown and the flip/haptics effect -- so an
      // identical re-render of the reveal used to restart the countdown from
      // two and buzz again. Compare before adopting.
      if (prev && sameSnapshot(prev, next)) return prev;
      return next;
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
    if (pool.hint <= 0 || answered || activePowerups.hint) return;
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
    if (pool.doublePoints <= 0 || answered || activePowerups.doublePoints) return;
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
    if (pool.shield <= 0 || answered || activePowerups.shield) return;
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
   * Set or clear the "this question is answered" latch. Always go through this
   * so the ref and the state cannot drift apart.
   */
  const markAnswered = (value: boolean) => {
    answeredRef.current = value;
    setAnswered(value);
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
    // Expiry, not a deliberate lock-in: publish the client's own verdict so the
    // card flips on the same frame the shared clock hits zero. Team mode had no
    // equivalent of classic's blank-submit branch, so a timed-out team question
    // just sat there -- the force submit either came back `pending` (setting the
    // quorum count and no result) or waited on a Firestore reveal, and the player
    // was left staring at a frozen card wondering whether the round had ended.
    // Marked provisional, so the reveal overwrites it rather than being blocked
    // by it -- see the merge in the team listener.
    if (force) {
      timedOutRef.current = true;
      setResult(prev => (prev && !prev.provisional ? prev : {
        correct: false,
        correctAnswer: '',
        points: 0,
        speedBonus: 0,
        picked: answer || '',
        teamAnswer: answer || '',
        agreed: 0,
        iAgreed: null,
        pickers: 0,
        voided: false,
        provisional: true,
      }));
    }
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
          // answer they did not make. Clamped: question 1's stamp is pushed
          // past the 3-2-1 and the team reveal, so a pick made inside that
          // window would otherwise report a NEGATIVE time (and the server
          // rejects absurd times outright).
          timeTaken: teamStartedAt != null
            ? Math.max(0, (Date.now() - teamStartedAt) / 1000)
            : teamTimeLimit,
          force: force ? 'true' : 'false',
          // Always false. The leader's "Lock in" button is gone from the UI, so
          // nothing in this app ends a round early any more -- `Next` advances
          // the room instead. The field is still sent explicitly because the
          // server defaults it to 'false' either way and an implicit omission
          // would read as an oversight. The server keeps the capability for API
          // callers.
          lockIn: 'false',
          useHint: activePowerups.hint ? 'true' : 'false',
          useDoublePoints: activePowerups.doublePoints ? 'true' : 'false',
          useShield: activePowerups.shield ? 'true' : 'false',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 403 && /leader/i.test(data.error || '')) {
          // Leadership moved (or this member never had it). The message carries
          // the current holder so the screen can explain rather than just
          // refusing -- a button that silently stops working reads as a bug.
          setError(data.leaderId
            ? `Only the team leader can lock in. The team is now led by ${data.leaderId}.`
            : (data.error || 'Only the team leader can lock in the answer.'));
          return;
        }
        if (res.status === 403 && /team|spectator/i.test(data.error || '')) {
          setIsSpectating(true);
          lockPick(null);
          pendingAnswerRef.current = null;
          setPendingAnswer(null);
          return;
        }
        // "Time is still on the clock": our countdown and the server's disagreed
        // (a slow request, a clock skew). Nothing was charged and the pick stays
        // valid. Schedule exactly ONE retry at the moment the server says the
        // round closes, instead of letting the half-second tick re-force over and
        // over for as long as the skew lasted.
        if (res.status === 400 && data.pending) {
          const secs = Number(data.secondsLeft ?? 0);
          const retryAnswer = answer;
          teamForceSentRef.current = false;
          if (teamRetryTimerRef.current == null) {
            teamRetryTimerRef.current = setTimeout(() => {
              teamRetryTimerRef.current = null;
              teamForceSentRef.current = true;
              void submitTeamPick(retryAnswer, true);
            }, Math.max(0, secs) * 1000 + 80);
          }
          return;
        }
        // Two very different situations arrive as a 409 and treating them alike was
        // its own bug. The room moved on (`questionIndex` tells us where it is
        // now) versus this exact question is already scored and the reveal is
        // on its way. Wiping on the second one used to blank the answer the
        // player had just submitted and left the card looking unanswered.
        if (res.status === 409) {
          setTeamPickCount(null);
          if (data.questionIndex != null || /not the current question/i.test(data.error || '')) {
            // Stale index: the room listener pulls us onto the current question
            // and that effect resets the card, so re-open it here too.
            markAnswered(false);
            setError(null);
            lockPick(null);
            pendingAnswerRef.current = null;
            setPendingAnswer(null);
            setResult(null);
          } else {
            // Already settled. Keep the latch shut -- that question is over and
            // must not be answerable again -- and wait for the reveal instead of
            // throwing the player's own pick away.
            setError(null);
          }
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
        // A tie has no team answer, so there is nothing to agree or disagree
        // with. This used to be `data.void ? true : ...`, which reported a split
        // vote as the whole team being in agreement -- including for the member
        // who was on the losing side of it. `null` lets the reveal below say the
        // vote was split instead. Same for the classic path, where this is not
        // even a team question and the flag is only ever null.
        iAgreed: data.void ? null : !!answer && answer === (data.answer ?? ''),
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
      // Re-open the question, or the latch set in `handleAnswer` would keep
      // rejecting the very retry this screen is offering -- the pick is cleared
      // but the options would stay dead.
      markAnswered(false);
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
      const data = await res.json().catch(() => ({}));
      // "The question is still open" is a 409 that arrives with `secondsLeft`,
      // and it used to be thrown away by a blanket "every outcome is fine". A
      // member on a fast team tapping Next then got nothing at all: no question
      // moved and no explanation, so the tap looked broken. Say what is
      // happening and for how long.
      if (res.status === 409 && data.secondsLeft != null) {
        const secs = Math.ceil(Number(data.secondsLeft));
        setError(
          data.waitingTeams
            ? `Waiting on ${data.waitingTeams} team${data.waitingTeams === 1 ? '' : 's'} — this question closes in ${secs}s.`
            : `This question closes in ${secs}s.`,
        );
        return false;
      }
      // Everything else really is fine: 200 moved the room, and the remaining
      // 409s mean somebody else already advanced. The room listener is what
      // actually moves this screen.
      return res.ok;
    } catch {
      return false;
    }
  };

  /**
   * End of a game: vote that this player is done, and settle if that settles it.
   *
   * Everyone votes; only the room OWNER can actually close it, so a student's tap
   * only ever records `isFinished`. That split is deliberate, and it is also why
   * this has to be a two-step call: a plain vote leaves the room running, and a
   * room that never gets closed means `_settle` never runs, which means nobody
   * is paid and -- the bug this fixes -- no Recent Activity row is ever written
   * for the game.
   *
   * The classic path used to POST `{ roomCode }` and stop, so a solo game that
   * everybody finished was never settled and produced no history at all. Now:
   * vote first, then settle immediately if this voter is the owner and the room
   * reports itself ready. A non-owner settles when the owner is not present to
   * do it, which the server already guards by rejecting the confirm.
   */
  const finishGame = async () => {
    try {
      const token = await getToken();
      const isOwner = roomOwnerId != null && String(roomOwnerId) === String(userId);
      const post = (confirm: boolean) => fetch(`${API_BASE_URL}/game/finish/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // The server reads these as truthy strings, not JSON booleans.
        body: JSON.stringify({ roomCode, confirm: confirm ? 'true' : 'false' }),
      });

      const voted = await post(false);
      if (!voted.ok) return;
      const vote = await voted.json().catch(() => ({}));
      // The room is only closed if this voter owns it and everybody is done.
      if (isOwner && vote?.readyToSettle) await post(true);
    } catch {
      // Never strand the player on a dead card; the host can still end it.
    }
  };

  /**
   * End of a team game.
   *
   * Same two-step as the solo path. Navigation is left to the room listener,
   * which fires when the server has really closed the room -- a member who votes
   * must not be dropped onto a results screen for a game that is still running.
   */
  const finishTeamGame = async () => {
    await finishGame();
  };

  /**
   * The host cutting a running session short, available on every question.
   *
   * `/game/finish/` with `confirm` refuses to settle while anyone is still on a
   * question (409 + `remaining`), because a student who has not submitted must
   * not lose the round to a stray tap. `force` is the deliberate override, and
   * the server only honours it from the room OWNER -- so this is rendered only
   * for `isRoomOwner`; anyone else would just collect a 403.
   *
   * Two confirmations: the button, then the "N of M still answering" sheet.
   * Navigation is left to the room listener above, exactly as `finishGame`
   * leaves it -- this call only asks the server to close the room.
   */
  const stopSession = async () => {
    const isOwner = roomOwnerId != null && String(roomOwnerId) === String(userId);
    if (!isOwner) return;

    const settle = async (force: boolean): Promise<void> => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/game/finish/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(
            force
              ? { roomCode, confirm: 'true', force: 'true' }
              : { roomCode, confirm: 'true' },
          ),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return;
        if (res.status === 409) {
          const remaining = Number(data.remaining ?? 0);
          const total = Number(data.participantCount ?? remaining);
          Alert.alert(
            'Stop while students are still answering?',
            `${remaining} of ${total} have not submitted. Everyone goes to the final screen now.`,
            [
              { text: 'Keep playing', style: 'cancel' },
              { text: 'Stop for everyone', style: 'destructive', onPress: () => settle(true) },
            ],
          );
          return;
        }
        Alert.alert('Could not stop', data.error || 'Please try again.');
      } catch {
        Alert.alert('Could not stop', 'Check your connection and try again.');
      }
    };

    // Confirm before closing the room. The 409 branch above ("N of M still
    // answering") is a SECOND confirm for the case that actually loses work;
    // this one guards the ordinary tap, which previously ended everybody's game
    // on a single press with no way back.
    Alert.alert(
      'End session for everyone?',
      'This closes the game for every player and sends everyone to the final scores now.',
      [
        { text: 'Keep playing', style: 'cancel' },
        { text: 'End session', style: 'destructive', onPress: () => { void settle(false); } },
      ],
    );
  };

  /**
   * A player walking out of a game that is already running.
   *
   * The host's "End" closes the room for everyone; this is the other direction
   * -- a participant leaving for themselves. The game keeps running for the
   * rest of the room, so this only removes this player: their seat in a team
   * and their player document, exactly as the pre-game LEAVE does. The
   * `host/claim/` call is a no-op while the owner is still present, so a
   * student leaving can never disturb the host (and a leaving host hands the
   * room over rather than stranding it).
   *
   * Only offered for real online rooms -- offline practice and LAN have their
   * own exits and no Firestore room to clean up.
   */
  const leaveSession = () => {
    if (isOffline || isLan) return;
    const isOwner = roomOwnerId != null && String(roomOwnerId) === String(userId);
    // The host uses End, which closes the room; there is nothing meaningful for
    // them to "leave" that is not just ending it for everyone.
    if (isOwner) return;

    const doLeave = async () => {
      try {
        if (roomCode && userId != null) {
          const roomRef = firestore().collection('gameRooms').doc(roomCode);
          const playerRef = roomRef.collection('players').doc(String(userId));
          try {
            const playerSnap = await playerRef.get();
            const myTeamId = playerSnap.data()?.teamId;
            if (myTeamId) {
              const teamRef = roomRef.collection('teams').doc(myTeamId);
              await teamRef.update({ memberIds: firestore.FieldValue.arrayRemove(String(userId)) });
            }
          } catch {}
          await playerRef.delete().catch(() => {});
          // Hand the room over if this player was hosting it. Same endpoint the
          // pre-game LEAVE calls; harmless when the owner is still present.
          const token = await getToken();
          await fetch(`${API_BASE_URL}/game/host/claim/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ roomCode }),
          }).catch(() => {});
        }
      } catch {
        // The server-side cleanup is best-effort; never strand the player on a
        // dead card. They asked to leave, so leave.
      }
      if (!claimNav()) return;
      router.replace('/(tabs)/games' as any);
    };

    Alert.alert(
      'Leave game?',
      "Your answers so far won't be scored. The game continues for everyone else.",
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => { void doLeave(); } },
      ],
    );
  };

  /**
   * LAN host ending the session mid-game.
   *
   * `endGame` broadcasts `{t:'end'}` to every player AND to this device's own
   * loopback client, so the existing `end` handler finalizes each run (saving
   * the answers so far) and routes everyone to the results screen -- the host
   * included. No separate navigation is needed here.
   */
  const endLanSession = () => {
    const host = getLanHostServer();
    if (!host) return;
    Alert.alert(
      'End game for everyone?',
      'This closes the game for every player and shows the final scores now.',
      [
        { text: 'Keep playing', style: 'cancel' },
        {
          text: 'End game',
          style: 'destructive',
          onPress: () => { host.endGame('The host ended the game'); },
        },
      ],
    );
  };

  /** A LAN player walking out. There is no server room to clean up. */
  const leaveLanSession = () => {
    Alert.alert(
      'Leave game?',
      "Your answers so far won't be scored.",
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            if (!claimNav()) return;
            getLanClient()?.disconnect();
            clearCurrentOfflineGame();
            resetLanState();
            router.replace('/(tabs)/games' as any);
          },
        },
      ],
    );
  };

  /** Abandon a solo offline run. Nothing is persisted until the end. */
  const quitOffline = () => {
    Alert.alert(
      'Quit game?',
      "Your progress won't be saved.",
      [
        { text: 'Keep playing', style: 'cancel' },
        {
          text: 'Quit',
          style: 'destructive',
          onPress: () => {
            if (!claimNav()) return;
            clearCurrentOfflineGame();
            router.replace('/(tabs)/games' as any);
          },
        },
      ],
    );
  };

  const handleAnswer = async (answer: string | null) => {
    // The latch, not the answer text: a timeout submits '' and a second
    // submission for the same index is answered from the server's cache with
    // the blank verdict, so a correct pick could be scored as wrong.
    if (answeredRef.current || spectator) return;
    markAnswered(true);
    if (teamMode) {
      // Team play submits a private PICK, not an answer: the team has one
      // answer and the server tallies it. Nothing here decides the outcome.
      //
      // The shared clock is deliberately NOT stopped. It is owned by the effect
      // that runs off the ROOM's `teamStartedAt`, and that effect's deps do not
      // change when a member picks -- so clearing the interval here left the
      // countdown frozen mid-drain for everyone left in the round, with no tick
      // left to force their own pick when it reached zero. `markAnswered` is
      // what records that this member is done.
      lockPick(answer || '');
      // A timeout must not erase an answer the player had already chosen and is
      // trying to re-send: `handleRetry` needs it. Only a real pick replaces it.
      if (answer != null) {
        pendingAnswerRef.current = answer;
        setPendingAnswer(answer);
      }
      setError(null);
      await submitTeamPick(answer || '', false);
      return;
    }
    clearInterval(timerRef.current);
    lockPick(answer || '');
    if (answer != null) {
      pendingAnswerRef.current = answer;
      setPendingAnswer(answer);
    }
    setError(null);
    const timeTaken = (Date.now() - startTimeRef.current) / 1000;
    const actualIndex = effectiveOrder[currentIndex];
    // Running out of time IS an attempt, so it is scored as a miss -- but a blank
    // pick must not also spend a powerup. The server no longer charges one for a
    // blank, and sending the flags anyway would have the client and the server
    // disagreeing about what was spent.
    const blank = answer == null || !String(answer).trim();
    if (isOffline || isLan) {
      const game = getCurrentOfflineGame();
      if (!game) return;
      const outcome = game.answer(actualIndex, answer || '', timeTaken, {
        useHint: !blank && activePowerups.hint,
        useDoublePoints: !blank && activePowerups.doublePoints,
        useShield: !blank && activePowerups.shield,
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
      setSubmitting(true);
      if (blank) {
        timedOutRef.current = true;
        // Provisional, and deliberately wrong: a blank attempt is never correct.
        // It exists so the timer hitting zero reacts on the same frame as the
        // tap that would have, instead of after the POST comes back. The server's
        // verdict overwrites it below -- and `provisional` is what tells the flip
        // and haptic effect that this is a placeholder rather than a second real
        // answer, so a timed-out question buzzes once instead of twice.
        setResult({
          correct: false,
          correctAnswer: String((questions[actualIndex] || {}).correctAnswer ?? ''),
          points: 0,
          speedBonus: 0,
          picked: '',
          provisional: true,
        });
      }
      const res = await fetch(`${API_BASE_URL}/game/answer/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          roomCode,
          questionIndex: actualIndex,
          answer: answer || '',
          timeTaken,
          useHint: !blank && activePowerups.hint ? 'true' : 'false',
          useDoublePoints: !blank && activePowerups.doublePoints ? 'true' : 'false',
          useShield: !blank && activePowerups.shield ? 'true' : 'false',
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
      // Re-open the question: nothing reached the server, so this pick was
      // never scored and the player is entitled to send it again. `answeredRef`
      // has to be cleared as well as the state, or the latch would keep
      // rejecting the retry that this screen is explicitly inviting.
      markAnswered(false);
      lockPick(null);
      // Drop the provisional timeout verdict: the request never landed, so
      // nothing was scored and the question is open again.
      setSubmitting(false);
      setResult(null);
      startTimeRef.current = Date.now();
      setTimeLeft(timePerQuestion);
      // The restarted clock re-sends the answer the player already chose rather
      // than posting a blank. It used to call `handleAnswer(null)`, which
      // overwrote `pendingAnswer` with null -- killing the Retry button (it
      // requires one) and scoring the question wrong for a submission that had
      // never left the device.
      const resubmit = () => {
        const held = pendingAnswerRef.current;
        if (held != null && String(held).trim()) handleAnswer(held);
        else handleAnswer(null);
      };
      timerRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            timerRef.current = null;
            // `answeredRef`, not `selected`: this closure was built by a render
            // that has since been replaced, so a `selected` read here could
            // never be anything but that stale render's value.
            if (!answeredRef.current) resubmit();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } finally {
      // Belt and braces: the success path and the catch both clear this, so a
      // late throw here can never leave the card stuck with auto-advance off.
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    // No `pendingAnswer`, nothing to re-send. This used to be a silent no-op
    // behind a button that still rendered, because a timeout had overwritten the
    // held answer with null.
    if (pendingAnswer == null || !String(pendingAnswer).trim()) return;
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
    // The animation ref was set but never READ, so a second tap while the card
    // was still sliding ran the whole body again: two `setCurrentIndex(i => i + 1)`
    // calls, two questions skipped, and the player never saw the one in between.
    if (isAnimatingRef.current) return;
    // Same reason as the auto-advance gate: a provisional verdict is not a
    // score, and a tap on Next would end the question before the server answered.
    if (submitting) return;
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
        // this row, so the id has to travel with the navigation. A one-row
        // roster is stored too, so the synced activity detail can show the same
        // "Final standings" a live game does and tag the row "(you)".
        const savedId = game ? saveOfflineGameResult(game, [{
          user_id: currentUser?.id ?? 'me',
          name: meName,
          score: game.score,
          correct: game.correctCount,
          answered: game.answeredCount,
          bestStreak: game.bestStreak,
          avatar: currentUser?.avatar ?? null,
        }]) : 0;
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
      // Votes, then settles if this is the owner and the room is ready. See
      // `finishGame` -- a bare vote here used to leave a finished solo game
      // unsettled, so it was never paid out and never recorded.
      await finishGame();
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
      // Re-open the question for the new index. Without this the latch stayed
      // latched across the whole classic game and every question after the first
      // was untappable and its Submit dead.
      markAnswered(false);
      setResult(null);
      setPendingAnswer(null);
      setIsFrozen(false);
      // `showStandings` deliberately survives the move to the next question.
      // Closing it here made the drawer vanish every time a question was scored,
      // because scoring is followed by the auto-advance that runs this reset --
      // so answering a question and running out of time on one both slammed it
      // shut, which is exactly the reported symptom. It is a toggle now: it
      // closes on the toggle and on a backdrop tap, and stays put otherwise.
      // Standings are live, so what it shows keeps updating across questions.
      setActivePowerups({ hint: false, doublePoints: false, shield: false });
      setHintedChoices([]);
      setShowRoulette(false);
      setRouletteTarget(null);
      setRoulettePhase('idle');
      timedOutRef.current = false;
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
  // A `currentIndex` past the end of the order left `question` undefined and the
  // next line threw on `.type`, blanking the screen mid-round. Fall back to an
  // empty object: the card renders empty instead of crashing, and the existing
  // loading guard below keeps the empty state out of sight in normal play.
  const question = questions[actualIndex] || {};
  const playerRank = standings.findIndex(p => String(p.id) === String(userId)) + 1;
  const isDanger = !isFrozen && timeLeft <= 5;
  // LAN team display. LAN play is asynchronous, so this is presentational only:
  // it never routes into the online team engine (shared question + voting).
  const lanIsHost = isLan && getLanHostServer() != null;
  const lanMyPlayer = isLan ? lanPlayersRef.current.find(isMyLanPlayer) : undefined;
  const lanTeam = isLan
    ? (lanTeamList.find(t => t.id === lanMyPlayer?.teamId) ?? null)
    : null;
  const isChoiceQuestion = question.type === 'mcq' || question.type === 'true_false' || question.type === 'tf';
  // Anything choice-shaped that isn't a plain MCQ is a True/False round: it
  // renders as two letter-less buttons rather than "A / B" chips.
  const isTfQuestion = isChoiceQuestion && question.type !== 'mcq';
  const visibleChoices = isChoiceQuestion
    // choices is absent on a malformed MCQ just as often as it is wrong, and
    // .filter on undefined is a hard crash.
    ? ((question.choices && question.choices.length > 0)
      ? (question.choices || []).filter((c: string) => !hintedChoices.includes(c))
      : (question.type === 'true_false' || question.type === 'tf' ? ['True', 'False'] : []))
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
          {!myTeam && lanTeam && (
            <View style={[styles.teamPill, { borderColor: lanTeam.color + '66', backgroundColor: lanTeam.color + '14' }]}>
              <View style={[styles.teamPillDot, { backgroundColor: lanTeam.color }]} />
              <Text style={styles.teamPillName} numberOfLines={1}>{lanTeam.name}</Text>
            </View>
          )}
        </View>

        {/* Host-only escape hatch. Everyone else finishes the round; the owner
            can stop the session from any question, in either mode. Kept small
            so it never out-shouts the timer. */}
        {isRoomOwner && (
          <TouchableOpacity
            style={styles.stopSessionBtn}
            onPress={stopSession}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Stop session"
          >
            <Text style={styles.stopSessionBtnText}>■ End</Text>
          </TouchableOpacity>
        )}

        {/* LAN host: end for everyone. Mirrors the online host's stop button. */}
        {lanIsHost && (
          <TouchableOpacity
            style={styles.stopSessionBtn}
            onPress={endLanSession}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="End game"
          >
            <Text style={styles.stopSessionBtnText}>■ End</Text>
          </TouchableOpacity>
        )}

        {/* Non-host participants can walk out of a running online game. The
            host's counterpart is End above (closes for everyone), so this is
            never shown to the owner. Offline and LAN have their own exits. */}
        {!isRoomOwner && !isOffline && !isLan && (
          <TouchableOpacity
            style={styles.leaveSessionBtn}
            onPress={leaveSession}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Leave game"
          >
            <Text style={styles.leaveSessionBtnText}>Leave</Text>
          </TouchableOpacity>
        )}

        {/* LAN player: walk out of the ad-hoc game. There is no room to close. */}
        {isLan && !lanIsHost && (
          <TouchableOpacity
            style={styles.leaveSessionBtn}
            onPress={leaveLanSession}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Leave game"
          >
            <Text style={styles.leaveSessionBtnText}>Leave</Text>
          </TouchableOpacity>
        )}

        {/* Solo offline run: abandon it. Nothing is saved until the end. */}
        {isOffline && (
          <TouchableOpacity
            style={styles.leaveSessionBtn}
            onPress={quitOffline}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Quit game"
          >
            <Text style={styles.leaveSessionBtnText}>Quit</Text>
          </TouchableOpacity>
        )}

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
          the reveal is up, so it never competes with the team result.
          questionNumber is +1 because both indexes are 0-based and the ticker
          prints `Q{n}/{total}` as a 1-based position — without it the header
          said Q2 while the class was answering question 3. */}
      {!showTeamReveal && !result && (
        <StandingsTicker
          teams={teams}
          players={standings}
          teamMode={teamMode}
          myUserId={userId != null ? String(userId) : null}
          questionNumber={(teamMode ? teamIndex : currentIndex) + 1}
          questionCount={questions.length}
        />
      )}

      {/* ── ACTIVE POWERUP BANNERS ── */}
      {!answered && !result && (activePowerups.doublePoints || activePowerups.shield) && (
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
              You&rsquo;re not on a team, so you&rsquo;re not scoring.
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
              <Text style={[styles.resultStripLabel, !result.correct && styles.resultStripLabelWrong]}>
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
                // No `numberOfLines`: the whole point of this line is to tell the
                // student what the answer WAS, and an ellipsis mid-answer ("Gadium
                // et…") is what made it look shorter than the explanation printed
                // underneath. `|| question.correctAnswer` is the same string the
                // letter boxes are built from, so the two can never disagree.
                <Text style={styles.resultAnswerLine}>
                  Answer: {result.correctAnswer || question.correctAnswer}
                </Text>
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
            {teamMode && !result.voided && result.iAgreed === true && (
              <Text style={[styles.teamAgreementLine, styles.teamOwnLine]}>
                You agreed with your team
              </Text>
            )}
            {/* Three separate verdicts, not two.
                The old copy had one branch for "did not agree" and used it for
                both "picked something else" and "never picked at all", so a player
                who deliberately disagreed was told they had run out of time --
                and there was no way to tell which had happened. Their own pick is
                now shown either way, so the disagreement is at least legible.
                A void (null) is handled by the split-vote line above. */}
            {teamMode && !result.voided && result.iAgreed === false && (
              <Text style={[styles.teamAgreementLine, styles.teamOwnLine]}>
                {result.picked
                  ? `You picked ${result.picked} \u2014 the team went with ${result.teamAnswer}`
                  : 'You did not pick before time ran out'}
              </Text>
            )}
            {!result.correct && question.explanation ? (
              <Text style={styles.resultExplanation}>{question.explanation}</Text>
            ) : null}
          </RNAnimated.View>
        )}

        {/* ── SPECTATOR TEAM BOARD ──
            A spectator sees the same room as everyone else; only the ability to
            answer differs. This reads the fields the team branch already uses
            for its own team, so what a spectator watches is what a player sees. */}
        {spectator && teamMode && sortedTeams.length > 0 && (
          <SpectatorTeamPanel
            teams={sortedTeams}
            roster={standings as any[]}
            questionIndex={teamIndex}
          />
        )}

        {/* ── CHOICES (mcq + true_false) ──
            True/False questions are NOT lettered: a T/F rendered as "A. True /
            B. False" is the bug students reported. Same states, same grading --
            only the chrome differs: no A/B chip, label centered full-width. */}
        {!spectator && isChoiceQuestion && (
          <View style={styles.choicesWrap}>
            {/* True/False has no wrong choice to eliminate, so the hint shows
                the first letter instead of being a dead spend. */}
            {isTfQuestion && activePowerups.hint && String(question.correctAnswer ?? '').trim() && (
              <View style={styles.hintBanner}>
                <Text style={styles.hintBannerText}>
                  💡 Starts with: <Text style={styles.hintLetter}>{String(question.correctAnswer).charAt(0).toUpperCase()}</Text>
                </Text>
              </View>
            )}
            {visibleChoices.map((choice: string, choiceIdx: number) => {
              const isTf = isTfQuestion;
              const isCorrect = result && choice === result.correctAnswer;
              const isWrongPick = result && choice === selected && !result.correct;
              const isDimmed = result && !isCorrect && choice !== selected;
              const isPending = selected === choice && !result && !error;
              return (
                <TouchableOpacity
                  // Positional: two options with the same text (a duplicated
                  // choice in a generated question) collided as React keys, which
                  // made one of them unpressable.
                  key={`${choiceIdx}-${textOf(choice)}`}
                  style={[
                    styles.choice,
                    isTf && styles.choiceTf,
                    isCorrect && styles.choiceCorrect,
                    isWrongPick && styles.choiceWrong,
                    isDimmed && styles.choiceDimmed,
                    isPending && styles.choicePending,
                  ]}
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleAnswer(choice);
                  }}
                  // `answered`, not `selected`: after a timeout `selected` is '' and every
                  // `!!selected` guard fell open, leaving the options live for a
                  // question that was already scored.
                  disabled={answered}
                  activeOpacity={0.7}
                >
                  {!isTf && (
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
                  )}
                  <Text style={[
                    styles.choiceText,
                    isTf && styles.choiceTfText,
                    isCorrect && styles.choiceTextCorrect,
                    isWrongPick && styles.choiceTextWrong,
                    isPending && styles.choiceTextPending,
                  ]}>
                    {isTf && (isCorrect || isWrongPick) ? `${isCorrect ? '✓' : '✗'} ` : ''}
                    {textOf(choice)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── TYPED INPUT (identification + fill_in_blank) ── */}
        {!spectator && (TYPED_QUESTION_TYPES as readonly string[]).includes(question.type) && (
          <View style={styles.idArea}>
            {/* A hint only makes sense when there is a first letter to give. */}
            {activePowerups.hint && String(question.correctAnswer ?? '').trim() && (
              <View style={styles.hintBanner}>
                <Text style={styles.hintBannerText}>
                  💡 Starts with: <Text style={styles.hintLetter}>{String(question.correctAnswer).charAt(0).toUpperCase()}</Text>
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
                        editable={!answered}
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
                style={[styles.submitBtn, !boxesComplete && styles.submitBtnDisabled]}
                onPress={() => {
                  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleAnswer(joinWithSpaces(boxChars));
                }}
                disabled={answered || !boxesComplete}
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
                <Text style={styles.nextBtnCountdown}>{Math.ceil(autoCountdown)}s</Text>
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
        {!spectator && !answered && !result && hasPoolPowerups && (
          <View style={styles.powerupBar}>
          {/* Freeze is solo-only. There is no per-player timer in a team game to
              stop -- one shared countdown belongs to everybody -- and the server
              answers a team freeze with 400 `teamTimer: true`. Offering a button
              that is guaranteed to fail is worse than not offering it. */}
          {pool.freeze > 0 && !teamMode && (
            <TouchableOpacity
              style={[styles.puBtn, isFrozen && styles.puBtnFreezeActive]}
              onPress={handleFreeze}
              disabled={answered || isFrozen || freezeBusy}
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
              disabled={answered || activePowerups.hint}
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
              disabled={answered || activePowerups.doublePoints}
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
              disabled={answered || activePowerups.shield}
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
            <View style={styles.drawerHighlight} />
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

  /* host-only stop button (header) */
  stopSessionBtn: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  stopSessionBtnText: {
    color: COLORS.danger,
    fontSize: 12,
    fontFamily: FONTS.extraBold,
  },

  /* non-host leave button (header) */
  leaveSessionBtn: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    backgroundColor: 'rgba(148,163,184,0.14)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  leaveSessionBtnText: {
    color: COLORS.textSecondary,
    fontSize: 12,
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
  // A column, not a row. With the verdict and the answer sharing a line, an
  // answer long enough to wrap dropped below the "Incorrect" label and drifted
  // out from under it, so the box grew taller without the verdict staying put
  // beside it. Stacked, the answer always starts at the same x as the verdict
  // no matter how long it is.
  resultStripMain: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
  },
  // Not clamped. An identification answer can be a full sentence, so this used
  // to carry `numberOfLines={3}` + a "three lines covers every answer" rule --
  // which is exactly how a student ended up reading a shortened answer next to
  // a complete explanation. Typed answers are capped at 5 words by the
  // generation prompt, so the strip stays a couple of lines tall in practice.
  resultAnswerLine: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 19,
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
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: '#34D399',
  },
  /* The verdict takes the strip's own colour. It used to be hardcoded green, so
     "Incorrect" rendered green inside the red strip it is warning about. */
  resultStripLabelWrong: {
    color: '#FCA5A5',
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
  /* True/False: one big centered button per answer, no letter chip. */
  choiceTf: {
    justifyContent: 'center',
    minHeight: 62,
  },
  choiceTfText: {
    textAlign: 'center',
    fontSize: 18,
    fontFamily: FONTS.bold,
  },
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
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
    maxHeight: SCREEN_HEIGHT * 0.62,
    // The same lift as the question card this drawer is read as a continuation
    // of. It used to be y20 / .5 / r60, which read as a separate sheet floating
    // over the screen instead of the card continuing downward.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 16,
  },
  /** Mirrors styles.cardHighlight so the drawer starts with the same edge
      highlight the question card has. Needs the drawer's overflow: 'hidden'. */
  drawerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  standingsDrawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
  // Was a flat SCREEN_HEIGHT * 0.38, which clipped the list well short of the
  // drawer's own ceiling and so made a two-player room scroll like a full one.
  // Now it takes the height it needs up to a cap: a short room gets a short
  // drawer, and a long one still scrolls instead of running off the screen.
  standingsScroll: { flexGrow: 0, maxHeight: SCREEN_HEIGHT * 0.52 },
  standingsTeamsBlock: { marginBottom: 12 },
  standingsBlockLabel: {
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 2,
    color: COLORS.textMuted,
    marginBottom: 8,
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
  // 10px was two steps below the rows it labels; on cardBg the muted grey also
  // had less contrast to work with than it did on the old bgSecondary.
  srSub: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 1 },

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

  /* spectator team board */
  specPanel: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    marginTop: 14,
  },
  specHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  specHeadTitle: {
    flex: 1,
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 2,
    color: COLORS.textMuted,
  },
  specHeadMeta: {
    fontSize: 10,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  specRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  specRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  specDot: { width: 10, height: 10, borderRadius: 5 },
  specName: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: '#E2E8F0',
  },
  specPickCount: {
    fontSize: 12,
    fontFamily: FONTS.extraBold,
    color: COLORS.accent,
  },
  specScore: {
    fontSize: 14,
    fontFamily: FONTS.black,
    color: '#fff',
    minWidth: 48,
    textAlign: 'right',
  },
  specAnswer: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    marginTop: 5,
    marginLeft: 18,
    lineHeight: 16,
  },
  specDots: { flexDirection: 'row', gap: 5, marginTop: 8, marginLeft: 18 },
  specDotSm: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  specDotSmOn: { backgroundColor: COLORS.accent },
  specAvatars: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 9, marginLeft: 18 },
  specAvatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  specAvatarFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(124,58,237,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  specAvatarText: { fontSize: 10, fontFamily: FONTS.extraBold, color: '#E2E8F0' },
  specMore: { fontSize: 10, fontFamily: FONTS.semiBold, color: COLORS.textMuted, marginLeft: 2 },

  /* LAN waiting screen */
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  waitingTitle: { color: COLORS.textPrimary, fontFamily: FONTS.bold, fontSize: 18, marginTop: 20, textAlign: 'center' },
  waitingSub: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 13, marginTop: 6, textAlign: 'center' },
  waitingWarn: { color: '#FBBF24', fontFamily: FONTS.medium, fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20, marginHorizontal: 24 },
  waitingError: { color: '#F87171', fontFamily: FONTS.medium, fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20, marginHorizontal: 24 },
  backButton: { marginTop: 24, backgroundColor: COLORS.purplePrimary, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, alignItems: 'center' },
  backButtonText: { color: COLORS.textPrimary, fontFamily: FONTS.semiBold, fontSize: 14 },
});