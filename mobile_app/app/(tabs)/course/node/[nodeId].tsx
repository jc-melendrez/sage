import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getNode, getCoursePath, completeNode } from '@/services/courseService';
import { LearningNode, CoursePathTopic, isLearnContent, isPracticeContent, NODE_TYPE_CONFIG } from '@/types/learning';
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

/**
 * Flatten a course path into reading order. The path is a vertical list of
 * topics, each holding its own nodes, so "the next node" means "the next entry
 * in this flat list" — which naturally crosses a topic boundary. Comparing
 * nodes against their own topic would have stopped at every topic edge.
 */
function flattenPath(topics: CoursePathTopic[]): LearningNode[] {
  return [...topics]
    .sort((a, b) => a.order - b.order)
    .flatMap(topic => [...topic.nodes].sort((a, b) => a.order - b.order));
}

export default function NodePlayerScreen() {
  const { nodeId, preview, courseId } = useLocalSearchParams<{ nodeId: string; preview?: string; courseId?: string }>();
  const isPreview = preview === '1';
  const router = useRouter();

  const [node, setNode] = useState<LearningNode | null>(null);
  const [phase, setPhase] = useState<ScreenPhase>('loading');
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [interactionsCorrect, setInteractionsCorrect] = useState(0);
  const [interactionsTotal, setInteractionsTotal] = useState(0);
  const [quizResults, setQuizResults] = useState<QuestionResult[]>([]);
  // null means "no quiz was taken". It must not default to 0 — the results
  // screen treats a number as authoritative, so a lesson would report 0%.
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Next node on the path, resolved lazily on the results screen.
  const [nextNode, setNextNode] = useState<LearningNode | null>(null);
  const [nextNodeTopic, setNextNodeTopic] = useState<string>('');
  const [showNextPreview, setShowNextPreview] = useState(false);

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
    // Preview mode: render results without persisting progress or XP.
    if (isPreview) {
      setPhase('results');
      return;
    }
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
    setQuizScore(null);
    if (node && isLearnContent(node.content_json)) {
      setPhase('lesson');
    } else {
      setPhase('quiz');
    }
  };

  const handleContinue = () => {
    // Preview runs have no progress to continue, so go straight back.
    if (isPreview) {
      router.back();
      return;
    }
    if (nextNode) {
      setShowNextPreview(true);
      return;
    }
    router.back();
  };

  const handleStartNext = () => {
    if (!nextNode) return;
    const id = nextNode.id;
    setShowNextPreview(false);
    // Replace this screen so backing out of the next node does not walk
    // through every completed activity again.
    router.replace(
      (courseId
        ? `/course/node/${id}?courseId=${courseId}`
        : `/course/node/${id}`) as any
    );
  };

  const loadNextNode = useCallback(async () => {
    if (!courseId) return;
    try {
      const topics = await getCoursePath(Number(courseId));
      const ordered = [...topics].sort((a, b) => a.order - b.order);
      const flat = flattenPath(ordered);
      const index = flat.findIndex(n => n.id === Number(nodeId));
      if (index === -1) return;
      const upcoming = flat[index + 1];
      if (!upcoming) return;
      // Label the card with the upcoming node's own topic, which differs from
      // the finished node's whenever the path crosses a topic boundary.
      const topic = ordered.find(t => t.id === upcoming.topic);
      setNextNodeTopic(topic ? topic.title : '');
      setNextNode(upcoming);
    } catch {
      // A failed lookup must not block finishing the lesson.
      setNextNode(null);
    }
  }, [courseId, nodeId]);

  // Resolve the next node once the results screen is up, so the modal is
  // already populated the moment "Continue" is tapped.
  useEffect(() => {
    if (phase === 'results' && !isPreview) {
      loadNextNode();
    }
  }, [phase, isPreview, loadNextNode]);

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
    // A lesson has no questions, so there is no accuracy to show — the
    // summary renders a "Lesson Complete!" card instead of a score ring.
    const wasLesson = isLearnContent(node.content_json);
    const finalScore = quizScore != null
      ? quizScore
      : (interactionsTotal > 0 ? Math.round((interactionsCorrect / interactionsTotal) * 100) : 100);
    return (
      <View style={styles.container}>
        <ResultsSummary
          mode={wasLesson ? 'lesson' : 'quiz'}
          title={node.title}
          score={finalScore}
          passed={finalScore >= node.required_score}
          passingScore={node.required_score}
          results={quizResults}
          xpEarned={isPreview ? 0 : node.xp_reward}
          onRetry={handleRetry}
          onContinue={handleContinue}
          onClose={handleContinue}
        />
        <NextNodePreview
          visible={showNextPreview}
          node={nextNode}
          topicTitle={nextNodeTopic}
          onStart={handleStartNext}
          onDismiss={() => setShowNextPreview(false)}
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

/**
 * Preview of the upcoming node. Nothing starts on its own — the student has to
 * press Start, because a "continue" that silently launches a different
 * activity (often in another topic) is disorienting.
 */
function NextNodePreview({
  visible,
  node,
  topicTitle,
  onStart,
  onDismiss,
}: {
  visible: boolean;
  node: LearningNode | null;
  topicTitle: string;
  onStart: () => void;
  onDismiss: () => void;
}) {
  if (!visible || !node) return null;
  const cfg = NODE_TYPE_CONFIG[node.node_type];
  const isNextLesson = isLearnContent(node.content_json);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalEyebrow}>Up next{topicTitle ? ` · ${topicTitle}` : ''}</Text>
          <Text style={styles.modalTitle}>{node.title}</Text>
          {!!node.description && (
            <Text style={styles.modalDescription} numberOfLines={3}>
              {node.description}
            </Text>
          )}

          <View style={styles.modalMetaRow}>
            <View style={styles.modalMeta}>
              <Ionicons
                name={isNextLesson ? 'book-outline' : 'help-circle-outline'}
                size={14}
                color={cfg?.color || COLORS.purpleVibrant}
              />
              <Text style={styles.modalMetaText}>
                {isNextLesson
                  ? 'Lesson'
                  : isPracticeContent(node.content_json)
                    ? `${node.content_json.questions.length} questions`
                    : 'Activity'}
              </Text>
            </View>
            <View style={styles.modalMeta}>
              <Ionicons name="hourglass-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.modalMetaText}>{node.estimated_minutes} min</Text>
            </View>
            <View style={styles.modalMeta}>
              <Ionicons name="star-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.modalMetaText}>+{node.xp_reward} XP</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.modalStart, { backgroundColor: cfg?.color || COLORS.purpleVibrant }]}
            onPress={onStart}
            activeOpacity={0.85}
          >
            <Text style={styles.modalStartText}>Start</Text>
            <Ionicons name="arrow-forward" size={18} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalDismiss} onPress={onDismiss}>
            <Text style={styles.modalDismissText}>Back to path</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
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

  // Next-node preview
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 10, 56, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.4)',
    marginBottom: 18,
  },
  modalEyebrow: {
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.purpleVibrant,
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: FONTS.extraBold,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginBottom: 16,
  },
  modalMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 22,
  },
  modalMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modalMetaText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },
  modalStart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 16,
  },
  modalStartText: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
  modalDismiss: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  modalDismissText: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted },
});
