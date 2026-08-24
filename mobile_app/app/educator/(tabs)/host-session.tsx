import { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TouchableWithoutFeedback, StyleSheet, Alert,
  ActivityIndicator, Platform, StatusBar, Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import firestore from '@react-native-firebase/firestore';
import { getToken, getCurrentUser } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ScreenOrientation from 'expo-screen-orientation';

const COLORS = {
  bg: '#0f0c29',
  bgSecondary: '#1a1640',
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  cardBg: '#232052',
  purpleDeep: '#4C1D95',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
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

type RoomStatus = 'waiting' | 'active' | 'finished';

interface Player {
  id: string;
  displayName?: string;
  score?: number;
  answeredCount?: number;
  isFinished?: boolean;
  [key: string]: any;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/* ── leaderboard row: staggered entrance + score count-up (mirrors question.tsx StandingsRow) ── */
function LeaderRow({ item, index, questionCount, showProgress, teamColor }: { item: Player; index: number; questionCount: number; showProgress: boolean; teamColor?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(item.score ?? 0)).current;
  const [displayScore, setDisplayScore] = useState(item.score ?? 0);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 280, delay: index * 90, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    Animated.timing(scoreAnim, { toValue: item.score ?? 0, duration: 500, useNativeDriver: false }).start();
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    return () => scoreAnim.removeListener(id);
  }, [item.score]);

  const answered = item.answeredCount ?? 0;
  const percent = questionCount > 0 ? Math.min(100, Math.round((answered / questionCount) * 100)) : 0;
  const finished = !!item.isFinished;

  return (
    <Animated.View
      style={[
        styles.leaderRow,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <Text style={styles.rankText}>{MEDALS[index] || `${index + 1}.`}</Text>
      <View style={styles.leaderBody}>
        <View style={styles.leaderNameRow}>
          <Text style={styles.leaderName} numberOfLines={1}>{item.displayName}</Text>
          {teamColor && <View style={[styles.teamDot, { backgroundColor: teamColor }]} />}
          {finished && <Ionicons name="checkmark-circle" size={15} color={COLORS.success} />}
        </View>
        <Text style={styles.leaderMeta}>{answered}/{questionCount} answered</Text>
        {showProgress && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.leaderScore}>{displayScore.toLocaleString()}</Text>
    </Animated.View>
  );
}

/* ── team leaderboard row (phone) ── */
function TeamRow({ team, index, memberCount }: { team: any; index: number; memberCount: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(team.score ?? 0)).current;
  const [displayScore, setDisplayScore] = useState(team.score ?? 0);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 280, delay: index * 90, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    Animated.timing(scoreAnim, { toValue: team.score ?? 0, duration: 500, useNativeDriver: false }).start();
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    return () => scoreAnim.removeListener(id);
  }, [team.score]);

  return (
    <Animated.View
      style={[
        styles.leaderRow,
        { borderColor: team.color + '55', backgroundColor: team.color + '0d' },
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <Text style={[styles.rankText, { color: team.color }]}>{MEDALS[index] || `${index + 1}.`}</Text>
      <View style={styles.leaderBody}>
        <View style={styles.leaderNameRow}>
          <View style={[styles.teamDot, { backgroundColor: team.color }]} />
          <Text style={styles.leaderName} numberOfLines={1}>{team.name}</Text>
        </View>
        <Text style={styles.leaderMeta}>
          {memberCount} {memberCount === 1 ? 'member' : 'members'} · {team.answeredCount ?? 0} answers
        </Text>
      </View>
      <Text style={styles.leaderScore}>{displayScore.toLocaleString()}</Text>
    </Animated.View>
  );
}

/* ── presentation leaderboard row: scaled-up LeaderRow for TV ── */
function PresentRow({ item, index, questionCount, teamColor }: { item: Player; index: number; questionCount: number; teamColor?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(item.score ?? 0)).current;
  const [displayScore, setDisplayScore] = useState(item.score ?? 0);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 300, delay: index * 100, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    Animated.timing(scoreAnim, { toValue: item.score ?? 0, duration: 600, useNativeDriver: false }).start();
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    return () => scoreAnim.removeListener(id);
  }, [item.score]);

  const answered = item.answeredCount ?? 0;
  const percent = questionCount > 0 ? Math.min(100, Math.round((answered / questionCount) * 100)) : 0;
  const finished = !!item.isFinished;

  return (
    <Animated.View
      style={[
        styles.presentRow,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <Text style={styles.presentRank}>{MEDALS[index] || `${index + 1}.`}</Text>
      <View style={styles.presentRowAvatar}>
        <Text style={styles.presentRowAvatarText}>{(item.displayName || '?').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.presentRowBody}>
        <View style={styles.presentRowNameRow}>
          <Text style={styles.presentRowName} numberOfLines={1}>{item.displayName}</Text>
          {teamColor && <View style={[styles.presentTeamDot, { backgroundColor: teamColor }]} />}
          {finished && <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />}
        </View>
        <Text style={styles.presentRowMeta}>{answered}/{questionCount} answered</Text>
        <View style={styles.presentProgressTrack}>
          <View style={[styles.presentProgressFill, { width: `${percent}%` }]} />
        </View>
      </View>
      <Text style={styles.presentRowScore}>{displayScore.toLocaleString()}</Text>
    </Animated.View>
  );
}

/* ── presentation team row (TV) ── */
function PresentTeamRow({ team, index, memberCount }: { team: any; index: number; memberCount: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(team.score ?? 0)).current;
  const [displayScore, setDisplayScore] = useState(team.score ?? 0);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 300, delay: index * 100, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    Animated.timing(scoreAnim, { toValue: team.score ?? 0, duration: 600, useNativeDriver: false }).start();
    const id = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    return () => scoreAnim.removeListener(id);
  }, [team.score]);

  return (
    <Animated.View
      style={[
        styles.presentRow,
        { borderColor: team.color + '66', backgroundColor: team.color + '0d' },
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <Text style={[styles.presentRank, { color: team.color }]}>{MEDALS[index] || `${index + 1}.`}</Text>
      <View style={[styles.presentRowAvatar, { borderColor: team.color, backgroundColor: team.color + '22' }]}>
        <Text style={[styles.presentRowAvatarText, { color: team.color }]}>{(team.name || 'T').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.presentRowBody}>
        <View style={styles.presentRowNameRow}>
          <Text style={styles.presentRowName} numberOfLines={1}>{team.name}</Text>
        </View>
        <Text style={styles.presentRowMeta}>
          {memberCount} {memberCount === 1 ? 'member' : 'members'} · {team.answeredCount ?? 0} answers
        </Text>
      </View>
      <Text style={styles.presentRowScore}>{displayScore.toLocaleString()}</Text>
    </Animated.View>
  );
}

/* ── full-screen TV presentation (self-paced: big live leaderboard + controls) ── */
function PresentationView({
  status, codeChars, topic, students, ranked, questionCount, finishedCount, playerCount,
  livePulse, phaseAnim, codeAnim, listAnim, loading,
  teamMode, teams, rankedTeams, allAssigned, teamColorOf,
  onStart, onEnd, onBack, onExit,
}: {
  status: RoomStatus;
  codeChars: string[];
  topic: string;
  students: Player[];
  ranked: Player[];
  questionCount: number;
  finishedCount: number;
  playerCount: number;
  livePulse: Animated.Value;
  phaseAnim: Animated.Value;
  codeAnim: Animated.Value;
  listAnim: Animated.Value;
  loading: boolean;
  teamMode: boolean;
  teams: any[];
  rankedTeams: any[];
  allAssigned: boolean;
  teamColorOf: (teamId?: string) => string | undefined;
  onStart: () => void;
  onEnd: () => void;
  onBack: () => void;
  onExit: () => void;
}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const ctaBtnScale = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  };

  useEffect(() => {
    showControls();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  useEffect(() => {
    Animated.timing(controlsAnim, { toValue: controlsVisible ? 1 : 0, duration: 260, useNativeDriver: true }).start();
  }, [controlsVisible]);

  const animatePressIn = () => {
    Animated.spring(ctaBtnScale, { toValue: 0.96, friction: 8, tension: 120, useNativeDriver: true }).start();
  };
  const animatePressOut = () => {
    Animated.spring(ctaBtnScale, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }).start();
  };

  const slide = (v: Animated.Value, out: number) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [out, 0] }) }],
  });

  return (
    <TouchableWithoutFeedback onPress={showControls}>
      <View style={styles.presentRoot}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

        <View style={styles.presentHeader}>
          <Text style={styles.presentTopic} numberOfLines={1}>{topic || 'Quiz Battle'}</Text>
          <View style={styles.presentHeaderRight}>
            <View style={styles.presentCountPill}>
              <Ionicons name="people" size={18} color={COLORS.accent} />
              <Text style={styles.presentCountText}>{playerCount}</Text>
            </View>
            <TouchableOpacity style={styles.presentExitBtn} onPress={onExit} activeOpacity={0.7}>
              <Ionicons name="tv" size={16} color={COLORS.textSecondary} />
              <Text style={styles.presentExitText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Animated.View key={status} style={[{ flex: 1 }, slide(phaseAnim, 30)]}>
          {status === 'waiting' && (
            <View style={styles.presentBody}>
              <Animated.View style={slide(codeAnim, 36)}>
                <Text style={styles.presentCodeLabel}>ROOM CODE</Text>
                <View style={styles.presentCodeRow}>
                  {codeChars.map((ch, i) => (
                    <View key={i} style={styles.presentCodeChip}>
                      <Text style={styles.presentCodeChipText}>{ch}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.presentCodeHint}>Share this code — students join via Play → Classic → Join Room</Text>
              </Animated.View>

              <Animated.View style={[styles.presentBody, slide(listAnim, 36)]}>
                <View style={styles.presentRosterHead}>
                  <Text style={styles.presentRosterKicker}>JOINED STUDENTS</Text>
                  <View style={styles.presentWaitingTag}>
                    <Animated.View
                      style={[styles.presentWaitingDot, { opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]}
                    />
                    <Text style={styles.presentWaitingText}>{playerCount === 0 ? 'Waiting for students...' : 'Room open'}</Text>
                  </View>
                </View>

                {playerCount === 0 ? (
                  <View style={styles.presentGhost}>
                    <Ionicons name="person" size={30} color={COLORS.textMuted} />
                    <Text style={styles.presentGhostText}>Waiting for students to join...</Text>
                  </View>
                ) : (
                  <ScrollView contentContainerStyle={styles.presentRosterList} showsVerticalScrollIndicator={false}>
                    {students.map((item) => {
                      const initial = (item.displayName || '?').charAt(0).toUpperCase();
                      const teamColor = teamMode ? teamColorOf(item.teamId) : undefined;
                      return (
                        <View key={item.id} style={styles.presentPlayerCard}>
                          <View style={styles.presentAvatar}><Text style={styles.presentAvatarText}>{initial}</Text></View>
                          <Text style={styles.presentPlayerName} numberOfLines={1}>{item.displayName}</Text>
                          {teamColor && <View style={[styles.presentTeamDot, { backgroundColor: teamColor }]} />}
                          <View style={[styles.presentPlayerReady, !item.teamId && { backgroundColor: COLORS.warning }]} />
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </Animated.View>
            </View>
          )}

          {(status === 'active' || status === 'finished') && (
            <View style={styles.presentBody}>
              {teamMode && rankedTeams.length > 0 && (
                <Animated.View style={{ ...slide(listAnim, 36) }}>
                  <View style={styles.presentBoardHead}>
                    <Text style={styles.presentBlockKicker}>TEAM STANDINGS</Text>
                    <View style={styles.presentFinishTag}>
                      <Text style={styles.presentFinishText}>{rankedTeams.length} team{rankedTeams.length === 1 ? '' : 's'}</Text>
                    </View>
                  </View>
                  {status === 'finished' && (
                    <View style={styles.presentPodium}>
                      {[1, 0, 2].map((rankIdx) => {
                        const t = rankedTeams[rankIdx];
                        if (!t) return <View key={rankIdx} style={styles.presentPodiumSlot} />;
                        return (
                          <View key={rankIdx} style={styles.presentPodiumSlot}>
                            <Text style={styles.presentPodiumRank}>{MEDALS[rankIdx]}</Text>
                            <View style={[styles.presentPodiumAvatar, { borderColor: t.color, backgroundColor: t.color + '22' }]}>
                              <Text style={[styles.presentPodiumAvatarText, { color: t.color }]}>{(t.name || 'T').charAt(0).toUpperCase()}</Text>
                            </View>
                            <Text style={styles.presentPodiumName} numberOfLines={1}>{t.name}</Text>
                            <Text style={styles.presentPodiumScore}>{(t.score ?? 0).toLocaleString()}</Text>
                            <View style={[styles.presentPodiumBase, { height: rankIdx === 0 ? 150 : rankIdx === 1 ? 110 : 90, backgroundColor: t.color }]} />
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <View style={styles.presentTeamList}>
                    {rankedTeams.map((t, index) => (
                      <PresentTeamRow key={t.id} team={t} index={index} memberCount={students.filter(s => String(s.teamId) === String(t.id)).length} />
                    ))}
                  </View>
                </Animated.View>
              )}
              <Animated.View style={{ flex: 1, ...slide(listAnim, 36) }}>
                <View style={styles.presentBoardHead}>
                  <Text style={styles.presentBoardKicker}>{status === 'active' ? 'LIVE LEADERBOARD' : 'FINAL RESULTS'}</Text>
                  <View style={styles.presentFinishTag}>
                    {status === 'active' ? (
                      <>
                        <Animated.View
                          style={[styles.presentLiveDot, {
                            opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                            transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) }],
                          }]}
                        />
                        <Text style={styles.presentFinishText}>{finishedCount} of {playerCount} finished</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="trophy" size={18} color={COLORS.warning} />
                        <Text style={styles.presentFinishText}>GAME COMPLETE</Text>
                      </>
                    )}
                  </View>
                </View>

                {status === 'finished' && ranked.length > 0 && (
                  <View style={styles.presentPodium}>
                    {[1, 0, 2].map((rankIdx) => {
                      const p = ranked[rankIdx];
                      if (!p) return <View key={rankIdx} style={styles.presentPodiumSlot} />;
                      const initial = (p.displayName || '?').charAt(0).toUpperCase();
                      return (
                        <View key={rankIdx} style={styles.presentPodiumSlot}>
                          <Text style={styles.presentPodiumRank}>{MEDALS[rankIdx]}</Text>
                          <View style={styles.presentPodiumAvatar}><Text style={styles.presentPodiumAvatarText}>{initial}</Text></View>
                          <Text style={styles.presentPodiumName} numberOfLines={1}>{p.displayName}</Text>
                          <Text style={styles.presentPodiumScore}>{p.score?.toLocaleString()}</Text>
                          <View style={[styles.presentPodiumBase, { height: rankIdx === 0 ? 150 : rankIdx === 1 ? 110 : 90 }]} />
                        </View>
                      );
                    })}
                  </View>
                )}

                {ranked.length === 0 ? (
                  <View style={styles.presentGhost}>
                    <Ionicons name="radio" size={30} color={COLORS.textMuted} />
                    <Text style={styles.presentGhostText}>No students joined this session.</Text>
                  </View>
                ) : (
                  <ScrollView contentContainerStyle={styles.presentList} showsVerticalScrollIndicator={false}>
                    {ranked.map((item, index) => (
                      <PresentRow
                        key={item.id}
                        item={item}
                        index={index}
                        questionCount={questionCount}
                        teamColor={teamMode ? teamColorOf(item.teamId) : undefined}
                      />
                    ))}
                  </ScrollView>
                )}
              </Animated.View>
            </View>
          )}
        </Animated.View>

        <Animated.View
          pointerEvents={controlsVisible ? 'auto' : 'none'}
          style={[styles.presentControls, { opacity: controlsAnim }]}
        >
          {status === 'waiting' ? (
            <Animated.View style={{ transform: [{ scale: ctaBtnScale }] }}>
              <TouchableOpacity
                style={styles.presentStartWrap}
                onPress={onStart}
                onPressIn={() => { if (!loading && playerCount > 0 && (!teamMode || allAssigned)) animatePressIn(); }}
                onPressOut={animatePressOut}
                disabled={loading || playerCount === 0 || (teamMode && !allAssigned)}
                activeOpacity={0.85}
              >
                {loading ? (
                  <View style={styles.presentStartInnerDisabled}><ActivityIndicator color="#fff" /></View>
                ) : playerCount === 0 ? (
                  <View style={styles.presentStartInnerDisabled}>
                    <Ionicons name="play" size={20} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                    <Text style={[styles.presentStartText, { color: COLORS.textMuted }]}>Waiting for players...</Text>
                  </View>
                ) : (teamMode && !allAssigned) ? (
                  <View style={styles.presentStartInnerDisabled}>
                    <Ionicons name="people" size={20} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                    <Text style={[styles.presentStartText, { color: COLORS.textMuted }]}>Waiting for teams...</Text>
                  </View>
                ) : (
                  <LinearGradient
                    colors={[COLORS.accent, '#06B6D4']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.presentStartInner}
                  >
                    <Ionicons name="play" size={20} color={COLORS.bg} style={{ marginRight: 8 }} />
                    <Text style={styles.presentStartText}>Start Game</Text>
                  </LinearGradient>
                )}
              </TouchableOpacity>
            </Animated.View>
          ) : status === 'active' ? (
            <Animated.View style={{ transform: [{ scale: ctaBtnScale }] }}>
              <TouchableOpacity
                style={styles.presentEndWrap}
                onPress={onEnd}
                onPressIn={() => { if (!loading) animatePressIn(); }}
                onPressOut={animatePressOut}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <View style={styles.presentStartInnerDisabled}><ActivityIndicator color={COLORS.danger} /></View>
                ) : (
                  <View style={styles.presentEndInner}>
                    <Ionicons name="stop-circle" size={20} color={COLORS.danger} style={{ marginRight: 8 }} />
                    <Text style={styles.presentEndText}>End Session Now</Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ scale: ctaBtnScale }] }}>
              <TouchableOpacity
                style={styles.presentStartWrap}
                onPress={onBack}
                onPressIn={animatePressIn}
                onPressOut={animatePressOut}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[COLORS.accent, '#06B6D4']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.presentStartInner}
                >
                  <Ionicons name="home" size={20} color={COLORS.bg} style={{ marginRight: 8 }} />
                  <Text style={styles.presentStartText}>Back to Dashboard</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          )}
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

export default function HostSessionScreen() {
  const router = useRouter();
  const { roomCode, topic } = useLocalSearchParams<{ roomCode: string; topic: string }>();
  const code = String(roomCode || '');

  const [status, setStatus] = useState<RoomStatus>('waiting');
  const [hostId, setHostId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  const [roomMissing, setRoomMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [presenting, setPresenting] = useState(false);

  /* ── UI-only animation refs ── */
  const codeAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const ctaAnim = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;
  const phaseAnim = useRef(new Animated.Value(1)).current;
  const ctaBtnScale = useRef(new Animated.Value(1)).current;

  const animatePressIn = () => {
    Animated.spring(ctaBtnScale, { toValue: 0.96, friction: 8, tension: 120, useNativeDriver: true }).start();
  };
  const animatePressOut = () => {
    Animated.spring(ctaBtnScale, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }).start();
  };

  useEffect(() => {
    getCurrentUser().then((u) => setCurrentUserId(u ? String(u.id) : null));
  }, []);

  useEffect(() => {
    codeAnim.setValue(0); listAnim.setValue(0); ctaAnim.setValue(0);
    Animated.stagger(90, [
      Animated.spring(codeAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.spring(listAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.timing(ctaAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(livePulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(livePulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  /* ── phase transition: slide the new phase in when status changes ── */
  useEffect(() => {
    phaseAnim.setValue(0);
    Animated.spring(phaseAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }).start();
  }, [status]);

  useEffect(() => {
    if (!code) return;

    const unsubRoom = firestore()
      .collection('gameRooms')
      .doc(code)
      .onSnapshot((snap) => {
        const data = snap.data();
        if (!data) {
          setRoomMissing(true);
          return;
        }
        setRoomMissing(false);
        setStatus(data.status ?? 'waiting');
        setHostId(String(data.hostId ?? ''));
        setTeamMode(!!data.teamMode);
        setQuestionCount(data.questionCount ?? data.questions?.length ?? 0);
      });

    const unsubPlayers = firestore()
      .collection('gameRooms')
      .doc(code)
      .collection('players')
      .onSnapshot((snap) => {
        setPlayers((snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []) as Player[]);
      });

    return () => { unsubRoom(); unsubPlayers(); };
  }, [code]);

  /* ── teams subscription (team mode only) ── */
  useEffect(() => {
    if (!teamMode || !code) {
      setTeams([]);
      return;
    }
    const unsubTeams = firestore()
      .collection('gameRooms')
      .doc(code)
      .collection('teams')
      .onSnapshot((snap) => {
        setTeams((snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []) as any[]);
      });
    return () => { unsubTeams(); };
  }, [teamMode, code]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/start/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEndSession = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/game/finish/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const goHome = () => router.replace('/educator/dashboard');

  const students = players.filter((p) => p.id !== hostId && p.id !== currentUserId);
  const ranked = [...students].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const rankedTeams = [...teams].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const allAssigned = players.length > 0 && players.every((p) => p.teamId);
  const teamColorOf = (teamId?: string) => {
    if (!teamMode || !teamId) return undefined;
    return teams.find((t) => String(t.id) === String(teamId))?.color;
  };
  const codeChars = code.split('');
  const playerCount = students.length;

  if (roomMissing) {
    return (
      <LinearGradient
        colors={[COLORS.bg, COLORS.bgSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.container}
      >
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backChip} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={18} color={COLORS.purpleLight} />
            <Text style={styles.backChipText}>Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.missingWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.warning} />
          <Text style={styles.missingTitle}>Room not found</Text>
          <Text style={styles.missingText}>This session is no longer available.</Text>
          <TouchableOpacity style={styles.startWrap} onPress={goHome} activeOpacity={0.85}>
            <LinearGradient
              colors={[COLORS.accent, '#06B6D4']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.startInner}
            >
              <Text style={styles.startText}>Back to Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  const statusLabel = status === 'waiting' ? 'WAITING' : status === 'active' ? 'IN PROGRESS' : 'FINISHED';
  const statusColor = status === 'waiting' ? COLORS.warning : status === 'active' ? COLORS.success : COLORS.accent;

  return (
    <LinearGradient
      colors={[COLORS.bg, COLORS.bgSecondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* ── header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backChip} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={18} color={COLORS.purpleLight} />
          <Text style={styles.backChipText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <View style={styles.countPill}>
            <Ionicons name="people" size={14} color={COLORS.accent} />
            <Text style={styles.countPillText}>{playerCount}</Text>
          </View>
        </View>
      </View>

      <View style={styles.titleRow}>
        <View style={styles.titleLeft}>
          <Text style={styles.kicker}>HOST SESSION</Text>
          <Text style={styles.title} numberOfLines={1}>{topic || 'Quiz Battle'}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: statusColor }]}>
          <Animated.View
            style={[styles.statusDot, { backgroundColor: statusColor, opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]}
          />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View
          key={status}
          style={{
            opacity: phaseAnim,
            transform: [{ translateY: phaseAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          }}
        >
        {status === 'waiting' && (
          <>
            {/* ── room code card ── */}
            <Animated.View
              style={[styles.codeCard, {
                opacity: codeAnim,
                transform: [{ translateY: codeAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
              }]}
            >
              <View style={styles.cardEdge} />
              <View style={styles.codeTopRow}>
                <View style={styles.codeTab}><Text style={styles.codeTabText}>ROOM CODE</Text></View>
                <View style={styles.openPill}>
                  <Animated.View
                    style={[styles.openDot, {
                      opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                      transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) }],
                    }]}
                  />
                  <Text style={styles.openText}>OPEN</Text>
                </View>
              </View>

              <View style={styles.codeChips}>
                {codeChars.map((ch, i) => (
                  <View key={i} style={styles.codeChip}>
                    <Text style={styles.codeChipText}>{ch}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.codeHint}>Share this code — students join via Play → Classic → Join Room</Text>
            </Animated.View>

            {/* ── roster ── */}
            <Animated.View
              style={{
                opacity: listAnim,
                transform: [{ translateY: listAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
              }}
            >
              <View style={styles.rosterHead}>
                <Text style={styles.rosterKicker}>JOINED STUDENTS</Text>
                <View style={styles.waitingTag}>
                  <Animated.View
                    style={[styles.waitingDot, { opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]}
                  />
                  <Text style={styles.waitingTagText}>{playerCount === 0 ? 'Waiting for students...' : 'Room open'}</Text>
                </View>
              </View>

              {playerCount === 0 ? (
                <View style={styles.ghostSeat}>
                  <View style={styles.ghostAvatar}>
                    <Ionicons name="person" size={18} color={COLORS.textMuted} />
                  </View>
                  <Text style={styles.ghostText}>Waiting for students to join...</Text>
                </View>
              ) : (
                students.map((item) => {
                  const initial = (item.displayName || '?').charAt(0).toUpperCase();
                  const teamColor = teamMode ? teamColorOf(item.teamId) : undefined;
                  return (
                    <View key={item.id} style={styles.playerCard}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initial}</Text>
                      </View>
                      <Text style={styles.playerName} numberOfLines={1}>{item.displayName}</Text>
                      {teamColor && <View style={[styles.teamDot, { backgroundColor: teamColor }]} />}
                      <View style={[styles.readyDot, teamMode && !item.teamId && { backgroundColor: COLORS.warning }]} />
                    </View>
                  );
                })
              )}
            </Animated.View>
          </>
        )}

        {(status === 'active' || status === 'finished') && (
          <Animated.View
            style={{
              opacity: listAnim,
              transform: [{ translateY: listAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            }}
          >
            <View style={styles.rosterHead}>
              <Text style={styles.rosterKicker}>{status === 'active' ? 'LIVE LEADERBOARD' : 'FINAL RESULTS'}</Text>
              <View style={styles.waitingTag}>
                <Ionicons name="trophy" size={14} color={COLORS.warning} />
                <Text style={styles.waitingTagText}>{playerCount} {playerCount === 1 ? 'player' : 'players'}</Text>
              </View>
            </View>

            {teamMode && rankedTeams.length > 0 && (
              <View style={styles.teamsBlock}>
                <Text style={styles.blockKicker}>TEAM STANDINGS</Text>
                {rankedTeams.map((t, index) => (
                  <TeamRow key={t.id} team={t} index={index} memberCount={students.filter(s => String(s.teamId) === String(t.id)).length} />
                ))}
                <View style={styles.blockDivider} />
              </View>
            )}

            {ranked.length === 0 ? (
              <View style={styles.ghostSeat}>
                <View style={styles.ghostAvatar}>
                  <Ionicons name="radio" size={18} color={COLORS.textMuted} />
                </View>
                <Text style={styles.ghostText}>No students joined this session.</Text>
              </View>
            ) : (
              ranked.map((item, index) => (
                <LeaderRow
                  key={item.id}
                  item={item}
                  index={index}
                  questionCount={questionCount}
                  showProgress={status === 'active'}
                  teamColor={teamMode ? teamColorOf(item.teamId) : undefined}
                />
              ))
            )}
          </Animated.View>
        )}
        </Animated.View>
      </ScrollView>

      {/* ── bottom CTA bar ── */}
      <Animated.View
        style={[styles.bottomBar, {
          opacity: ctaAnim,
          transform: [{ translateY: ctaAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }]}
      >
        {status === 'waiting' ? (
          <Animated.View style={{ transform: [{ scale: ctaBtnScale }] }}>
            <TouchableOpacity
              style={styles.startWrap}
              onPress={handleStart}
              onPressIn={() => { if (!loading && playerCount > 0 && (!teamMode || allAssigned)) animatePressIn(); }}
              onPressOut={animatePressOut}
              disabled={loading || playerCount === 0 || (teamMode && !allAssigned)}
              activeOpacity={0.85}
            >
              {loading ? (
                <View style={styles.startInnerDisabled}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : playerCount === 0 ? (
                <View style={styles.startInnerDisabled}>
                  <Ionicons name="play" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                  <Text style={[styles.startText, { color: COLORS.textMuted }]}>Waiting for players...</Text>
                </View>
              ) : (teamMode && !allAssigned) ? (
                <View style={styles.startInnerDisabled}>
                  <Ionicons name="people" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                  <Text style={[styles.startText, { color: COLORS.textMuted }]}>Waiting for teams...</Text>
                </View>
              ) : (
                <LinearGradient
                  colors={[COLORS.accent, '#06B6D4']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.startInner}
                >
                  <Ionicons name="play" size={18} color={COLORS.bg} style={{ marginRight: 8 }} />
                  <Text style={styles.startText}>Start Game</Text>
                  <Text style={styles.startCount}> · {playerCount} {playerCount === 1 ? 'player' : 'players'}</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
          </Animated.View>
        ) : status === 'active' ? (
          <Animated.View style={{ transform: [{ scale: ctaBtnScale }] }}>
            <TouchableOpacity
              style={styles.endWrap}
              onPress={handleEndSession}
              onPressIn={() => { if (!loading) animatePressIn(); }}
              onPressOut={animatePressOut}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <View style={styles.startInnerDisabled}>
                  <ActivityIndicator color={COLORS.danger} />
                </View>
              ) : (
                <View style={styles.endInner}>
                  <Ionicons name="stop-circle" size={18} color={COLORS.danger} style={{ marginRight: 8 }} />
                  <Text style={styles.endText}>End Session Now</Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <Animated.View style={{ transform: [{ scale: ctaBtnScale }] }}>
            <TouchableOpacity
              style={styles.startWrap}
              onPress={goHome}
              onPressIn={animatePressIn}
              onPressOut={animatePressOut}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[COLORS.accent, '#06B6D4']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.startInner}
              >
                <Ionicons name="home" size={18} color={COLORS.bg} style={{ marginRight: 8 }} />
                <Text style={styles.startText}>Back to Dashboard</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },

  /* ── header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 8,
  },
  backChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(127,119,221,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.2)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backChipText: { color: COLORS.purpleLight, fontSize: 13, fontFamily: FONTS.semiBold },
  headerRight: {},
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  countPillText: { fontSize: 14, fontFamily: FONTS.extraBold, color: COLORS.accent },

  /* ── title row ── */
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  titleLeft: { flex: 1, paddingRight: 8 },
  kicker: { fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 2.5, color: COLORS.accent, marginBottom: 4 },
  title: { fontSize: 24, fontFamily: FONTS.black, color: COLORS.textPrimary, letterSpacing: -0.5 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(127,119,221,0.1)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1 },

  /* ── room code card ── */
  codeCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 14,
  },
  cardEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  codeTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  codeTab: { backgroundColor: COLORS.purplePrimary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  codeTabText: { color: COLORS.accent, fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },
  openPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  openText: { color: '#34D399', fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1 },
  codeChips: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
  codeChip: {
    width: 46,
    height: 58,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(34,211,238,0.35)',
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(34,211,238,0.2)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 3,
  },
  codeChipText: { fontSize: 26, fontFamily: FONTS.black, color: COLORS.textPrimary },
  codeHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', lineHeight: 17 },

  /* ── roster ── */
  rosterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  rosterKicker: { fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 2, color: COLORS.textSecondary },
  waitingTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waitingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.warning },
  waitingTagText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textMuted },

  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.18)',
    marginBottom: 10,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 18, fontFamily: FONTS.black, color: '#fff' },
  playerName: { flex: 1, fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary, flexShrink: 1 },
  readyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },

  /* ── leaderboard ── */
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.18)',
    marginBottom: 10,
  },
  rankText: { fontSize: 18, fontFamily: FONTS.black, color: COLORS.purpleVibrant, width: 34 },
  leaderBody: { flex: 1 },
  leaderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  leaderName: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, flexShrink: 1 },
  leaderMeta: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted, marginBottom: 6 },
  progressTrack: { height: 6, backgroundColor: 'rgba(139,92,246,0.18)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.purpleVibrant, borderRadius: 3 },
  leaderScore: { fontSize: 17, fontFamily: FONTS.black, color: COLORS.textPrimary },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  teamsBlock: { marginBottom: 4 },
  blockKicker: {
    fontSize: 10,
    fontFamily: FONTS.extraBold,
    letterSpacing: 2,
    color: COLORS.textMuted,
    marginBottom: 10,
    marginTop: 4,
  },
  blockDivider: {
    height: 1,
    backgroundColor: 'rgba(127,119,221,0.12)',
    marginVertical: 14,
  },

  /* ── empty ── */
  ghostSeat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(127,119,221,0.15)',
    borderStyle: 'dashed',
  },
  ghostAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(127,119,221,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ghostText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted },

  /* ── missing state ── */
  missingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  missingTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginTop: 8 },
  missingText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginBottom: 20 },

  /* ── bottom bar ── */
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(127,119,221,0.12)',
    backgroundColor: 'rgba(15,12,41,0.6)',
  },
  startWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  startInner: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  startInnerDisabled: {
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 16,
  },
  startText: { color: COLORS.bg, fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  startCount: { color: 'rgba(15,12,41,0.7)', fontSize: 14, fontFamily: FONTS.bold },
  endWrap: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    overflow: 'hidden',
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  endInner: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  endText: { color: COLORS.danger, fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },

  /* ── presentation (TV) ── */
  presentRoot: { flex: 1, backgroundColor: COLORS.bg },
  presentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 8,
  },
  presentTopic: { fontSize: 22, fontFamily: FONTS.bold, color: COLORS.textPrimary, flex: 1, paddingRight: 16 },
  presentHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  presentCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  presentCountText: { fontSize: 16, fontFamily: FONTS.extraBold, color: COLORS.accent },
  presentExitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(127,119,221,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.25)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  presentExitText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textSecondary },

  presentBody: { flex: 1, paddingHorizontal: 32, paddingVertical: 12 },

  presentCodeLabel: {
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 3,
    color: COLORS.accent,
    textAlign: 'center',
    marginBottom: 12,
  },
  presentCodeRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 12 },
  presentCodeChip: {
    width: 72,
    height: 84,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(34,211,238,0.35)',
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(34,211,238,0.2)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  presentCodeChipText: { fontSize: 40, fontFamily: FONTS.black, color: COLORS.textPrimary },
  presentCodeHint: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center' },

  presentRosterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  presentRosterKicker: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 2.5, color: COLORS.textSecondary },
  presentWaitingTag: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presentWaitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.warning },
  presentWaitingText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  presentGhost: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 40 },
  presentGhostText: { fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  presentRosterList: { paddingBottom: 16 },
  presentPlayerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.18)',
    marginBottom: 12,
  },
  presentAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentAvatarText: { fontSize: 22, fontFamily: FONTS.black, color: '#fff' },
  presentPlayerName: { flex: 1, fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, flexShrink: 1 },
  presentPlayerReady: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.success },

  presentBoardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  presentBoardKicker: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 2.5, color: COLORS.textSecondary },
  presentBlockKicker: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 2.5, color: COLORS.accent },
  presentFinishTag: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presentLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  presentFinishText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textMuted },

  presentPodium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 16, marginBottom: 24 },
  presentPodiumSlot: { alignItems: 'center', width: 120 },
  presentPodiumRank: { fontSize: 34, marginBottom: 4 },
  presentPodiumAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(139,92,246,0.4)',
    marginBottom: 8,
  },
  presentPodiumAvatarText: { fontSize: 24, fontFamily: FONTS.black, color: '#fff' },
  presentPodiumName: { color: '#fff', fontSize: 15, fontFamily: FONTS.bold, marginBottom: 2 },
  presentPodiumScore: { color: COLORS.purpleLight, fontSize: 15, fontFamily: FONTS.extraBold, marginBottom: 6 },
  presentPodiumBase: {
    width: '100%',
    backgroundColor: '#2d2a6e',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.4)',
  },

  presentList: { paddingBottom: 16 },
  presentTeamList: { marginTop: 4 },
  presentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.18)',
    marginBottom: 12,
  },
  presentRank: { fontSize: 24, fontFamily: FONTS.black, color: COLORS.purpleVibrant, width: 44 },
  presentRowAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentRowAvatarText: { fontSize: 20, fontFamily: FONTS.black, color: '#fff' },
  presentRowBody: { flex: 1 },
  presentRowNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  presentRowName: { fontSize: 18, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, flexShrink: 1 },
  presentRowMeta: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, marginBottom: 8 },
  presentProgressTrack: { height: 8, backgroundColor: 'rgba(139,92,246,0.18)', borderRadius: 4, overflow: 'hidden' },
  presentProgressFill: { height: '100%', backgroundColor: COLORS.purpleVibrant, borderRadius: 4 },
  presentRowScore: { fontSize: 26, fontFamily: FONTS.black, color: COLORS.textPrimary },
  presentTeamDot: { width: 12, height: 12, borderRadius: 6 },

  presentControls: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  presentStartWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 10,
  },
  presentStartInner: {
    paddingVertical: 18,
    paddingHorizontal: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentStartInnerDisabled: {
    paddingVertical: 18,
    paddingHorizontal: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 18,
  },
  presentStartText: { color: COLORS.bg, fontSize: 18, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  presentEndWrap: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: COLORS.danger,
    overflow: 'hidden',
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  presentEndInner: {
    paddingVertical: 18,
    paddingHorizontal: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentEndText: { color: COLORS.danger, fontSize: 18, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
});
