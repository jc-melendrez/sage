import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState, Pill, FilterChip } from '@/components/educator/EducatorPrimitives';
import { getCoursePath, createTopic, createNode, generateTopic, GenerateTopicResponse, getCourseLeaderboard, CourseLeaderboard, LeaderboardSort } from '@/services/courseService';
import { getQuizzes, Quiz } from '@/services/quizService';
import { getCourseActivities, createActivity, deleteActivity, updateActivity, ClassActivity, ActivityKind } from '@/services/activityService';
import { describeDue } from '@/services/dueDate';
import { CoursePathTopic, LearningNode, NODE_TYPE_CONFIG } from '@/types/learning';
import CourseLeaderboardView from '@/components/courses/CourseLeaderboard';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const QUIZ_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Multiple Choice',
  exam: 'Exam',
  flashcard: 'Flashcards',
};

const ACTIVITY_META: Record<ActivityKind, { label: string; icon: any }> = {
  quiz: { label: 'Quiz', icon: 'help-circle' },
  lesson: { label: 'Lesson', icon: 'book' },
  game: { label: 'Game', icon: 'game-controller' },
  task: { label: 'Assignment', icon: 'document-text' },
};

const BUILDER_KINDS: ActivityKind[] = ['quiz', 'task'];

type GeneratedNode = GenerateTopicResponse['nodes'][number];

type SectionKey = 'topics' | 'quizzes' | 'activities';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'topics', label: 'Topics' },
  { key: 'quizzes', label: 'Quizzes' },
  { key: 'activities', label: 'Activities' },
];

export default function CourseDetailScreen() {
  const router = useRouter();
  const { courseId, courseName } = useLocalSearchParams<{ courseId: string; courseName: string }>();
  const cid = Number(courseId);

  const [section, setSection] = useState<SectionKey>('topics');
  const [topics, setTopics] = useState<CoursePathTopic[]>([]);
  const [loading, setLoading] = useState(true);

  // Class quizzes + activities
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [activities, setActivities] = useState<ClassActivity[]>([]);

  // Class leaderboard
  const [leaderboard, setLeaderboard] = useState<CourseLeaderboard | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSort>('points');

  // Reused as the denominator for "N/M attempted" on quizzes and tasks.
  const studentTotal = leaderboard?.total_students ?? 0;

  // Add activity modal
  const [actVisible, setActVisible] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [actKind, setActKind] = useState<ActivityKind>('quiz');
  const [actTitle, setActTitle] = useState('');
  const [actNote, setActNote] = useState('');
  const [actDue, setActDue] = useState<'none' | 'today' | '1d' | '1w' | 'custom'>('none');
  const [actCustomDue, setActCustomDue] = useState<Date | null>(null);
  const [actStatus, setActStatus] = useState<'draft' | 'published'>('draft');
  const [actRefId, setActRefId] = useState<number | null>(null);
  const [actMaxPoints, setActMaxPoints] = useState('100');
  const [actAttachments, setActAttachments] = useState<DocumentPicker.DocumentPickerAsset[]>([]);

  // Date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [tempDate, setTempDate] = useState<Date>(new Date());

  // Add topic modal
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // AI generation modal
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiFile, setAiFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState('beginner');
  const [aiNodeCount, setAiNodeCount] = useState('4');
  const [generating, setGenerating] = useState(false);

  // AI preview
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState<GenerateTopicResponse | null>(null);
  const [savingPreview, setSavingPreview] = useState(false);

  const loadTopics = useCallback(async () => {
    try {
      const data = await getCoursePath(cid);
      setTopics(data);
    } catch {
      Alert.alert('Failed to load topics');
    } finally {
      setLoading(false);
    }
  }, [cid]);

  const loadQuizzes = useCallback(async () => {
    try {
      const data = await getQuizzes(cid);
      setQuizzes(data);
    } catch {
      // non-fatal — quizzes section shows empty
    }
  }, [cid]);

  const loadActivities = useCallback(async () => {
    try {
      const data = await getCourseActivities(cid);
      setActivities(data);
    } catch {
      // non-fatal
    }
  }, [cid]);

  const onSortLeaderboard = useCallback(async (sort: LeaderboardSort) => {
    setLeaderboardSort(sort);
    try {
      const data = await getCourseLeaderboard(cid, sort);
      setLeaderboard(data);
    } catch {
      // non-fatal — leaderboard section shows empty
    }
  }, [cid]);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const data = await getCourseLeaderboard(cid, leaderboardSort);
      setLeaderboard(data);
    } catch {
      setLeaderboard(null);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [cid, leaderboardSort]);

  const loadAll = useCallback(() => {
    loadTopics();
    loadQuizzes();
    loadActivities();
    loadLeaderboard();
  }, [loadTopics, loadQuizzes, loadActivities, loadLeaderboard]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const openQuizManager = (generate: boolean) => {
    router.push({
      pathname: '/educator/quiz-manager',
      params: { course: String(cid), ...(generate ? { generate: '1' } : {}) },
    });
  };

  /** Quick presets land on the end of the target day; custom keeps its time. */
  const endOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(23, 59, 0, 0);
    return d;
  };

  const dueToISO = (): string | null => {
    const now = new Date();
    if (actDue === 'today') return endOfDay(now).toISOString();
    if (actDue === '1d') return endOfDay(new Date(now.getTime() + 86400000)).toISOString();
    if (actDue === '1w') return endOfDay(new Date(now.getTime() + 604800000)).toISOString();
    if (actDue === 'custom' && actCustomDue) return actCustomDue.toISOString();
    return null;
  };

  const openDatePicker = () => {
    setTempDate(actCustomDue || new Date());
    setDatePickerMode('date');
    setShowDatePicker(true);
  };

  const handleDateChange = ({ nativeEvent }: any) => {
    if (nativeEvent.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }
    const newDate = nativeEvent.timestamp ? new Date(nativeEvent.timestamp) : tempDate;
    setTempDate(newDate);
    if (datePickerMode === 'date') {
      setDatePickerMode('time');
    } else {
      const combined = new Date(
        tempDate.getFullYear(),
        tempDate.getMonth(),
        tempDate.getDate(),
        newDate.getHours(),
        newDate.getMinutes()
      );
      setActCustomDue(combined);
      setActDue('custom');
      setShowDatePicker(false);
    }
  };

  const clearCustomDue = () => {
    setActCustomDue(null);
    setActDue('none');
  };

  const pickAttachments = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets.length) return;
      const newFiles = result.assets.filter((asset) => {
        if (asset.size && asset.size > MAX_FILE_SIZE) {
          Alert.alert('File too large', `"${asset.name}" exceeds 10 MB limit.`);
          return false;
        }
        return true;
      });
      setActAttachments((prev) => [...prev, ...newFiles]);
    } catch {
      Alert.alert('Error', 'Failed to pick files.');
    }
  };

  const removeAttachment = (index: number) => {
    setActAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCreateActivity = async () => {
    if (!actTitle.trim()) {
      Alert.alert('Title required', 'Please name the activity.');
      return;
    }
    for (const file of actAttachments) {
      if (file.size && file.size > MAX_FILE_SIZE) {
        Alert.alert('File too large', `"${file.name}" exceeds 10 MB limit.`);
        return;
      }
    }

    const maxPoints = actMaxPoints.trim() === '' ? 100 : Math.max(1, parseInt(actMaxPoints, 10) || 100);

    setCreatingActivity(true);
    try {
      await createActivity(cid, {
        kind: actKind,
        title: actTitle.trim(),
        ref_id: actKind === 'quiz' ? actRefId : null,
        note: actNote.trim(),
        due_date: dueToISO(),
        status: actStatus,
        max_points: actKind === 'task' ? maxPoints : undefined,
        attachments: actAttachments.length > 0 ? actAttachments : undefined,
      });
      setActVisible(false);
      setActTitle('');
      setActNote('');
      setActDue('none');
      setActCustomDue(null);
      setActKind('quiz');
      setActStatus('draft');
      setActRefId(null);
      setActMaxPoints('100');
      setActAttachments([]);
      await loadActivities();
    } catch (err) {
      Alert.alert('Failed to create activity', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setCreatingActivity(false);
    }
  };

  const handleToggleActivityStatus = async (activity: ClassActivity) => {
    try {
      await updateActivity(activity.id, { status: activity.status === 'published' ? 'draft' : 'published' });
      await loadActivities();
    } catch {
      Alert.alert('Update failed', 'Could not update the activity.');
    }
  };

  const handleDeleteActivity = (activity: ClassActivity) => {
    Alert.alert(
      'Delete activity',
      `"${activity.title}" will be removed from this class.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteActivity(activity.id);
              await loadActivities();
            } catch {
              Alert.alert('Delete failed', 'Could not delete the activity.');
            }
          },
        },
      ],
    );
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please give your topic a name.');
      return;
    }
    setCreating(true);
    try {
      await createTopic(cid, {
        title: title.trim(),
        description: description.trim(),
        order: topics.length,
      });
      setModalVisible(false);
      setTitle('');
      setDescription('');
      await loadTopics();
    } catch (err) {
      Alert.alert('Failed to create topic', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        setAiFile(result.assets[0]);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick file.');
    }
  };

  const handleGenerate = async () => {
    if (!aiFile) {
      Alert.alert('File required', 'Please select a file to generate from.');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateTopic(cid, {
        uri: aiFile.uri,
        name: aiFile.name,
        mimeType: aiFile.mimeType,
      }, {
        instructions: aiInstructions || undefined,
        difficulty: aiDifficulty,
        node_count: Number(aiNodeCount) || 4,
      });
      setAiModalVisible(false);
      setAiFile(null);
      setAiInstructions('');
      setPreviewData(result);
      setPreviewVisible(true);
    } catch (err) {
      Alert.alert('Generation failed', err instanceof Error ? err.message : 'AI could not generate content.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSavePreview = async () => {
    if (!previewData) return;
    setSavingPreview(true);
    let createdNodes = 0;
    let failedNodes = 0;
    try {
      const topic = await createTopic(cid, {
        title: String(previewData.title).slice(0, 255),
        description: previewData.description,
        order: topics.length,
      });
      for (let i = 0; i < previewData.nodes.length; i++) {
        const n = previewData.nodes[i];
        try {
          await createNode(topic.id, {
            node_type: n.node_type,
            title: n.title,
            description: n.description,
            content_json: n.content_json,
            order: i,
            xp_reward: Math.round(Number(n.xp_reward) || 25),
            required_score: Math.round(Number(n.required_score) || 70),
            estimated_minutes: Math.round(Number(n.estimated_minutes) || 5),
          });
          createdNodes++;
        } catch {
          failedNodes++;
        }
      }
      if (failedNodes === 0) {
        Alert.alert('Saved', `Topic saved with ${createdNodes} node${createdNodes === 1 ? '' : 's'}.`);
      } else {
        Alert.alert(
          'Partially saved',
          `Saved ${createdNodes} node${createdNodes === 1 ? '' : 's'}; ${failedNodes} could not be saved and were skipped.`,
        );
      }
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Could not save generated content.');
    } finally {
      setPreviewVisible(false);
      setPreviewData(null);
      setSavingPreview(false);
      await loadTopics();
    }
  };

  const totalNodes = topics.reduce((sum, t) => sum + t.nodes.length, 0);

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={courseName || 'Course'}
        subtitle={`${topics.length} topic${topics.length === 1 ? '' : 's'} · ${totalNodes} node${totalNodes === 1 ? '' : 's'}`}
        showBack
        rightIcon="add"
        onRightPress={() => {
          if (section === 'quizzes') openQuizManager(true);
          else if (section === 'activities') setActVisible(true);
          else if (section === 'topics') setModalVisible(true);
        }}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
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

        {section === 'topics' && (
          <>
            <SectionHeader title="Topics" actionLabel="Add" onAction={() => setModalVisible(true)} />

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              </View>
            ) : topics.length > 0 ? (
              <View style={{ gap: 14 }}>
                {topics.map((topic) => (
                  <TouchableOpacity
                    key={topic.id}
                    activeOpacity={0.7}
                    style={styles.topicCard}
                    onPress={() => router.push({
                      pathname: '/educator/(tabs)/topic-detail',
                      params: { topicId: topic.id, topicName: topic.title, courseId: cid },
                    })}
                  >
                    <View style={styles.topicHeader}>
                      <View style={styles.topicIconBg}>
                        <Ionicons name="layers" size={20} color={COLORS.purpleVibrant} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.topicName}>{topic.title}</Text>
                        {topic.description ? (
                          <Text style={styles.topicDesc} numberOfLines={1}>{topic.description}</Text>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={styles.previewBtn}
                        activeOpacity={0.7}
                        onPress={() => router.push({
                          pathname: '/course/topic/[topicId]',
                          params: {
                            topicId: topic.id,
                            courseId: cid,
                            title: topic.title,
                            preview: '1',
                          },
                        })}
                      >
                        <Ionicons name="eye" size={14} color={COLORS.purpleVibrant} />
                        <Text style={styles.previewBtnText}>Preview</Text>
                      </TouchableOpacity>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                    </View>

                    {topic.nodes.length > 0 ? (
                      <View style={styles.nodeRow}>
                        {topic.nodes.map((node: LearningNode) => {
                          const cfg = NODE_TYPE_CONFIG[node.node_type] || NODE_TYPE_CONFIG.learn;
                          return (
                            <Pill
                              key={node.id}
                              label={cfg.label}
                              color={cfg.color}
                              icon={cfg.icon as any}
                            />
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.noNodes}>No nodes yet — tap to add content</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <EmptyState
                icon="layers-outline"
                title="No topics yet"
                text="Create your first topic to start adding lessons and quizzes."
              />
            )}

            {/* AI Generate button */}
            {!loading && (
              <TouchableOpacity
                style={styles.aiBtn}
                activeOpacity={0.85}
                onPress={() => setAiModalVisible(true)}
              >
                <Ionicons name="sparkles" size={18} color={COLORS.purplePrimary} />
                <Text style={styles.aiBtnText}>Generate Topic with AI</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {section === 'quizzes' && (
          <>
            <SectionHeader title="Quizzes" actionLabel="Generate" onAction={() => openQuizManager(true)} />
            {quizzes.length > 0 ? (
              <View style={{ gap: 12 }}>
                {quizzes.map((quiz) => (
                  <TouchableOpacity
                    key={quiz.id}
                    activeOpacity={0.75}
                    style={styles.topicCard}
                    onPress={() => openQuizManager(false)}
                  >
                    <View style={styles.topicHeader}>
                      <View style={styles.topicIconBg}>
                        <Ionicons name="help-circle" size={20} color={COLORS.purpleVibrant} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.topicName}>{quiz.title}</Text>
                        <Text style={styles.topicDesc}>
                          {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <Pill
                        label={QUIZ_TYPE_LABELS[quiz.quiz_type] || quiz.quiz_type}
                        color={COLORS.purpleVibrant}
                      />
                    </View>
                    <View style={styles.activityBadges}>
                      <TouchableOpacity
                        onPress={() => router.push({
                          pathname: '/educator/(tabs)/quiz-attempts',
                          params: {
                            quizId: String(quiz.id),
                            quizTitle: quiz.title,
                            courseId: String(cid),
                          },
                        } as any)}
                        activeOpacity={0.8}
                        style={styles.activityStatusRow}
                      >
                        <Ionicons name="analytics-outline" size={13} color={COLORS.purpleVibrant} />
                        <Text style={[styles.activityStatusText, { color: COLORS.purpleVibrant, marginLeft: 2 }]}>
                          {quiz.class_attempted_count ?? 0}/{studentTotal} attempted
                        </Text>
                      </TouchableOpacity>
                      {quiz.class_average_percent != null && (
                        <Text style={[styles.activityStatusText, { color: COLORS.textSecondary }]}>
                          avg {quiz.class_average_percent}%
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              !loading && (
                <EmptyState
                  icon="help-circle-outline"
                  title="No quizzes yet"
                  text="Generate a quiz from study material for this class."
                />
              )
            )}
          </>
        )}

        {section === 'activities' && (
          <>
            <SectionHeader title="Activities" actionLabel="Add" onAction={() => setActVisible(true)} />
            {activities.length > 0 ? (
              <View style={{ gap: 12 }}>
                {activities.map((activity) => {
                  const meta = ACTIVITY_META[activity.kind] || ACTIVITY_META.quiz;
                  const due = describeDue(activity.due_date);
                  return (
                    <TouchableOpacity
                      key={activity.id}
                      style={styles.activityCard}
                      activeOpacity={0.85}
                      onPress={() =>
                        router.push({
                          pathname: '/educator/(tabs)/activity-detail',
                          params: { activityId: String(activity.id) },
                        } as any)
                      }
                    >
                      <View style={styles.activityTop}>
                        <View style={[styles.activityIconBg, { backgroundColor: tint(activity.status === 'published' ? COLORS.success : COLORS.purpleVibrant) }]}>
                          <Ionicons name={meta.icon} size={18} color={activity.status === 'published' ? COLORS.success : COLORS.purpleVibrant} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.activityTitle}>{activity.title}</Text>
                          <Text style={styles.activityMeta}>
                            {meta.label}
                            {activity.due_date ? ` · ${due.short}` : ''}
                            {activity.attachments && activity.attachments.length > 0
                              ? ` · ${activity.attachments.length} file${activity.attachments.length === 1 ? '' : 's'}`
                              : ''}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteActivity(activity)}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      </View>
                      {activity.note ? (
                        <Text style={styles.activityNote} numberOfLines={2}>{activity.note}</Text>
                      ) : null}
                      <View style={styles.activityBadges}>
                        <TouchableOpacity
                          onPress={() => handleToggleActivityStatus(activity)}
                          activeOpacity={0.8}
                          style={styles.activityStatusRow}
                        >
                          <Ionicons
                            name={activity.status === 'published' ? 'eye' : 'eye-off'}
                            size={13}
                            color={activity.status === 'published' ? COLORS.success : COLORS.warning}
                          />
                          <Text
                            style={[styles.activityStatusText, { color: activity.status === 'published' ? COLORS.success : COLORS.warning }]}
                          >
                            {activity.status === 'published' ? 'Published · tap to hide' : 'Draft · tap to publish'}
                          </Text>
                        </TouchableOpacity>
                        {activity.kind === 'task' && (
                          <TouchableOpacity
                            onPress={() => router.push({
                              pathname: '/educator/(tabs)/task-submissions',
                              params: { taskId: activity.id, taskTitle: activity.title, courseName: courseName || activity.course_name },
                            } as any)}
                            activeOpacity={0.8}
                            style={styles.activityStatusRow}
                          >
                            <Ionicons name="people-outline" size={13} color={COLORS.purpleVibrant} />
                            <Text style={[styles.activityStatusText, { color: COLORS.purpleVibrant, marginLeft: 2 }]}>
                              {activity.submission_count ?? 0}/{studentTotal} submitted
                            </Text>
                          </TouchableOpacity>
                        )}
                        {activity.kind === 'task' && (activity.graded_count ?? 0) > 0 && (
                          <Text style={[styles.activityStatusText, { color: COLORS.textSecondary }]}>
                            {activity.graded_count} graded
                          </Text>
                        )}
                        {activity.kind === 'quiz' && activity.ref_id != null && (
                          <TouchableOpacity
                            onPress={() => router.push({
                              pathname: '/educator/(tabs)/quiz-attempts',
                              params: {
                                quizId: String(activity.ref_id),
                                quizTitle: activity.title,
                                courseId: String(cid),
                              },
                            } as any)}
                            activeOpacity={0.8}
                            style={styles.activityStatusRow}
                          >
                            <Ionicons name="analytics-outline" size={13} color={COLORS.purpleVibrant} />
                            <Text style={[styles.activityStatusText, { color: COLORS.purpleVibrant, marginLeft: 2 }]}>
                              View results
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              !loading && (
                <EmptyState
                  icon="layers-outline"
                  title="No activities yet"
                  text="Add a quiz or assignment activity for this class."
                />
              )
            )}
          </>
        )}

</ScrollView>

      {/* Add topic modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Topic</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Topic title</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Variables & Data Types"
              placeholderTextColor={COLORS.textMuted}
              value={title}
              onChangeText={setTitle}
              autoCorrect={false}
            />

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What will students learn in this topic?"
              placeholderTextColor={COLORS.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={[styles.createBtn, creating && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={18} color="white" />
                  <Text style={styles.createBtnText}>Create Topic</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add activity modal */}
      <Modal animationType="slide" transparent visible={actVisible} onRequestClose={() => !creatingActivity && setActVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Activity</Text>
              <TouchableOpacity onPress={() => setActVisible(false)} activeOpacity={0.7} disabled={creatingActivity}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Type</Text>
            <View style={styles.kindRow}>
              {BUILDER_KINDS.map((kind) => {
                const meta = ACTIVITY_META[kind];
                const active = actKind === kind;
                return (
                  <TouchableOpacity
                    key={kind}
                    style={[styles.kindChip, active && styles.kindChipActive]}
                    activeOpacity={0.8}
                    onPress={() => setActKind(kind)}
                    disabled={creatingActivity}
                  >
                    <Ionicons name={meta.icon} size={15} color={active ? 'white' : COLORS.purpleVibrant} />
                    <Text style={[styles.kindText, active && styles.kindTextActive]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Forces Quiz in class"
              placeholderTextColor={COLORS.textMuted}
              value={actTitle}
              onChangeText={setActTitle}
              editable={!creatingActivity}
            />

            {actKind === 'task' && (
              <>
                <Text style={styles.label}>Max Points</Text>
                <TextInput
                  style={styles.input}
                  placeholder="100"
                  placeholderTextColor={COLORS.textMuted}
                  value={actMaxPoints}
                  onChangeText={(t) => setActMaxPoints(t)}
                  keyboardType="numeric"
                  editable={!creatingActivity}
                />
              </>
            )}

            {actKind === 'task' && (
              <>
                <Text style={styles.label}>Attachments (optional)</Text>
                <TouchableOpacity style={styles.fileBtn} activeOpacity={0.8} onPress={pickAttachments} disabled={creatingActivity}>
                  <Ionicons name={actAttachments.length > 0 ? 'document' : 'cloud-upload'} size={20} color={actAttachments.length > 0 ? COLORS.success : COLORS.purpleVibrant} />
                  <Text style={[styles.fileBtnText, actAttachments.length > 0 && { color: COLORS.success }]}>
                    {actAttachments.length > 0
                      ? `${actAttachments.length} file${actAttachments.length > 1 ? 's' : ''} attached`
                      : 'Add files (PDF, DOCX, images, ...)'}
                  </Text>
                </TouchableOpacity>
                {actAttachments.length > 0 && (
                  <View style={styles.attachmentList}>
                    {actAttachments.map((file, idx) => (
                      <View key={idx} style={styles.attachmentItem}>
                        <Ionicons name="document-text" size={16} color={COLORS.purpleVibrant} />
                        <Text style={styles.attachmentName} numberOfLines={1}>{file.name}</Text>
                        <Text style={styles.attachmentSize}>{file.size ? formatBytes(file.size) : 'Unknown size'}</Text>
                        <TouchableOpacity onPress={() => removeAttachment(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={creatingActivity}>
                          <Ionicons name="close-circle" size={18} color={COLORS.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Instructions or context for students"
              placeholderTextColor={COLORS.textMuted}
              value={actNote}
              onChangeText={setActNote}
              multiline
              numberOfLines={3}
              editable={!creatingActivity}
            />

            <Text style={styles.label}>Due date</Text>
            <View style={styles.kindRow}>
              {([
                ['none', 'No due date'],
                ['today', 'Today'],
                ['1d', 'Tomorrow'],
                ['1w', 'In 1 week'],
                ['custom', 'Custom…'],
              ] as const).map(([value, label]) => {
                const active = actDue === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[styles.kindChip, active && styles.kindChipActive]}
                    activeOpacity={0.8}
                    onPress={() => value === 'custom' ? openDatePicker() : setActDue(value as typeof actDue)}
                    disabled={creatingActivity}
                  >
                    <Text style={[styles.kindText, active && styles.kindTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {actDue === 'custom' && actCustomDue && (
              <View style={styles.customDueRow}>
                <Text style={styles.customDueText}>
                  Due: {new Date(actCustomDue).toLocaleString()}
                </Text>
                <TouchableOpacity onPress={clearCustomDue} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={creatingActivity}>
                  <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            )}

            {actKind === 'quiz' && (
              <>
                <Text style={styles.label}>Attach quiz {quizzes.length > 0 ? '' : '(none in this class yet)'}</Text>
                {quizzes.length > 0 ? (
                  <View style={styles.kindRow}>
                    <FilterChip label="No quiz" active={actRefId === null} onPress={() => setActRefId(null)} disabled={creatingActivity} />
                    {quizzes.map((q) => (
                      <FilterChip
                        key={q.id}
                        label={q.title}
                        active={actRefId === q.id}
                        onPress={() => setActRefId(q.id)}
                        disabled={creatingActivity}
                      />
                    ))}
                  </View>
                ) : (
                  <Pill label="Create quizzes in the Quizzes section first" color={COLORS.textMuted} icon="information-circle-outline" />
                )}
              </>
            )}

            <Text style={styles.label}>Status</Text>
            <View style={styles.kindRow}>
              {(['draft', 'published'] as const).map((status) => {
                const active = actStatus === status;
                return (
                  <TouchableOpacity
                    key={status}
                    style={[styles.kindChip, active && styles.kindChipActive]}
                    activeOpacity={0.8}
                    onPress={() => setActStatus(status)}
                    disabled={creatingActivity}
                  >
                    <Text style={[styles.kindText, active && styles.kindTextActive]}>
                      {status === 'draft' ? 'Draft' : 'Published'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.createBtn, creatingActivity && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleCreateActivity}
              disabled={creatingActivity}
            >
              {creatingActivity ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={18} color="white" />
                  <Text style={styles.createBtnText}>Add Activity</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI generation modal */}
      <Modal animationType="slide" transparent visible={aiModalVisible} onRequestClose={() => !generating && setAiModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate with AI</Text>
              <TouchableOpacity onPress={() => setAiModalVisible(false)} activeOpacity={0.7} disabled={generating}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Study material *</Text>
            <TouchableOpacity style={styles.fileBtn} activeOpacity={0.8} onPress={handlePickFile} disabled={generating}>
              <Ionicons name={aiFile ? 'document' : 'cloud-upload'} size={20} color={aiFile ? COLORS.success : COLORS.purpleVibrant} />
              <Text style={[styles.fileBtnText, aiFile && { color: COLORS.success }]}>
                {aiFile ? aiFile.name : 'Pick a file (PDF, DOCX, TXT)'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.label}>Additional instructions</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Focus on loops and conditionals"
              placeholderTextColor={COLORS.textMuted}
              value={aiInstructions}
              onChangeText={setAiInstructions}
              editable={!generating}
            />

            <View style={styles.settingsRow}>
              <View style={styles.settingsField}>
                <Text style={styles.label}>Difficulty</Text>
                {['beginner', 'intermediate', 'advanced'].map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.diffChip, aiDifficulty === d && styles.diffChipActive]}
                    activeOpacity={0.8}
                    onPress={() => setAiDifficulty(d)}
                    disabled={generating}
                  >
                    <Text style={[styles.diffText, aiDifficulty === d && styles.diffTextActive]}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.settingsField}>
                <Text style={styles.label}>Nodes</Text>
                <TextInput
                  style={styles.input}
                  placeholder="4"
                  placeholderTextColor={COLORS.textMuted}
                  value={aiNodeCount}
                  onChangeText={setAiNodeCount}
                  keyboardType="numeric"
                  editable={!generating}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.createBtn, (!aiFile || generating) && { opacity: 0.5 }]}
              activeOpacity={0.85}
              onPress={handleGenerate}
              disabled={!aiFile || generating}
            >
              {generating ? (
                <>
                  <ActivityIndicator color="white" />
                  <Text style={styles.createBtnText}>Generating...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="white" />
                  <Text style={styles.createBtnText}>Generate</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI preview modal */}
      <Modal animationType="slide" transparent visible={previewVisible} onRequestClose={() => !savingPreview && setPreviewVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Review Generated Topic</Text>
              <TouchableOpacity onPress={() => setPreviewVisible(false)} activeOpacity={0.7} disabled={savingPreview}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {previewData && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.previewTitle}>{previewData.title}</Text>
                {previewData.description ? (
                  <Text style={styles.previewDesc}>{previewData.description}</Text>
                ) : null}

                <Text style={[styles.label, { marginTop: 16 }]}>
                  {previewData.nodes.length} node{previewData.nodes.length === 1 ? '' : 's'} generated
                </Text>

                {previewData.nodes.map((node: GeneratedNode, i: number) => {
                  const cfg = NODE_TYPE_CONFIG[node.node_type] || NODE_TYPE_CONFIG.learn;
                  return (
                    <View key={i} style={styles.previewNode}>
                      <View style={[styles.previewNodeBadge, { backgroundColor: tint(cfg.color) }]}>
                        <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.previewNodeTitle}>{node.title}</Text>
                        <Text style={styles.previewNodeMeta}>
                          {cfg.label} · {node.xp_reward} XP · {node.estimated_minutes}min
                        </Text>
                      </View>
                    </View>
                  );
                })}

                <TouchableOpacity
                  style={[styles.createBtn, savingPreview && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  onPress={handleSavePreview}
                  disabled={savingPreview}
                >
                  {savingPreview ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="white" />
                      <Text style={styles.createBtnText}>Save Topic & Nodes</Text>
                    </>
                  )}
</TouchableOpacity>
      </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      {showDatePicker && Platform.OS !== 'web' && (
        <DateTimePicker
          testID="datePicker"
          value={tempDate}
          mode={datePickerMode}
          is24Hour={true}
          onChange={handleDateChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24, backgroundColor: 'white' },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  tabsContainer: { flexDirection: 'row', marginBottom: 8 },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  activeTabIndicator: {
    width: '60%',
    maxWidth: 40,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.purplePrimary,
  },
  activeTabIndicatorInactive: {
    backgroundColor: 'transparent',
  },
  tabText: {
    fontSize: 15,
    color: COLORS.textMuted,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.purpleDeep,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },

  activityCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  activityTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  activityIconBg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  activityMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  activityNote: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 17, marginTop: 10 },
  activityStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  activityBadges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16 },
  activityStatusText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600' },

  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'white',
  },
  kindChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  kindText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  kindTextActive: { color: 'white' },

  topicCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  topicHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topicIconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(COLORS.purpleVibrant),
    justifyContent: 'center',
    alignItems: 'center',
  },
  topicName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  topicDesc: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },

  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: tint(COLORS.purpleVibrant),
  },
  previewBtnText: { fontSize: 11, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleVibrant },

  nodeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  noNodes: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 10, fontStyle: 'italic' },

  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.purplePrimary,
    borderStyle: 'dashed',
    backgroundColor: tint(COLORS.purplePrimary, 0.06),
  },
  aiBtnText: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purplePrimary },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  label: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fileBtnText: { fontSize: 14, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted, flex: 1 },

  settingsRow: { flexDirection: 'row', gap: 16 },
  settingsField: { flex: 1 },

  diffChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'white',
    marginBottom: 6,
  },
  diffChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  diffText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, textAlign: 'center' },
  diffTextActive: { color: 'white' },

  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    marginTop: 24,
  },
  createBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },

  previewTitle: { fontSize: 18, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.textPrimary },
  previewDesc: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 18, marginTop: 4 },

  previewNode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  previewNodeBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewNodeTitle: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  previewNodeMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },

  attachmentList: { marginTop: 8, gap: 6 },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  attachmentName: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1 },
  attachmentSize: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginRight: 8 },
  customDueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 8,
  },
  customDueText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary },
});
