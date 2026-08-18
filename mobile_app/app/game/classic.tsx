import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StatusBar, Animated
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

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
  purplePale: '#C4B5FD',
  purpleGhost: '#DDD6FE',

  accent: '#22D3EE',
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

interface SavedQuiz {
  id: number;
  title: string;
  quiz_type: string;
  created_at: string;
  questions: any[];
}

export default function ClassicGameSetupScreen() {
  const router = useRouter();
  const { mode: paramMode, teamMode: paramTeamMode } = useLocalSearchParams<{ mode?: string; teamMode?: string }>();
  const groupMode = paramMode === 'create' && paramTeamMode === 'true';
  const [joinCode, setJoinCode] = useState('');
  const [timePerQuestion, setTimePerQuestion] = useState('15');
  const [teamMode, setTeamMode] = useState(paramTeamMode === 'true');
  const [teamCount, setTeamCount] = useState(2);
  const [loading, setLoading] = useState(false);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [mode, setMode] = useState<'home' | 'create' | 'join'>(paramMode === 'create' ? 'create' : 'home');
  const [quizzes, setQuizzes] = useState<SavedQuiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<SavedQuiz | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [useFileUpload, setUseFileUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string; mimeType: string } | null>(null);
  const [segWidth, setSegWidth] = useState(0);

  /* ── original data effect (unchanged) ── */
  useEffect(() => {
    if (mode !== 'create') return;
    setSelectedQuiz(null);
    setUseFileUpload(false);
    setSelectedFile(null);
    const fetchQuizzes = async () => {
      setLoadingQuizzes(true);
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/ai/quizzes/`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) setQuizzes(await res.json());
      } catch { /* ignore */ }
      setLoadingQuizzes(false);
    };
    fetchQuizzes();
  }, [mode]);

  /* ── press-scale refs (original) ── */
  const createCardScale = useRef(new Animated.Value(1)).current;
  const joinCardScale = useRef(new Animated.Value(1)).current;

  /* ── new UI-only refs ── */
  const codeRefs = useRef<any[]>([]);
  const heroAnim = useRef(new Animated.Value(0)).current;
  const createCardAnim = useRef(new Animated.Value(0)).current;
  const joinCardAnim = useRef(new Animated.Value(0)).current;
  const stripAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;
  const segmentSlide = useRef(new Animated.Value(0)).current;

  const animatePressIn = (anim: Animated.Value) => {
    Animated.spring(anim, { toValue: 0.96, friction: 8, tension: 120, useNativeDriver: true }).start();
  };
  const animatePressOut = (anim: Animated.Value) => {
    Animated.spring(anim, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }).start();
  };

  /* ── entrance stagger + live pulse + segment slide (UI only) ── */
  useEffect(() => {
    if (mode === 'home') {
      heroAnim.setValue(0); createCardAnim.setValue(0); joinCardAnim.setValue(0); stripAnim.setValue(0);
      Animated.stagger(90, [
        Animated.spring(heroAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
        Animated.spring(createCardAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
        Animated.spring(joinCardAnim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }),
        Animated.timing(stripAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    } else {
      formAnim.setValue(0);
      Animated.timing(formAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }
  }, [mode]);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(livePulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(livePulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    Animated.spring(segmentSlide, { toValue: useFileUpload ? 1 : 0, friction: 8, tension: 80, useNativeDriver: true }).start();
  }, [useFileUpload]);

  /* ── join-code box handlers (feed the SAME joinCode state) ── */
  const handleCodeChange = (text: string, index: number) => {
    const char = text.slice(-1).toUpperCase();
    const slots = Array.from({ length: 6 }, (_, i) => joinCode[i] || '');
    slots[index] = char;
    // compact leftward so joinCode is always a clean contiguous string
    const next = slots.join('').replace(/\s/g, '').substring(0, 6);
    setJoinCode(next);
    const firstEmpty = Math.min(next.length, 5);
    codeRefs.current[firstEmpty]?.focus();
  };
  const handleCodeKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !joinCode[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
  };

  /* ── original handlers (unchanged) ── */
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setSelectedFile({ name: file.name, uri: file.uri, mimeType: file.mimeType || 'application/octet-stream' });
      }
    } catch (err: any) {
      console.error('Document pick error:', err);
      Alert.alert('Error', err?.message || 'Failed to pick document');
    }
  };

  const handleCreate = async () => {
    if (!selectedQuiz && !selectedFile) {
      Alert.alert('Error', 'Please select a quiz or upload study material');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (selectedQuiz) {
        const response = await fetch(`${API_BASE_URL}/game/create/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            quizId: selectedQuiz.id,
            timePerQuestion: parseInt(timePerQuestion) || 15,
            teamMode,
            teamCount: teamMode ? teamCount : undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create room');
        router.push({ pathname: '/game/lobby', params: { roomCode: data.roomCode, isHost: 'true', topic: data.topic, teamMode: data.teamMode ? 'true' : 'false' } });
      } else {
        const formData = new FormData();
        formData.append('file', { uri: selectedFile!.uri, name: selectedFile!.name, type: selectedFile!.mimeType } as any);
        formData.append('timePerQuestion', timePerQuestion);
        formData.append('teamMode', String(teamMode));
        formData.append('teamCount', String(teamCount));
        const response = await fetch(`${API_BASE_URL}/game/create/`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create room');
        router.push({ pathname: '/game/lobby', params: { roomCode: data.roomCode, isHost: 'true', topic: data.topic, teamMode: data.teamMode ? 'true' : 'false' } });
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Error', 'Please enter a room code');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/join/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ roomCode: joinCode.toUpperCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to join room');
      router.push({ pathname: '/game/lobby', params: { roomCode: joinCode.toUpperCase(), isHost: 'false', topic: data.topic, teamMode: data.teamMode ? 'true' : 'false' } });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const segPad = 4;
  const segInner = Math.max(0, segWidth - segPad * 2);
  const createDisabled = (!selectedQuiz && !selectedFile) || loading;
  const joinDisabled = !joinCode.trim() || loading;

  /* ═══════════════════════════════════════════════════════════
     HOME
     ═══════════════════════════════════════════════════════════ */
  if (mode === 'home') {
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
            <Text style={styles.backChipText}>Back to Hub</Text>
          </TouchableOpacity>
          <View style={styles.headerIconBox}>
            <Ionicons name="game-controller" size={18} color={COLORS.purpleLight} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.homeScroll} showsVerticalScrollIndicator={false}>
          {/* ── hero deck (stacked flash cards) ── */}
          <Animated.View
            style={[styles.heroDeck, {
              opacity: heroAnim,
              transform: [{ translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
            }]}
          >
            <View style={styles.heroCardBack2} />
            <View style={styles.heroCardBack1} />
            <View style={styles.heroCard}>
              <View style={styles.cardEdge} />
              <View style={styles.heroTopRow}>
                <View style={styles.heroTab}><Text style={styles.heroTabText}>{groupMode ? 'GROUP' : 'CLASSIC'}</Text></View>
                <View style={styles.livePill}>
                  <Animated.View
                    style={[styles.liveDot, {
                      opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                      transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }],
                    }]}
                  />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.heroBody}>
                <View style={styles.heroTextCol}>
                  <Text style={styles.heroTitle}>Quiz{'\n'}Battle</Text>
                  <Text style={styles.heroSub}>Host a room or jump into one — answer head-to-head in real time.</Text>
                </View>
                <View style={styles.heroTrophyWrap}>
                  <View style={styles.heroTrophyGlow} />
                  <LinearGradient
                    colors={[COLORS.purpleDeep, COLORS.purplePrimary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.heroTrophy}
                  >
                    <Ionicons name="trophy" size={34} color="#fff" />
                  </LinearGradient>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* ── HOST card ── */}
          <Animated.View style={{ opacity: createCardAnim, transform: [{ translateY: createCardAnim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }] }}>
            <Animated.View style={{ transform: [{ scale: createCardScale }] }}>
              <TouchableOpacity
                style={styles.actionWrap}
                onPress={() => setMode('create')}
                onPressIn={() => animatePressIn(createCardScale)}
                onPressOut={() => animatePressOut(createCardScale)}
                activeOpacity={1}
              >
                <LinearGradient
                  colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.actionFill}
                >
                  <View style={styles.cardEdge} />
                  <View style={styles.actionTab}><Text style={styles.actionTabText}>HOST</Text></View>
                  <View style={styles.actionRow}>
                    <View style={styles.actionIconChip}>
                      <Ionicons name="add-circle" size={22} color="#fff" />
                    </View>
                    <View style={styles.actionTextCol}>
                      <Text style={styles.actionTitle}>Create Room</Text>
                      <Text style={styles.actionDesc}>Upload materials or pick a saved quiz, then set the rules.</Text>
                    </View>
                    <View style={styles.actionArrow}>
                      <Ionicons name="arrow-forward" size={16} color="#fff" />
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* ── JOIN card ── */}
          <Animated.View style={{ opacity: joinCardAnim, transform: [{ translateY: joinCardAnim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }] }}>
            <Animated.View style={{ transform: [{ scale: joinCardScale }] }}>
              <TouchableOpacity
                style={styles.actionWrap}
                onPress={() => setMode('join')}
                onPressIn={() => animatePressIn(joinCardScale)}
                onPressOut={() => animatePressOut(joinCardScale)}
                activeOpacity={1}
              >
                <View style={styles.actionOutline}>
                  <View style={styles.cardEdgeSoft} />
                  <View style={styles.actionTabOutline}><Text style={styles.actionTabOutlineText}>JOIN</Text></View>
                  <View style={styles.actionRow}>
                    <View style={styles.actionIconChipOutline}>
                      <Ionicons name="enter" size={22} color={COLORS.purpleVibrant} />
                    </View>
                    <View style={styles.actionTextCol}>
                      <Text style={styles.actionTitleOutline}>Join Room</Text>
                      <Text style={styles.actionDescOutline}>Got a 6-character code? Jump straight into the battle.</Text>
                    </View>
                    <View style={styles.actionArrowOutline}>
                      <Ionicons name="arrow-forward" size={16} color={COLORS.purpleVibrant} />
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* ── feature strip (single bar, not three cards) ── */}
          <Animated.View
            style={[styles.featureStrip, {
              opacity: stripAnim,
              transform: [{ translateY: stripAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            }]}
          >
            <View style={styles.featureItem}>
              <Ionicons name="flash" size={15} color={COLORS.warning} />
              <Text style={styles.featureItemText}>Real-time</Text>
            </View>
            <View style={styles.featureDivider} />
            <View style={styles.featureItem}>
              <Ionicons name="people" size={15} color={COLORS.accent} />
              <Text style={styles.featureItemText}>Multiplayer</Text>
            </View>
            <View style={styles.featureDivider} />
            <View style={styles.featureItem}>
              <Ionicons name="document-text" size={15} color={COLORS.success} />
              <Text style={styles.featureItemText}>Custom content</Text>
            </View>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     CREATE / JOIN
     ═══════════════════════════════════════════════════════════ */
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={[COLORS.bg, COLORS.bgSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.fullScreen}
      >
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: formAnim, transform: [{ translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            {/* ── form header ── */}
            <View style={styles.formHeader}>
              <TouchableOpacity style={styles.backCircle} onPress={() => (groupMode ? router.back() : setMode('home'))} activeOpacity={0.7}>
                <Ionicons name="arrow-back" size={18} color={COLORS.purpleLight} />
              </TouchableOpacity>
              <View style={styles.formTitleCol}>
                <Text style={styles.formKicker}>{mode === 'create' ? (groupMode ? 'GROUP' : 'HOST') : 'JOIN'}</Text>
                <Text style={styles.formTitle}>{mode === 'create' ? (groupMode ? 'Create Group Room' : 'Create Room') : 'Join Room'}</Text>
              </View>
            </View>

            {mode === 'create' ? (
              <>
                {/* ── STEP 1 ── */}
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <View style={styles.stepTab}><Text style={styles.stepTabText}>S1</Text></View>
                    <Text style={styles.sectionTitle}>Choose Content</Text>
                  </View>

                  {/* segmented toggle */}
                  <View style={styles.segment} onLayout={(e) => setSegWidth(e.nativeEvent.layout.width)}>
                    <Animated.View
                      style={[styles.segmentIndicator, {
                        width: segInner / 2,
                        transform: [{ translateX: segmentSlide.interpolate({ inputRange: [0, 1], outputRange: [0, segInner / 2] }) }],
                      }]}
                    />
                    <TouchableOpacity style={styles.segmentBtn} onPress={() => setUseFileUpload(false)} activeOpacity={0.7}>
                      <Ionicons name="layers" size={15} color={!useFileUpload ? '#fff' : COLORS.textMuted} />
                      <Text style={[styles.segmentBtnText, !useFileUpload && styles.segmentBtnTextActive]}>Saved Quiz</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.segmentBtn} onPress={() => setUseFileUpload(true)} activeOpacity={0.7}>
                      <Ionicons name="cloud-upload" size={15} color={useFileUpload ? '#fff' : COLORS.textMuted} />
                      <Text style={[styles.segmentBtnText, useFileUpload && styles.segmentBtnTextActive]}>Upload File</Text>
                    </TouchableOpacity>
                  </View>

                  {useFileUpload ? (
                    <>
                      {/* upload card */}
                      <TouchableOpacity
                        style={[styles.uploadCard, selectedFile && styles.uploadCardDone]}
                        onPress={pickDocument}
                        activeOpacity={0.7}
                      >
                        <View style={styles.cardEdgeSoft} />
                        {selectedFile ? (
                          <>
                            <View style={styles.uploadIconDone}>
                              <Ionicons name="checkmark" size={22} color="#fff" />
                            </View>
                            <Text style={styles.uploadFileName}>{selectedFile.name}</Text>
                            <Text style={styles.uploadChangeHint}>Tap to change file</Text>
                          </>
                        ) : (
                          <>
                            <View style={styles.uploadIconIdle}>
                              <Ionicons name="cloud-upload" size={22} color="#fff" />
                            </View>
                            <Text style={styles.uploadTitle}>Select File</Text>
                            <Text style={styles.uploadSub}>Supports .txt and .pdf files</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      {/* dropdown trigger */}
                      <TouchableOpacity
                        style={styles.ddTrigger}
                        onPress={() => setShowDropdown(!showDropdown)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.ddTriggerLeft}>
                          <View style={styles.ddTriggerChip}>
                            <Ionicons name="layers" size={16} color={selectedQuiz ? COLORS.purpleVibrant : COLORS.textMuted} />
                          </View>
                          <Text style={[styles.ddTriggerText, !selectedQuiz && { color: COLORS.textMuted }]}>
                            {selectedQuiz ? selectedQuiz.title : 'Select a quiz...'}
                          </Text>
                        </View>
                        <Ionicons name={showDropdown ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                      </TouchableOpacity>

                      {selectedQuiz && (
                        <View style={styles.badgeRow}>
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{selectedQuiz.questions?.length || 0} questions</Text>
                          </View>
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{selectedQuiz.quiz_type}</Text>
                          </View>
                        </View>
                      )}

                      {showDropdown && (
                        <View style={styles.ddList}>
                          <View style={styles.cardEdgeSoft} />
                          {loadingQuizzes ? (
                            <ActivityIndicator color={COLORS.purpleVibrant} style={{ padding: 20 }} />
                          ) : quizzes.length === 0 ? (
                            <Text style={styles.ddEmpty}>No quizzes yet. Generate one in Activities.</Text>
                          ) : (
                            quizzes.map(q => (
                              <TouchableOpacity
                                key={q.id}
                                style={[styles.ddItem, selectedQuiz?.id === q.id && styles.ddItemActive]}
                                onPress={() => { setSelectedQuiz(q); setShowDropdown(false); }}
                                activeOpacity={0.7}
                              >
                                <View style={styles.ddItemBody}>
                                  <Text style={styles.ddItemTitle}>{q.title}</Text>
                                  <Text style={styles.ddItemMeta}>{q.questions?.length || 0} Qs · {q.quiz_type}</Text>
                                </View>
                                {selectedQuiz?.id === q.id && (
                                  <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                                )}
                              </TouchableOpacity>
                            ))
                          )}
                        </View>
                      )}
                    </>
                  )}
                </View>

                {/* ── STEP 2 ── */}
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <View style={styles.stepTab}><Text style={styles.stepTabText}>S2</Text></View>
                    <Text style={styles.sectionTitle}>Game Settings</Text>
                  </View>

                  <View style={styles.settingsCard}>
                    <View style={styles.cardEdgeSoft} />

                    {selectedQuiz && (
                      <>
                        <View style={styles.settingRow}>
                          <View style={styles.settingChip}>
                            <Ionicons name="list" size={16} color={COLORS.purpleVibrant} />
                          </View>
                          <View style={styles.settingBody}>
                            <Text style={styles.settingLabel}>Questions</Text>
                            <Text style={styles.settingValue}>
                              {selectedQuiz.questions?.length || 0} ({selectedQuiz.quiz_type})
                            </Text>
                          </View>
                        </View>
                        <View style={styles.divider} />
                      </>
                    )}

                    <View style={styles.settingRow}>
                      <View style={styles.settingChip}>
                        <Ionicons name="time" size={16} color={COLORS.accent} />
                      </View>
                      <View style={styles.settingBody}>
                        <Text style={styles.settingLabel}>Time per Question (seconds)</Text>
                        <TextInput
                          style={styles.settingInput}
                          value={timePerQuestion}
                          onChangeText={setTimePerQuestion}
                          keyboardType="numeric"
                          placeholder="15"
                          placeholderTextColor={COLORS.textMuted}
                          selectionColor={COLORS.accent}
                        />
                      </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.settingRow}>
                      <View style={styles.settingChip}>
                        <Ionicons name="people" size={16} color={COLORS.success} />
                      </View>
                      <View style={styles.settingBody}>
                        <Text style={styles.settingLabel}>Team Mode</Text>
                        <Text style={styles.settingHint}>Split players into teams that compete for the same score</Text>
                      </View>
                      {groupMode ? (
                        <View style={[styles.toggle, styles.toggleOn]}>
                          <View style={[styles.toggleKnob, styles.toggleKnobOn]} />
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.toggle, teamMode && styles.toggleOn]}
                          onPress={() => setTeamMode(!teamMode)}
                          activeOpacity={0.8}
                        >
                          <View style={[styles.toggleKnob, teamMode && styles.toggleKnobOn]} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {teamMode && (
                      <>
                        <View style={styles.divider} />
                        <View style={styles.settingRow}>
                          <View style={styles.settingChip}>
                            <Ionicons name="git-network" size={16} color={COLORS.warning} />
                          </View>
                          <View style={styles.settingBody}>
                            <Text style={styles.settingLabel}>Number of Teams</Text>
                            <View style={styles.teamCountRow}>
                              {[2, 3, 4].map(n => (
                                <TouchableOpacity
                                  key={n}
                                  style={[styles.teamCountChip, teamCount === n && styles.teamCountChipActive]}
                                  onPress={() => setTeamCount(n)}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.teamCountChipText, teamCount === n && styles.teamCountChipTextActive]}>{n}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                        </View>
                      </>
                    )}
                  </View>
                </View>

                {/* ── generate CTA (cyan = proceed) ── */}
                <TouchableOpacity
                  style={[styles.ctaWrap, createDisabled && styles.ctaDisabled]}
                  onPress={handleCreate}
                  disabled={createDisabled}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <View style={styles.ctaInnerDisabled}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : createDisabled ? (
                    <View style={styles.ctaInnerDisabled}>
                      <Ionicons name="rocket" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                      <Text style={styles.ctaTextDisabled}>Generate Room</Text>
                    </View>
                  ) : (
                    <LinearGradient
                      colors={[COLORS.accent, '#06B6D4']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.ctaInnerActive}
                    >
                      <Ionicons name="rocket" size={18} color={COLORS.bg} style={{ marginRight: 8 }} />
                      <Text style={styles.ctaText}>Generate Room</Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* ── JOIN CODE ── */}
                <View style={styles.section}>
                  <View style={styles.codeCard}>
                    <View style={styles.cardEdgeSoft} />
                    <View style={styles.codeTab}><Text style={styles.codeTabText}>CODE</Text></View>
                    <View style={styles.codeIconRing}>
                      <Ionicons name="key" size={22} color={COLORS.purpleVibrant} />
                    </View>
                    <Text style={styles.codeLabel}>Enter Room Code</Text>

                    {/* 6 character boxes — same DNA as the identification answer boxes */}
                    <View style={styles.codeBoxes}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <TextInput
                          key={i}
                          ref={(r) => { codeRefs.current[i] = r; }}
                          style={[styles.codeBox, joinCode[i] ? styles.codeBoxFilled : null]}
                          value={joinCode[i] || ''}
                          onChangeText={(t) => handleCodeChange(t, i)}
                          onKeyPress={(e) => handleCodeKeyPress(e, i)}
                          maxLength={1}
                          autoCapitalize="characters"
                          selectionColor={COLORS.accent}
                        />
                      ))}
                    </View>

                    <Text style={styles.codeHint}>Ask your host for the 6-character code</Text>
                  </View>
                </View>

                {/* ── join CTA ── */}
                <TouchableOpacity
                  style={[styles.ctaWrap, joinDisabled && styles.ctaDisabled]}
                  onPress={handleJoin}
                  disabled={joinDisabled}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <View style={styles.ctaInnerDisabled}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : joinDisabled ? (
                    <View style={styles.ctaInnerDisabled}>
                      <Ionicons name="enter" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                      <Text style={styles.ctaTextDisabled}>Join Room</Text>
                    </View>
                  ) : (
                    <LinearGradient
                      colors={[COLORS.accent, '#06B6D4']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.ctaInnerActive}
                    >
                      <Ionicons name="enter" size={18} color={COLORS.bg} style={{ marginRight: 8 }} />
                      <Text style={styles.ctaText}>Join Room</Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  container: { flex: 1 },
  fullScreen: { flex: 1 },

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
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(127,119,221,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  homeScroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },

  /* ── hero deck ── */
  heroDeck: { position: 'relative', marginBottom: 26 },
  heroCardBack2: {
    position: 'absolute', top: 18, left: 18, right: 18, bottom: -18,
    borderRadius: 24, borderWidth: 1, borderColor: 'rgba(127,119,221,0.08)',
    backgroundColor: 'rgba(35,32,82,0.35)', transform: [{ rotate: '1.6deg' }],
  },
  heroCardBack1: {
    position: 'absolute', top: 9, left: 9, right: 9, bottom: -9,
    borderRadius: 24, borderWidth: 1, borderColor: 'rgba(127,119,221,0.15)',
    backgroundColor: 'rgba(35,32,82,0.55)', transform: [{ rotate: '-1.4deg' }],
  },
  heroCard: {
    position: 'relative', zIndex: 2,
    backgroundColor: COLORS.cardBg, borderRadius: 24,
    borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 22, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.5, shadowRadius: 28, elevation: 16,
  },
  cardEdge: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  cardEdgeSoft: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  heroTab: {
    backgroundColor: COLORS.purplePrimary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  heroTabText: { color: COLORS.accent, fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(16,185,129,0.12)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  liveText: { color: '#34D399', fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1 },

  heroBody: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroTextCol: { flex: 1 },
  heroTitle: {
    fontSize: 32, fontFamily: FONTS.black, color: COLORS.textPrimary,
    lineHeight: 36, letterSpacing: -1, marginBottom: 8,
  },
  heroSub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textSecondary, lineHeight: 19 },
  heroTrophyWrap: { width: 84, height: 84, justifyContent: 'center', alignItems: 'center' },
  heroTrophyGlow: {
    position: 'absolute', width: 84, height: 84, borderRadius: 42,
    backgroundColor: 'rgba(124,58,237,0.18)',
  },
  heroTrophy: {
    width: 68, height: 68, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 14, elevation: 8,
  },

  /* ── action cards ── */
  actionWrap: {
    borderRadius: 24, overflow: 'hidden', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45, shadowRadius: 24, elevation: 14,
  },
  actionFill: { padding: 20, paddingTop: 24, position: 'relative' },
  actionOutline: {
    padding: 20, paddingTop: 24, position: 'relative',
    backgroundColor: COLORS.cardBg, borderWidth: 1.5, borderColor: COLORS.cardBorder,
    borderRadius: 24,
  },
  actionTab: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 14,
  },
  actionTabText: { color: '#fff', fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },
  actionTabOutline: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(139,92,246,0.15)',
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 14,
  },
  actionTabOutlineText: { color: COLORS.purpleLight, fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  actionIconChip: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  actionIconChipOutline: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: 'rgba(139,92,246,0.15)', borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  actionTextCol: { flex: 1 },
  actionTitle: { fontSize: 18, fontFamily: FONTS.bold, color: '#fff', marginBottom: 3 },
  actionDesc: { fontSize: 12, fontFamily: FONTS.regular, color: 'rgba(255,255,255,0.8)', lineHeight: 17 },
  actionTitleOutline: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 3 },
  actionDescOutline: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary, lineHeight: 17 },
  actionArrow: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  actionArrowOutline: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(139,92,246,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },

  /* ── feature strip ── */
  featureStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: 'rgba(127,119,221,0.15)',
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18, marginTop: 4,
  },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  featureItemText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  featureDivider: { width: 1, height: 16, backgroundColor: 'rgba(127,119,221,0.15)' },

  /* ── form header ── */
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 24 },
  backCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.cardBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  formTitleCol: { flex: 1 },
  formKicker: {
    fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 2,
    color: COLORS.accent, marginBottom: 2,
  },
  formTitle: { fontSize: 22, fontFamily: FONTS.bold, color: COLORS.textPrimary },

  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 40 },

  /* ── sections ── */
  section: { marginBottom: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  stepTab: {
    backgroundColor: COLORS.purplePrimary, borderRadius: 8,
    width: 30, height: 26, justifyContent: 'center', alignItems: 'center',
  },
  stepTabText: { color: COLORS.accent, fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 1 },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.extraBold, color: COLORS.textPrimary, letterSpacing: 0.3 },

  /* ── segmented control ── */
  segment: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    borderRadius: 16, padding: 4, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(127,119,221,0.15)',
    position: 'relative',
  },
  segmentIndicator: {
    position: 'absolute', top: 4, bottom: 4, left: 4,
    borderRadius: 12, backgroundColor: COLORS.purplePrimary,
    shadowColor: COLORS.purplePrimary, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: 11, zIndex: 1,
  },
  segmentBtnText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  segmentBtnTextActive: { color: '#fff', fontFamily: FONTS.bold },

  /* ── upload card ── */
  uploadCard: {
    backgroundColor: COLORS.cardBg, borderRadius: 24, padding: 28,
    alignItems: 'center', borderWidth: 2, borderColor: COLORS.cardBorder,
    borderStyle: 'dashed', position: 'relative', overflow: 'hidden',
  },
  uploadCardDone: { borderColor: COLORS.success, borderStyle: 'solid', backgroundColor: 'rgba(16,185,129,0.06)' },
  uploadIconIdle: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
    shadowColor: COLORS.purplePrimary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  uploadIconDone: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.success,
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
    shadowColor: COLORS.success, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  uploadTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 4 },
  uploadSub: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  uploadFileName: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.success, marginBottom: 4, textAlign: 'center' },
  uploadChangeHint: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },

  /* ── dropdown ── */
  ddTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.cardBg, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  ddTriggerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  ddTriggerChip: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  ddTriggerText: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, flex: 1 },
  ddList: {
    backgroundColor: COLORS.bgSecondary, borderRadius: 16, marginTop: 8,
    borderWidth: 1, borderColor: COLORS.cardBorder, overflow: 'hidden', position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 10,
  },
  ddEmpty: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', padding: 24, fontFamily: FONTS.regular },
  ddItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(127,119,221,0.1)',
  },
  ddItemActive: { backgroundColor: 'rgba(139,92,246,0.1)' },
  ddItemBody: { flex: 1 },
  ddItemTitle: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, marginBottom: 3 },
  ddItemMeta: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted },

  /* ── badges ── */
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  badge: {
    backgroundColor: 'rgba(124,58,237,0.12)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)',
  },
  badgeText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.purpleLight },

  /* ── settings card ── */
  settingsCard: {
    backgroundColor: COLORS.cardBg, borderRadius: 24, padding: 18,
    borderWidth: 1, borderColor: COLORS.cardBorder,
    position: 'relative', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  settingChip: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(139,92,246,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  settingBody: { flex: 1 },
  settingLabel: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginBottom: 8 },
  settingValue: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  settingInput: {
    fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary,
    backgroundColor: COLORS.bg, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(34,211,238,0.25)',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  settingHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  divider: { height: 1, backgroundColor: 'rgba(127,119,221,0.12)', marginVertical: 14 },

  toggle: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: 'rgba(127,119,221,0.25)',
    padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: 'rgba(16,185,129,0.5)' },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.textMuted,
  },
  toggleKnobOn: {
    backgroundColor: COLORS.success,
    alignSelf: 'flex-end',
  },
  teamCountRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  teamCountChip: {
    flex: 1, borderRadius: 12, paddingVertical: 10,
    backgroundColor: COLORS.bg, borderWidth: 1.5, borderColor: 'rgba(127,119,221,0.25)',
    alignItems: 'center',
  },
  teamCountChipActive: { borderColor: COLORS.warning, backgroundColor: 'rgba(245,158,11,0.12)' },
  teamCountChipText: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textMuted },
  teamCountChipTextActive: { color: '#FBBF24' },

  /* ── join code card ── */
  codeCard: {
    backgroundColor: COLORS.cardBg, borderRadius: 24, padding: 26,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder,
    position: 'relative', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
  },
  codeTab: {
    alignSelf: 'flex-start', backgroundColor: COLORS.purplePrimary,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 18,
  },
  codeTabText: { color: COLORS.accent, fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1.5 },
  codeIconRing: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(139,92,246,0.12)', borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.25)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  codeLabel: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textSecondary, marginBottom: 18 },
  codeBoxes: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  codeBox: {
    width: 44, height: 56, borderRadius: 12,
    borderWidth: 2, borderColor: 'rgba(34,211,238,0.3)',
    backgroundColor: COLORS.surface, color: '#fff',
    fontSize: 22, fontFamily: FONTS.black, textAlign: 'center',
    padding: 0, includeFontPadding: false,
  },
  codeBoxFilled: { borderColor: COLORS.accent, backgroundColor: 'rgba(34,211,238,0.08)' },
  codeHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center' },

  /* ── CTA ── */
  ctaWrap: {
    borderRadius: 16, overflow: 'hidden',
    shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  ctaInnerActive: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  ctaInnerDisabled: {
    paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  ctaText: { color: COLORS.bg, fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  ctaTextDisabled: { color: COLORS.textMuted, fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  ctaDisabled: { shadowOpacity: 0, elevation: 0 },
});