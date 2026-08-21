import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getNode, completeNode } from '@/services/courseService';
import { LearningNode, isLearnContent, isPracticeContent, NODE_TYPE_CONFIG } from '@/types/learning';
import { ConceptBlockView, ExampleBlockView, InteractionBlockView, SummaryBlockView } from '@/components/lesson/BlockRenderer';
import QuizRunner, { QuestionResult } from '@/components/lesson/QuizRunner';
import ResultsSummary from '@/components/lesson/ResultsSummary';

const COLORS = {
  bg: '#baaeda',
  surface: '#cdc2dd',
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

export default function NodePlayerScreen() {
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const router = useRouter();

  const [node, setNode] = useState<LearningNode | null>(null);
  const [phase, setPhase] = useState<ScreenPhase>('loading');
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [interactionsCorrect, setInteractionsCorrect] = useState(0);
  const [interactionsTotal, setInteractionsTotal] = useState(0);
  const [quizResults, setQuizResults] = useState<QuestionResult[]>([]);
  const [quizScore, setQuizScore] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNode();
  }, [nodeId]);

  const loadNode = async () => {
    try {
      setPhase('loading');
      const data = await getNode(Number(nodeId));
      setNode(data);

      if (isLearnContent(data.content_json) && data.content_json.blocks?.length > 0) {
        setPhase('lesson');
      } else if (isPracticeContent(data.content_json)) {
        setPhase('quiz');
      } else {
        setPhase('lesson');
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

  const handleBlockNext = useCallback(() => {
    if (!node || !isLearnContent(node.content_json)) return;
    const blocks = node.content_json.blocks;
    if (currentBlockIndex < blocks.length - 1) {
      setCurrentBlockIndex(prev => prev + 1);
    } else {
      // All blocks done — compute learn score and submit
      const total = interactionsTotal || 1;
      const score = Math.round((interactionsCorrect / total) * 100) || 100;
      submitScore(score);
    }
  }, [node, currentBlockIndex, interactionsCorrect, interactionsTotal]);

  const handleBlockBack = useCallback(() => {
    if (currentBlockIndex > 0) setCurrentBlockIndex(prev => prev - 1);
  }, [currentBlockIndex]);

  const handleQuizFinish = useCallback((score: number, results: QuestionResult[]) => {
    setQuizScore(score);
    setQuizResults(results);
    submitScore(score);
  }, [node]);

  const submitScore = async (score: number) => {
    if (!node) return;
    try {
      const res = await completeNode(node.id, score);
      setPhase('results');
    } catch (e: any) {
      setError(e?.message || 'Failed to save progress');
      setPhase('error');
    }
  };

  const handleRetry = () => {
    setCurrentBlockIndex(0);
    setInteractionsCorrect(0);
    setInteractionsTotal(0);
    setQuizResults([]);
    setQuizScore(0);
    if (node && isLearnContent(node.content_json)) {
      setPhase('lesson');
    } else {
      setPhase('quiz');
    }
  };

  const handleContinue = () => {
    router.back();
  };

  const cfg = node ? NODE_TYPE_CONFIG[node.node_type] : null;

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
        <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
          <Text style={styles.retryText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Results ──
  if (phase === 'results' && node) {
    return (
      <View style={styles.container}>
        <ResultsSummary
          score={quizScore || (interactionsTotal > 0 ? Math.round((interactionsCorrect / interactionsTotal) * 100) : 100)}
          passed={(quizScore || (interactionsTotal > 0 ? Math.round((interactionsCorrect / interactionsTotal) * 100) : 100)) >= node.required_score}
          passingScore={node.required_score}
          results={quizResults}
          xpEarned={node.xp_reward}
          onRetry={handleRetry}
          onContinue={handleContinue}
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
        <LinearGradient colors={[cfg?.color || COLORS.purpleDark, cfg?.color || COLORS.purpleDeep]} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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
        <LinearGradient colors={[cfg?.color || COLORS.purpleDark, cfg?.color || COLORS.purpleDeep]} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
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
