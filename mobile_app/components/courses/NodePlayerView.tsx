import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getNode, completeNode } from '@/services/courseService';
import { LearningNode, NodeCompleteResponse, isLearnContent, isPracticeContent, NODE_TYPE_CONFIG } from '@/types/learning';
import { ConceptBlockView, ExampleBlockView, InteractionBlockView, SummaryBlockView } from '@/components/lesson/BlockRenderer';
import QuizRunner, { QuestionResult } from '@/components/lesson/QuizRunner';
import ResultsSummary from '@/components/lesson/ResultsSummary';

const COLORS = {
  bg: '#FFFFFF',
  surface: '#F5F3FA',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  success: '#10B981',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

type ScreenPhase = 'loading' | 'lesson' | 'quiz' | 'results' | 'error';

type NodePlayerViewProps = {
  nodeId: number;
  isPreview: boolean;
  onBack: () => void;
  /**
   * Advances to the next node on the path. Supplied only when this screen was
   * opened *from* a path, so a node reached any other way (a notification, an
   * educator preview) cannot offer a "Next" that has nowhere to go.
   */
  onNext?: () => void;
};

export default function NodePlayerView({ nodeId: nid, isPreview, onBack, onNext }: NodePlayerViewProps) {
  const insets = useSafeAreaInsets();
  const [node, setNode] = useState<LearningNode | null>(null);
  const [phase, setPhase] = useState<ScreenPhase>('loading');
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [interactionsCorrect, setInteractionsCorrect] = useState(0);
  const [interactionsTotal, setInteractionsTotal] = useState(0);
  const [quizResults, setQuizResults] = useState<QuestionResult[]>([]);
  // null, not 0. A 0 is a real score, and the old `quizScore != null` check
  // therefore pinned every lesson to 0 -- only the quiz path ever set it, so
  // a learn node with perfect interaction answers still reported "0/0" and
  // "Keep Practicing!". null makes the guard actually discriminate.
  const [quizScore, setQuizScore] = useState<number | null>(null);
  // Authoritative completion result. The server owns score/passed, and it is
  // the only place XP, level-ups and new badges are known -- it used to be
  // discarded, so a completed node never told the student what it earned.
  const [result, setResult] = useState<NodeCompleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNode();
  }, [nid]);

  const loadNode = async () => {
    try {
      setPhase('loading');
      setError(null);
      setResult(null);
      setQuizScore(null);
      const data = await getNode(nid);
      setNode(data);

      if (isLearnContent(data.content_json) && data.content_json.blocks?.length > 0) {
        setPhase('lesson');
      } else if (isPracticeContent(data.content_json) && data.content_json.questions?.length > 0) {
        setPhase('quiz');
      } else {
        setError('This activity has no content yet.');
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load activity');
      setPhase('error');
    }
  };

  const handleInteractionAnswer = useCallback((correct: boolean) => {
    setInteractionsTotal(prev => prev + 1);
    if (correct) setInteractionsCorrect(prev => prev + 1);
  }, []);

  // Declared before the handlers that call it and memoized on `node`/`isPreview`
  // so those callbacks can list it as a dependency. It used to be a plain
  // function defined below its callers, which left every `useCallback` in this
  // file closing over a stale copy.
  const submitScore = useCallback(async (score: number) => {
    if (!node) return;
    // Preview mode: render results without persisting progress or XP.
    if (isPreview) {
      setPhase('results');
      return;
    }
    try {
      const res = await completeNode(node.id, score);
      // Keep it: the server is authoritative for score/passed and is the only
      // source of XP, level-ups and any badges just earned. It used to be
      // discarded, so finishing a node never said what it was worth.
      setResult(res);
      setPhase('results');
    } catch (e: any) {
      setError(e?.message || 'Failed to save progress');
      setPhase('error');
    }
  }, [node, isPreview]);

  const handleBlockNext = useCallback(() => {
    if (!node || !isLearnContent(node.content_json)) return;
    const blocks = node.content_json.blocks;
    if (currentBlockIndex < blocks.length - 1) {
      setCurrentBlockIndex(prev => prev + 1);
    } else {
      // All blocks done — compute learn score and submit
      const score = interactionsTotal > 0
        ? Math.round((interactionsCorrect / interactionsTotal) * 100)
        : 100;
      // Record it locally as well. The round trip can fail or lag, and the
      // results screen needs the score either way.
      setQuizScore(score);
      submitScore(score);
    }
  }, [node, currentBlockIndex, interactionsCorrect, interactionsTotal, submitScore]);

  const handleBlockBack = useCallback(() => {
    if (currentBlockIndex > 0) setCurrentBlockIndex(prev => prev - 1);
  }, [currentBlockIndex]);

  const handleQuizFinish = useCallback((score: number, results: QuestionResult[]) => {
    setQuizScore(score);
    setQuizResults(results);
    submitScore(score);
  }, [submitScore]);

  const handleRetry = () => {
    setCurrentBlockIndex(0);
    setInteractionsCorrect(0);
    setInteractionsTotal(0);
    setQuizResults([]);
    setQuizScore(null);
    setResult(null);
    if (node && isLearnContent(node.content_json)) {
      setPhase('lesson');
    } else {
      setPhase('quiz');
    }
  };

  const handleContinue = () => {
    onBack();
  };

  const cfg = node ? NODE_TYPE_CONFIG[node.node_type] : null;
  // Header padding used to be a hardcoded 48, which put the back button and
  // title under the status bar on notched devices now that Android is
  // edge-to-edge by default.
  const headerStyle = [styles.header, { paddingTop: insets.top + 14 }];

  // ── Loading ──
  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleDark} />
      </View>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => onBack()}>
          <Text style={styles.retryText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Results ──
  if (phase === 'results' && node) {
    // A lesson has no questions, so there is no accuracy to report and no
    // mistakes to review. Rendering it in quiz mode produced "0/0 correct"
    // and a "Keep Practicing!" verdict for a node the student had passed.
    const isLessonNode = isLearnContent(node.content_json);
    const finalScore = quizScore != null
      ? quizScore
      : (interactionsTotal > 0 ? Math.round((interactionsCorrect / interactionsTotal) * 100) : 100);
    return (
      <View style={styles.container}>
        <ResultsSummary
          mode={isLessonNode ? 'lesson' : 'quiz'}
          score={result?.score ?? finalScore}
          passed={result?.passed ?? (finalScore >= node.required_score)}
          passingScore={node.required_score}
          results={quizResults}
          title={node.title}
          xpEarned={result?.xp?.xp ?? 0}
          onRetry={handleRetry}
          onContinue={handleContinue}
          // An educator preview never advances: there is no path behind it and
          // the preview deliberately skips persisting progress.
          onNext={isPreview ? undefined : onNext}
        />
      </View>
    );
  }

  // ── Learn Mode (card-by-card) ──
  if (phase === 'lesson' && node && isLearnContent(node.content_json)) {
    const blocks = node.content_json.blocks;
    const block = blocks[currentBlockIndex];
    const progress = (currentBlockIndex + 1) / blocks.length;

    return (
      <View style={styles.container}>
        <LinearGradient colors={[cfg?.color || COLORS.purpleDark, cfg?.color || COLORS.purpleDeep]} style={headerStyle}>
          <TouchableOpacity onPress={() => onBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="white" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{node.title}</Text>
            <Text style={styles.headerSub}>{currentBlockIndex + 1} of {blocks.length}</Text>
          </View>
          <View style={{ width: 32 }} />
        </LinearGradient>

        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: cfg?.color || COLORS.purpleVibrant }]} />
        </View>

        <ScrollView contentContainerStyle={styles.lessonContent} showsVerticalScrollIndicator={false}>
          {block.type === 'concept' && <ConceptBlockView block={block} />}
          {block.type === 'example' && <ExampleBlockView block={block} />}
          {block.type === 'interaction' && <InteractionBlockView block={block} onAnswer={handleInteractionAnswer} />}
          {block.type === 'summary' && <SummaryBlockView block={block} />}
        </ScrollView>

        {/* Navigation */}
        <View style={styles.lessonNav}>
          {currentBlockIndex > 0 && (
            <TouchableOpacity style={styles.navBack} onPress={handleBlockBack}>
              <Ionicons name="chevron-back" size={18} color={COLORS.textMuted} />
              <Text style={styles.navBackText}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.navNext, { backgroundColor: cfg?.color || COLORS.purpleVibrant, flex: currentBlockIndex === 0 ? 1 : undefined }]}
            onPress={handleBlockNext}
            activeOpacity={0.85}
          >
            <Text style={styles.navNextText}>
              {currentBlockIndex === blocks.length - 1 ? 'Complete' : 'Next'}
            </Text>
            <Ionicons name={currentBlockIndex === blocks.length - 1 ? 'checkmark' : 'chevron-forward'} size={18} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Quiz Mode (practice / mastery / challenge) ──
  if (phase === 'quiz' && node && isPracticeContent(node.content_json)) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[cfg?.color || COLORS.purpleDark, cfg?.color || COLORS.purpleDeep]} style={headerStyle}>
          <TouchableOpacity onPress={() => onBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="white" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{node.title}</Text>
            <Text style={styles.headerSub}>{node.content_json.questions.length} questions</Text>
          </View>
          <View style={{ width: 32 }} />
        </LinearGradient>

        <QuizRunner
          questions={node.content_json.questions}
          passingScore={node.required_score}
          onFinish={handleQuizFinish}
        />
      </View>
    );
  }

  // Reachable when the phase and the node's content disagree -- e.g. a quiz
  // phase on content that is not practice-shaped. This used to `return null`,
  // which rendered a blank white screen with no way out.
  return (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={40} color={COLORS.textMuted} />
      <Text style={styles.errorText}>This activity isn&apos;t available right now.</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={() => onBack()}>
        <Text style={styles.retryText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backBtn: { padding: 6, width: 36, alignItems: 'center' },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { color: 'white', fontSize: 16, fontFamily: FONTS.extraBold, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: FONTS.medium, marginTop: 2 },
  progressBar: { height: 4, backgroundColor: 'rgba(124,58,237,0.1)', marginHorizontal: 20, marginTop: 16, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  lessonContent: { padding: 20, paddingBottom: 20 },
  lessonNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  navBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  navBackText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  navNext: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  navNextText: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
  errorText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.purpleDark, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 8 },
  retryText: { color: 'white', fontFamily: FONTS.semiBold, fontSize: 13 },
});
