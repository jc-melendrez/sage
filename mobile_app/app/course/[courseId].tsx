import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getCourse, getCoursePath, CourseRoster, CourseStudent } from '@/services/courseService';
import { getCurrentUser } from '@/services/authService';
import { CoursePathTopic, NODE_TYPE_CONFIG, LearningNode } from '@/types/learning';
import ProgressRing from '@/components/courses/ProgressRing';
import { getCourseActivities, ClassActivity } from '@/services/activityService';
import { getQuiz, getQuizzes, Quiz } from '@/services/quizService';

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

const QUIZ_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Multiple Choice',
  exam: 'Exam',
  flashcard: 'Flashcards',
};

type SectionKey = 'topics' | 'quizzes' | 'tasks' | 'leaderboard';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'topics', label: 'Topics' },
  { key: 'quizzes', label: 'Quizzes' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'leaderboard', label: 'Leaderboard' },
];

export default function CourseDetailScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  const [topics, setTopics] = useState<CoursePathTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Class-assigned tasks (published activities only)
  const [activities, setActivities] = useState<ClassActivity[]>([]);

  // Course quizzes (educator + student created)
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);

  // Course info / roster (info panel + class leaderboard)
  const [course, setCourse] = useState<CourseRoster | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // Task filter
  const [taskFilter, setTaskFilter] = useState<'all' | 'upcoming' | 'overdue'>('all');

  // Active category tab
  const [section, setSection] = useState<SectionKey>('topics');

  const [openingQuiz, setOpeningQuiz] = useState(false);

  useEffect(() => {
    getCurrentUser().then(u => setCurrentUserId(u?.id ?? null));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [topicsData, activitiesData, quizzesData, courseData] = await Promise.all([
          getCoursePath(Number(courseId)),
          getCourseActivities(Number(courseId)).catch(() => [] as ClassActivity[]),
          getQuizzes(Number(courseId)).catch(() => [] as Quiz[]),
          getCourse(Number(courseId)).catch(() => null),
        ]);
        setTopics(topicsData);
        setActivities(activitiesData.filter((a) => a.status === 'published'));
        setQuizzes(quizzesData);
        setCourse(courseData);
      } catch (e: any) {
        setError(e?.message || 'Failed to load course');
      }
    };
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [courseId]);

  const openQuiz = async (quiz: Quiz) => {
    if (!quiz.questions || quiz.questions.length === 0) {
      Alert.alert('No questions', 'This quiz has no questions yet.');
      return;
    }
    router.push(`/course/quiz/${quiz.id}?courseId=${courseId}` as any);
  };

  const openActivity = async (activity: ClassActivity) => {
    if (activity.kind !== 'quiz' || activity.ref_id == null) {
      Alert.alert(activity.title, 'Open the matching lesson or game from the educator to start.');
      return;
    }
    setOpeningQuiz(true);
    try {
      const quiz: Quiz = await getQuiz(activity.ref_id);
      await openQuiz(quiz);
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

  // Class leaderboard: enrolled students sorted by XP.
  const rankedStudents = useMemo(() => {
    const list = (course?.students ?? []) as CourseStudent[];
    return [...list].sort((a, b) => (b.current_xp || 0) - (a.current_xp || 0));
  }, [course]);

  // Tasks filtered by due-date state.
  const filteredActivities = useMemo(() => {
    const now = Date.now();
    return activities.filter((a) => {
      if (taskFilter === 'all') return true;
      if (!a.due_date) return taskFilter === 'upcoming';
      const due = new Date(a.due_date).getTime();
      if (taskFilter === 'overdue') return due < now;
      return due >= now;
    });
  }, [activities, taskFilter]);

  const hasDueDate = activities.some(a => a.due_date);

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

      {/* Course info panel */}
      {course && (
        <View style={styles.courseInfoCard}>
          <View style={styles.courseInfoTop}>
            <Text style={styles.courseInfoName} numberOfLines={1}>{course.name}</Text>
            <View style={styles.courseInfoChip}>
              <Ionicons name="people" size={13} color={COLORS.purpleVibrant} />
              <Text style={styles.courseInfoChipText}>{course.student_count} students</Text>
            </View>
          </View>
          {course.description ? (
            <Text style={styles.courseInfoDesc} numberOfLines={2}>{course.description}</Text>
          ) : null}
          <View style={styles.courseInfoMeta}>
            <View style={styles.courseInfoMetaItem}>
              <Ionicons name="person-circle" size={14} color={COLORS.textMuted} />
              <Text style={styles.courseInfoMetaText}>{course.educator?.display_name || course.educator?.username || 'Educator'}</Text>
            </View>
            <View style={styles.courseInfoMetaItem}>
              <Ionicons name="key" size={13} color={COLORS.textMuted} />
              <Text style={styles.courseInfoMetaText}>Join code: {course.join_code}</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.tabsContainer}>
        {SECTIONS.map((s) => {
          const isActive = section === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={styles.tab}
              onPress={() => setSection(s.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{s.label}</Text>
              <View style={[styles.activeTabIndicator, !isActive && styles.activeTabIndicatorInactive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {section === 'tasks' && (
          <>
            {hasDueDate && (
              <View style={styles.filterRow}>
                {([
                  { key: 'all' as const, label: 'All' },
                  { key: 'upcoming' as const, label: 'Upcoming' },
                  { key: 'overdue' as const, label: 'Overdue' },
                ]).map((f) => {
                  const isActive = taskFilter === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.filterChip, isActive && styles.filterChipActive]}
                      onPress={() => setTaskFilter(f.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {filteredActivities.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="clipboard-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>No class tasks</Text>
                <Text style={styles.emptySubtitle}>The educator has not published any activities.</Text>
              </View>
            ) : (
              <View style={styles.activitiesSection}>
                <Text style={styles.activitiesHeader}>Class Tasks</Text>
                {filteredActivities.map((activity) => {
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
          </>
        )}

        {section === 'quizzes' && (
          <>
            {quizzes.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="help-circle-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>No quizzes</Text>
                <Text style={styles.emptySubtitle}>The educator has not created quizzes for this class.</Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {quizzes.map((quiz) => (
                  <TouchableOpacity
                    key={quiz.id}
                    style={styles.quizCard}
                    activeOpacity={0.8}
                    onPress={() => openQuiz(quiz)}
                  >
                    <View style={styles.quizHeader}>
                      <View style={styles.quizIconBox}>
                        <Ionicons name="help-circle" size={20} color={COLORS.purpleVibrant} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.quizTitle} numberOfLines={1}>{quiz.title}</Text>
                        <Text style={styles.quizMeta}>
                          {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={styles.quizTypePill}>
                        <Text style={styles.quizTypeText}>{QUIZ_TYPE_LABELS[quiz.quiz_type] || quiz.quiz_type}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        {section === 'leaderboard' && (
          <>
            {rankedStudents.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="trophy-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>No students yet</Text>
                <Text style={styles.emptySubtitle}>Students who join this class will appear here.</Text>
              </View>
            ) : (
              <View style={styles.leaderboardSection}>
                <Text style={styles.activitiesHeader}>Class Leaderboard</Text>
                {rankedStudents.map((s, index) => {
                  const isYou = currentUserId != null && s.id === currentUserId;
                  const initials = `${s.first_name?.[0] || ''}${s.last_name?.[0] || ''}`.toUpperCase() || (s.username || '?').charAt(0).toUpperCase();
                  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
                  return (
                    <View key={s.id} style={[styles.leaderRow, isYou && styles.leaderRowYou]}>
                      <View style={styles.leaderRankBox}>
                        <Text style={styles.leaderRankText}>{medal}</Text>
                      </View>
                      <View style={styles.leaderAvatar}>
                        <Text style={styles.leaderAvatarText}>{initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.playerNameRow}>
                          <Text style={styles.leaderName} numberOfLines={1}>
                            {s.first_name || s.username}
                            {isYou ? ' (You)' : ''}
                          </Text>
                          {s.streak > 0 && (
                            <View style={styles.streakChip}>
                              <Ionicons name="flame" size={11} color={COLORS.warning} />
                              <Text style={styles.streakChipText}>{s.streak}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.leaderSub}>Level {s.level} · {s.quizzes_taken} quizzes</Text>
                      </View>
                      <View style={styles.xpBox}>
                        <Text style={styles.xpValue}>{s.current_xp || s.total_points || 0}</Text>
                        <Text style={styles.xpLabel}>XP</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {section === 'topics' && (
          <>
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
                onPress={() => router.push(`/course/path/${courseId}?topicId=${topic.id}` as any)}
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
          </>
        )}
      </ScrollView>
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
  tabsContainer: { flexDirection: 'row', backgroundColor: COLORS.surface, marginHorizontal: 20, marginTop: -14, borderRadius: 16, paddingHorizontal: 4, borderWidth: 1, borderColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', gap: 6 },
  activeTabIndicator: { width: '60%', maxWidth: 40, height: 3, borderRadius: 1.5, backgroundColor: COLORS.purpleVibrant },
  activeTabIndicatorInactive: { backgroundColor: 'transparent' },
  tabText: { fontSize: 14, color: COLORS.textMuted, fontFamily: FONTS.semiBold, fontWeight: '600' },
  tabTextActive: { color: '#3a107a', fontFamily: FONTS.bold, fontWeight: '800' },
  quizCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quizHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quizIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.purpleGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quizTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  quizMeta: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 3 },
  quizTypePill: {
    backgroundColor: COLORS.purpleGhost,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quizTypeText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },
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

  // Course info panel
  courseInfoCard: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  courseInfoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  courseInfoName: { fontSize: 17, fontFamily: FONTS.bold, fontWeight: '800', color: COLORS.textPrimary, flex: 1 },
  courseInfoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.purpleGhost, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  courseInfoChipText: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },
  courseInfoDesc: { fontSize: 12.5, fontFamily: FONTS.medium, color: COLORS.textMuted, lineHeight: 18 },
  courseInfoMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 2 },
  courseInfoMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  courseInfoMetaText: { fontSize: 11.5, fontFamily: FONTS.medium, color: COLORS.textMuted },

  // Task filters
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    backgroundColor: COLORS.surface, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.purpleVibrant, borderColor: COLORS.purpleVibrant },
  filterChipText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  filterChipTextActive: { color: '#FFFFFF' },

  // Leaderboard
  leaderboardSection: { gap: 10 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  leaderRowYou: { borderColor: COLORS.purpleVibrant, borderWidth: 1.5 },
  leaderRankBox: { width: 30, alignItems: 'center' },
  leaderRankText: { fontSize: 16, fontFamily: FONTS.extraBold, color: COLORS.textPrimary },
  leaderAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.purpleVibrant, justifyContent: 'center', alignItems: 'center',
  },
  leaderAvatarText: { fontSize: 15, fontFamily: FONTS.bold, color: 'white' },
  playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaderName: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, flexShrink: 1 },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  streakChipText: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.warning },
  leaderSub: { fontSize: 11.5, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 2 },
  xpBox: { alignItems: 'flex-end' },
  xpValue: { fontSize: 16, fontFamily: FONTS.extraBold, color: COLORS.purpleVibrant },
  xpLabel: { fontSize: 9, fontFamily: FONTS.extraBold, letterSpacing: 1, color: COLORS.textMuted, marginTop: 1 },
});
