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
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { createCourse, getMyCourses, CourseRoster } from '@/services/courseService';
import { getQuizzes, Quiz } from '@/services/quizService';
import { getUserGroups, createGroup, joinGroup, StudyGroup } from '@/services/groupService';

type ClassTab = 'courses' | 'quizzes' | 'groups';

const TABS: { key: ClassTab; label: string }[] = [
  { key: 'courses', label: 'Courses' },
  { key: 'quizzes', label: 'Quizzes' },
  { key: 'groups', label: 'Groups' },
];

const QUIZ_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Multiple Choice',
  true_false: 'True/False',
  short_answer: 'Short Answer',
  fill_blank: 'Fill-in-the-Blank',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function quizTypeLabel(type: string): string {
  return QUIZ_TYPE_LABELS[type] || type || 'Quiz';
}

export default function EducatorCoursesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<ClassTab>('courses');

  const [courses, setCourses] = useState<CourseRoster[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const [groupModal, setGroupModal] = useState<'create' | 'join' | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupSubmitting, setGroupSubmitting] = useState(false);

  const loadAll = useCallback(async (opts?: { isRefresh?: boolean }) => {
    const isRefresh = opts?.isRefresh ?? false;
    try {
      if (!isRefresh) setLoading(true);
      const [courseData, quizData, groupData] = await Promise.all([
        getMyCourses(),
        getQuizzes().catch(() => []),
        getUserGroups().catch(() => []),
      ]);
      setCourses(courseData);
      setQuizzes(quizData);
      setGroups(groupData);
    } catch (err) {
      Alert.alert('Failed to load data', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadAll({ isRefresh: true });
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Course name required', 'Please give your course a name.');
      return;
    }
    setCreating(true);
    try {
      const course = await createCourse({ name: name.trim(), description: description.trim() });
      setModalVisible(false);
      setName('');
      setDescription('');
      setCreatedCode(course.join_code);
      await loadAll({ isRefresh: true });
    } catch (err) {
      Alert.alert('Failed to create course', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateGroup = async () => {
    const trimmed = groupName.trim();
    if (!trimmed) {
      Alert.alert('Group name required', 'Please give your group a name.');
      return;
    }
    setGroupSubmitting(true);
    try {
      const res = await createGroup(trimmed);
      setGroupName('');
      setGroupModal(null);
      Alert.alert('Group created', `Share join code ${res.join_code} with your students.`);
      await loadAll({ isRefresh: true });
    } catch (err) {
      Alert.alert('Failed to create group', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setGroupSubmitting(false);
    }
  };

  const handleJoinGroup = async () => {
    const code = groupCode.trim().toUpperCase();
    if (!code) {
      Alert.alert('Code required', 'Enter the 6-character join code.');
      return;
    }
    setGroupSubmitting(true);
    try {
      await joinGroup(code);
      setGroupCode('');
      setGroupModal(null);
      await loadAll({ isRefresh: true });
    } catch (err) {
      Alert.alert('Failed to join group', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setGroupSubmitting(false);
    }
  };

  const courseName = (courseId: number | null): string | null => {
    if (courseId == null) return null;
    const course = courses.find((c) => c.id === courseId);
    return course?.name ?? null;
  };

  const openQuizManager = (courseId?: number) => {
    router.push({
      pathname: '/educator/(tabs)/quiz-manager',
      params: courseId != null ? { course: String(courseId) } : {},
    });
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="My Classes"
        subtitle={`${courses.length} course${courses.length === 1 ? '' : 's'} · ${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'} · ${groups.length} group${groups.length === 1 ? '' : 's'}`}
        rightIcon="add"
        onRightPress={() => setModalVisible(true)}
      />

      <View style={styles.tabsContainer}>
        {TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tab}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{t.label}</Text>
              <View style={[styles.activeTabIndicator, !isActive && styles.activeTabIndicatorInactive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.purpleVibrant} colors={[COLORS.purpleVibrant]} />
        }
      >
        {/* COURSES TAB */}
        {tab === 'courses' && (
          <View style={styles.section}>
            <SectionHeader title="Courses" actionLabel="New" onAction={() => setModalVisible(true)} />

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              </View>
            ) : courses.length > 0 ? (
              <View style={{ gap: 14 }}>
                {courses.map((course) => (
                  <TouchableOpacity
                    key={course.id}
                    style={styles.courseCard}
                    activeOpacity={0.7}
                    onPress={() => router.push({
                      pathname: '/educator/(tabs)/course-detail',
                      params: { courseId: course.id, courseName: course.name },
                    })}
                  >
                    <View style={styles.courseHeader}>
                      <View style={styles.courseIconBg}>
                        <Ionicons name="book" size={20} color={COLORS.purpleVibrant} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.courseName}>{course.name}</Text>
                        <Text style={styles.courseMeta}>
                          {course.student_count} student{course.student_count === 1 ? '' : 's'} · created {formatDate(course.created_at)}
                        </Text>
                      </View>
                    </View>

                    {course.description ? (
                      <Text style={styles.courseDesc} numberOfLines={2}>{course.description}</Text>
                    ) : null}

                    <View style={styles.codeRow}>
                      <View style={styles.codeLabel}>
                        <Ionicons name="key" size={13} color={COLORS.purplePrimary} />
                        <Text style={styles.codeLabelText}>Join code</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.codeChip}
                        activeOpacity={0.8}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setCreatedCode(course.join_code);
                        }}
                      >
                        <Text style={styles.codeChipText}>{course.join_code}</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <EmptyState
                icon="book-outline"
                title="No courses yet"
                text="Create your first course and share the join code so students can enroll."
              />
            )}
          </View>
        )}

        {/* QUIZZES TAB */}
        {tab === 'quizzes' && (
          <View style={styles.section}>
            <SectionHeader title="Quizzes" actionLabel="Generate" onAction={() => router.push({
              pathname: '/educator/(tabs)/quiz-manager',
              params: { generate: '1' },
            })} />

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              </View>
            ) : quizzes.length > 0 ? (
              <View style={{ gap: 14 }}>
                {quizzes.map((quiz) => {
                  const linkedCourse = quiz.course != null ? courseName(quiz.course) : null;
                  return (
                    <TouchableOpacity
                      key={quiz.id}
                      style={styles.courseCard}
                      activeOpacity={0.7}
                      onPress={() => openQuizManager(quiz.course ?? undefined)}
                    >
                      <View style={styles.courseHeader}>
                        <View style={styles.quizIconBg}>
                          <Ionicons name="help" size={20} color={COLORS.purpleVibrant} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.courseName}>{quiz.title}</Text>
                          <Text style={styles.courseMeta}>
                            {quizTypeLabel(quiz.quiz_type)} · {quiz.questions?.length ?? 0} question{(quiz.questions?.length ?? 0) === 1 ? '' : 's'}
                          </Text>
                        </View>
                      </View>
                      {linkedCourse ? (
                        <View style={styles.quizCourseRow}>
                          <Ionicons name="school-outline" size={13} color={COLORS.textMuted} />
                          <Text style={styles.quizCourseText}>{linkedCourse}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <EmptyState
                icon="help-circle-outline"
                title="No quizzes yet"
                text="Generate quizzes from study material with AI and attach them to a class."
              />
            )}
          </View>
        )}

        {/* GROUPS TAB */}
        {tab === 'groups' && (
          <View style={styles.section}>
            <View style={styles.groupActions}>
              <TouchableOpacity style={styles.groupActionBtn} activeOpacity={0.8} onPress={() => setGroupModal('create')}>
                <Ionicons name="create-outline" size={16} color={COLORS.purplePrimary} />
                <Text style={styles.groupActionText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.groupActionBtn} activeOpacity={0.8} onPress={() => setGroupModal('join')}>
                <Ionicons name="enter-outline" size={16} color={COLORS.purplePrimary} />
                <Text style={styles.groupActionText}>Join Code</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              </View>
            ) : groups.length > 0 ? (
              <View style={{ gap: 12 }}>
                {groups.map((group) => (
                  <TouchableOpacity
                    key={group.id}
                    style={styles.groupCard}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/chat/${group.id}` as any)}
                  >
                    <View style={styles.groupAvatar}>
                      <Text style={styles.groupAvatarText}>{group.name.substring(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                      <Text style={styles.groupMeta}>
                        {group.members_count} {group.members_count === 1 ? 'member' : 'members'} · code {group.join_code}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <EmptyState
                icon="people-outline"
                title="No study groups yet"
                text="Create a group for your class, or join one with a code from students."
              />
            )}
          </View>
        )}
      </ScrollView>

      {/* Create course modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Course</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Course name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Algebra I"
              placeholderTextColor={COLORS.textMuted}
              value={name}
              onChangeText={setName}
              autoCorrect={false}
            />

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What is this course about?"
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
                  <Text style={styles.createBtnText}>Create Course</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Join code reveal modal */}
      <Modal animationType="fade" transparent visible={createdCode !== null} onRequestClose={() => setCreatedCode(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share join code</Text>
              <TouchableOpacity onPress={() => setCreatedCode(null)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.shareText}>
              Students can join this course by entering the code below:
            </Text>
            <View style={styles.codeDisplay}>
              <Text style={styles.codeDisplayText}>{createdCode}</Text>
            </View>
            <TouchableOpacity style={styles.doneBtn} activeOpacity={0.85} onPress={() => setCreatedCode(null)}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create / join group modals */}
      <Modal
        animationType="fade"
        transparent
        visible={groupModal !== null}
        onRequestClose={() => { if (!groupSubmitting) setGroupModal(null); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{groupModal === 'create' ? 'Create Group' : 'Join Group'}</Text>
              <TouchableOpacity onPress={() => { if (!groupSubmitting) setGroupModal(null); }} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {groupModal === 'create' ? (
              <>
                <Text style={styles.label}>Group name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Study group for Period 1"
                  placeholderTextColor={COLORS.textMuted}
                  value={groupName}
                  onChangeText={setGroupName}
                />
                <TouchableOpacity
                  style={[styles.createBtn, groupSubmitting && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  onPress={handleCreateGroup}
                  disabled={groupSubmitting}
                >
                  {groupSubmitting ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="people" size={18} color="white" />
                      <Text style={styles.createBtnText}>Create Group</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Join code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="6-character code"
                  placeholderTextColor={COLORS.textMuted}
                  value={groupCode}
                  onChangeText={setGroupCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.createBtn, groupSubmitting && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  onPress={handleJoinGroup}
                  disabled={groupSubmitting}
                >
                  {groupSubmitting ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="enter-outline" size={18} color="white" />
                      <Text style={styles.createBtnText}>Join Group</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1 },
  section: { paddingHorizontal: 24, paddingTop: 24 },

  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
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

  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  courseCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  courseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  courseIconBg: { width: 40, height: 40, borderRadius: 20, backgroundColor: tint(COLORS.purpleVibrant), justifyContent: 'center', alignItems: 'center' },
  quizIconBg: { width: 40, height: 40, borderRadius: 20, backgroundColor: tint('#3B82F6'), justifyContent: 'center', alignItems: 'center' },
  courseName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  courseMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  courseDesc: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textSecondary, lineHeight: 18, marginTop: 10 },
  quizCourseRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  quizCourseText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted },

  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  codeLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  codeLabelText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted },
  codeChip: { backgroundColor: tint(COLORS.purplePrimary, 0.12), paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.pill },
  codeChipText: { fontSize: 14, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purplePrimary, letterSpacing: 1.5 },

  groupActions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  groupActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.purplePrimary,
    backgroundColor: tint(COLORS.purplePrimary, 0.08),
  },
  groupActionText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(COLORS.purpleVibrant),
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupAvatarText: { fontSize: 15, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.purpleDark },
  groupName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  groupMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#F9FAFB', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  label: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: 'white', borderRadius: RADIUS.md, padding: 14, fontSize: 15, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.purplePrimary, paddingVertical: 16, borderRadius: RADIUS.md, marginTop: 24 },
  createBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },

  shareText: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 20, marginBottom: 16 },
  codeDisplay: { backgroundColor: COLORS.bgSecondary, borderRadius: RADIUS.md, paddingVertical: 18, alignItems: 'center' },
  codeDisplayText: { fontSize: 34, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purpleDark, letterSpacing: 4 },
  doneBtn: { backgroundColor: COLORS.purplePrimary, alignItems: 'center', paddingVertical: 14, borderRadius: RADIUS.md, marginTop: 20 },
  doneBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },
});