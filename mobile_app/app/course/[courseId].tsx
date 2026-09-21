import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getCoursePath } from '@/services/courseService';
import { CoursePathTopic, NODE_TYPE_CONFIG, LearningNode } from '@/types/learning';
import ProgressRing from '@/components/courses/ProgressRing';
import { getCourseActivities, ClassActivity } from '@/services/activityService';
import { getQuiz, Quiz } from '@/services/quizService';
import { completeQuiz } from '@/services/gamificationService';
import TakeQuiz from '../../components/TakeQuiz';

const COLORS = {
  bg: '#baaeda',
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  purpleGhost: '#DDD6FE',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

function getNodeStatus(node: LearningNode, index: number, allNodes: LearningNode[]): 'completed' | 'current' | 'locked' {
  if (node.progress?.passed) return 'completed';
  const allPriorCompleted = allNodes.slice(0, index).every(n => n.progress?.passed);
  if (allPriorCompleted) return 'current';
  return 'locked';
}

const ACTIVITY_META: Record<ClassActivity['kind'], { label: string; icon: any }> = {
  quiz: { label: 'Quiz', icon: 'help-circle' },
  lesson: { label: 'Lesson', icon: 'book' },
  game: { label: 'Live Game', icon: 'game-controller' },
};

export default function CourseDetailScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  const [topics, setTopics] = useState<CoursePathTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Class-assigned tasks (published activities only)
  const [activities, setActivities] = useState<ClassActivity[]>([]);

  // Quiz player for a quiz-linked activity
  const [quizToTake, setQuizToTake] = useState<{ title: string; questions: any[] } | null>(null);
  const [openingQuiz, setOpeningQuiz] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [topicsData, activitiesData] = await Promise.all([
          getCoursePath(Number(courseId)),
          getCourseActivities(Number(courseId)).catch(() => [] as ClassActivity[]),
        ]);
        setTopics(topicsData);
        setActivities(activitiesData.filter((a) => a.status === 'published'));
      } catch (e: any) {
        setError(e?.message || 'Failed to load course');
      }
    };
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [courseId]);

  const openActivity = async (activity: ClassActivity) => {
    if (activity.kind !== 'quiz' || activity.ref_id == null) {
      Alert.alert(activity.title, 'Open the matching lesson or game from the educator to start.');
      return;
    }
    setOpeningQuiz(true);
    try {
      const quiz: Quiz = await getQuiz(activity.ref_id);
      if (!quiz.questions || quiz.questions.length === 0) {
        Alert.alert('No questions', 'This quiz has no questions yet.');
        return;
      }
      setQuizToTake({
        title: quiz.title,
        questions: quiz.questions.map((q) => ({
          id: q.id,
          question: q.question_text,
          type: (quiz.quiz_type || 'Multiple Choice') as any,
          options: q.options,
          correct_answer: q.correct_answer,
        })),
      });
    } catch {
      Alert.alert('Failed to load quiz', 'Please try again.');
    } finally {
      setOpeningQuiz(false);
    }
  };

  const loadTopics = async () => {
    try {
      setLoading(true);
      const data = await getCoursePath(Number(courseId));
      setTopics(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load course');
    } finally {
      setLoading(false);
    }
  };

  const getTopicProgress = (topic: CoursePathTopic) => {
    const total = topic.nodes.length;
    const done = topic.nodes.filter(n => n.progress?.passed).length;
    return { done, total };
  };

  const getTotalMinutes = (topic: CoursePathTopic) =>
    topic.nodes.reduce((sum, n) => sum + n.estimated_minutes, 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleDark} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadTopics}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[COLORS.purpleDeep, COLORS.purpleDark]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Course Topics</Text>
        <View style={{ width: 32 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {activities.length > 0 && (
          <View style={styles.activitiesSection}>
            <Text style={styles.activitiesHeader}>Class Tasks</Text>
            {activities.map((activity) => {
              const meta = ACTIVITY_META[activity.kind] || ACTIVITY_META.quiz;
              return (
                <TouchableOpacity
                  key={activity.id}
                  style={styles.activityCard}
                  activeOpacity={0.8}
                  onPress={() => openActivity(activity)}
                  disabled={openingQuiz}
                >
                  <View style={styles.activityIconBox}>
                    <Ionicons name={meta.icon} size={18} color="white" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.activityTitleRow}>
                      <Text style={styles.activityTitle} numberOfLines={1}>{activity.title}</Text>
                      <Text style={styles.activityKind}>{meta.label}</Text>
                    </View>
                    {activity.note ? (
                      <Text style={styles.activityNote} numberOfLines={2}>{activity.note}</Text>
                    ) : null}
                    {activity.due_date ? (
                      <Text style={styles.activityMeta}>
                        Due {new Date(activity.due_date).toLocaleDateString()}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {topics.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="book-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No topics yet</Text>
            <Text style={styles.emptySubtitle}>The educator has not added any topics.</Text>
          </View>
        ) : (
          topics.map((topic) => {
            const { done, total } = getTopicProgress(topic);
            const pct = total > 0 ? done / total : 0;
            const minutes = getTotalMinutes(topic);

            return (
              <TouchableOpacity
                key={topic.id}
                style={styles.topicCard}
                activeOpacity={0.8}
                onPress={() => router.push(`/course/topic/${topic.id}?courseId=${courseId}&title=${encodeURIComponent(topic.title)}` as any)}
              >
                <View style={styles.topicTop}>
                  <View style={styles.topicInfo}>
                    <Text style={styles.topicTitle}>{topic.title}</Text>
                    {topic.description ? (
                      <Text style={styles.topicDesc} numberOfLines={2}>{topic.description}</Text>
                    ) : null}
                  </View>
                  <ProgressRing
                    progress={pct * 100}
                    size={52}
                    strokeWidth={5}
                    fillColor={pct >= 1 ? COLORS.success : COLORS.purpleVibrant}
                  />
                </View>

                <View style={styles.topicMeta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="layers-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{total} activities</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>~{minutes} min</Text>
                  </View>
                  {done > 0 && (
                    <View style={styles.metaItem}>
                      <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                      <Text style={[styles.metaText, { color: COLORS.success }]}>{done}/{total} done</Text>
                    </View>
                  )}
                </View>

                <View style={styles.nodeRow}>
                  {topic.nodes.map((node, i) => {
                    const status = getNodeStatus(node, i, topic.nodes);
                    const cfg = NODE_TYPE_CONFIG[node.node_type];
                    return (
                      <View key={node.id} style={styles.nodeDotWrap}>
                        <View style={[
                          styles.nodeDot,
                          { backgroundColor: status === 'completed' ? COLORS.success : status === 'current' ? cfg.color : 'transparent' },
                          status === 'current' && styles.nodeDotCurrent,
                          { borderColor: status === 'locked' ? COLORS.textMuted : cfg.color },
                        ]}>
                          {status === 'completed' && <Ionicons name="checkmark" size={10} color="white" />}
                          {status === 'current' && <View style={styles.nodeDotInner} />}
                        </View>
                        {i < topic.nodes.length - 1 && <View style={[styles.nodeLine, { backgroundColor: status === 'completed' ? COLORS.success : COLORS.textMuted + '40' }]} />}
                      </View>
                    );
                  })}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {quizToTake && (
        <TakeQuiz
          quizTitle={quizToTake.title}
          questions={quizToTake.questions}
          onFinish={async (score) => {
            try {
              const total = quizToTake.questions.length;
              const result = await completeQuiz(score, total);
              return { xp: result.xp, badges: result.badges };
            } catch {
              return { xp: 0, badges: [] };
            }
          }}
          onClose={() => setQuizToTake(null)}
        />
      )}
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
    paddingTop: 48,
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backBtn: { padding: 6, width: 36, alignItems: 'center' },
  headerTitle: { color: 'white', fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  emptySubtitle: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  errorText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.purpleDark, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 8 },
  retryText: { color: 'white', fontFamily: FONTS.semiBold, fontSize: 13 },
  topicCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  topicTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  topicInfo: { flex: 1 },
  topicTitle: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  topicDesc: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 4, lineHeight: 18 },
  topicMeta: { flexDirection: 'row', gap: 16, marginTop: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted },
  nodeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingHorizontal: 4 },
  nodeDotWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  nodeDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDotCurrent: { shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4 },
  nodeDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' },
  nodeLine: { flex: 1, height: 2, marginHorizontal: 2 },
  activitiesSection: { gap: 10 },
  activitiesHeader: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  activityIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.purpleVibrant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activityTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  activityKind: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },
  activityNote: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 3, lineHeight: 17 },
  activityMeta: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 4 },
});
