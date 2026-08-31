import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
  TextInput, ActivityIndicator, Alert, Platform, StatusBar, RefreshControl
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/config/api';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';
import { completeQuiz, completeLesson, getMyProgress } from '@/services/gamificationService';
import TakeQuiz from '../../components/TakeQuiz';
import LessonGenerator from '@/components/LessonGenerator';
import CourseCard from '@/components/courses/CourseCard';
import CourseDetailModal from '@/components/courses/CourseDetailModal';
import EmptyCourseState from '@/components/courses/EmptyCourseState';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { palette as COLORS, fontFamily as FONTS } from '@/constants/theme';
import {
  loadGeneratedCourses,
  addGeneratedCourse,
  GeneratedCourse,
} from '@/services/generatedCoursesService';
import { TabSkeleton } from '@/components/Skeleton';


// --- Interfaces ---
interface StudyGroup {
  id: number;
  name: string;
  description: string;
  members_count: number;
  join_code: string;
  created_by: number;
}

type Course = GeneratedCourse;

interface Level {
  level_id: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  content: string;
  quiz: QuizQuestion[];
  passing_score: number;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: number;
}

interface Quiz {
  id: number;
  title: string;
  created_at: string;
  quiz_type?: string;
  questions: any[];
}

export default function ActivitiesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedTab, setSelectedTab] = useState('groups');

  // Group & Quiz state
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // --- NEW: Courses state ---
  const [courses, setCourses] = useState<GeneratedCourse[]>([]);
  const [levelProgress, setLevelProgress] = useState<{ [key: string]: number }>({});
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);

  // --- Quiz Player State ---
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [quizToTake, setQuizToTake] = useState<{ title: string; questions: any[]; levelId: number; passingScore: number } | null>(null);

  // --- Group Management Modals ---
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Generate Lesson Modal ---
  const [isGenerateLessonModalOpen, setIsGenerateLessonModalOpen] = useState(false);

  // --- Quiz Generator State ---
  const [isGenerateQuizModalOpen, setIsGenerateQuizModalOpen] = useState(false);
  const [quizFile, setQuizFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [quizDifficulty, setQuizDifficulty] = useState('Medium');
  const [quizCount, setQuizCount] = useState('10');
  const [quizType, setQuizType] = useState('Multiple Choice');
  const [isQuizTypeDropdownOpen, setIsQuizTypeDropdownOpen] = useState(false);
  const [quizInstructions, setQuizInstructions] = useState('');
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [quizGenerationStatus, setQuizGenerationStatus] = useState('');
  const questionTypeOptions = ['Multiple Choice', 'True/False', 'Short Answer', 'Fill-in-the-Blank'];

  const pickQuizFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setQuizFile(result.assets[0]);
    } catch (err) {
      console.error("File picker error:", err);
      Alert.alert("Error", "Failed to select file.");
    }
  };

  const handleGenerateQuiz = async () => {
    if (!quizFile) {
      Alert.alert("Material Required", "Please select a study material (PDF or Text) before generating a quiz.");
      return;
    }
    setIsGeneratingQuiz(true);
    try {
      // Honest stage-based progress: real steps only, no fabricated percentages.
      setQuizGenerationStatus("Reading file...");

      const base64Data = await FileSystem.readAsStringAsync(quizFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setQuizGenerationStatus("Generating questions...");

      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/ai/generate-quiz/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          file: { name: quizFile.name, data: base64Data },
          difficulty: quizDifficulty,
          count: parseInt(quizCount),
          type: quizType,
          instructions: quizInstructions
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate quiz");
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Quiz Ready!", `Successfully generated ${quizCount} ${quizDifficulty} ${quizType} questions.`);
      setIsGenerateQuizModalOpen(false);
      setQuizFile(null);
      setQuizInstructions('');
      await loadInitialData({ isRefresh: true });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error("Generation Error Details:", err);
      Alert.alert("Generation Failed", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsGeneratingQuiz(false);
      setQuizGenerationStatus('');
    }
  };

  const levelKey = (courseId: string, levelId: number) => `${courseId}::${levelId}`;

  const loadPersistedProgress = React.useCallback(async () => {
    try {
      const data = await getMyProgress();
      const map: { [key: string]: number } = {};
      data.lesson_progress.forEach(p => {
        map[levelKey(p.course_id, p.level_id)] = p.score;
      });
      setLevelProgress(map);
    } catch (error) {
      console.error('Failed to load persisted course progress:', error);
    }
  }, []);

  const loadInitialData = React.useCallback(async (opts?: { isRefresh?: boolean }) => {
    const isRefresh = opts?.isRefresh ?? false;
    try {
      setLoading(!isRefresh);
      const token = await getToken();

      const [groupRes, quizRes] = await Promise.all([
        fetch(`${API_BASE_URL}/users/groups/mine/`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/ai/quizzes/`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (groupRes.ok) setGroups(await groupRes.json());
      if (quizRes.ok) setQuizzes(await quizRes.json());

      const savedCourses = await loadGeneratedCourses();
      setCourses(savedCourses);

      loadPersistedProgress();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [loadPersistedProgress]);

  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await loadInitialData({ isRefresh: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadInitialData]);

  // Initial load
  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  const openChat = (group: StudyGroup) => {
    router.push(`/chat/${group.id}` as any);
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      Alert.alert('Name Required', 'Please enter a name for your group.');
      return;
    }
    try {
      setIsSubmitting(true);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/create/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        setNewGroupName('');
        setIsCreateModalOpen(false);
        loadInitialData();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Could Not Create Group', (err as any).error || (err as any).name?.[0] || 'Please try again.');
      }
    } catch {
      Alert.alert('Connection Error', 'Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinGroup = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert('Code Required', 'Please enter the 6-character join code.');
      return;
    }
    try {
      setIsSubmitting(true);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/join/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ join_code: code })
      });
      if (res.ok) {
        setJoinCodeInput('');
        setIsJoinModalOpen(false);
        loadInitialData();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Could Not Join', (err as any).error || (err as any).detail || 'Invalid join code.');
      }
    } catch {
      Alert.alert('Connection Error', 'Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateLevelProgress = (course: Course, levelId: number, score: number) => {
    setLevelProgress(prev => ({ ...prev, [levelKey(course.course_title, levelId)]: score }));
  };

  const handleCourseGenerated = (course: GeneratedCourse) => {
    setCourses(prev => [course, ...prev]);
    addGeneratedCourse(course);
    setIsGenerateLessonModalOpen(false);
    Alert.alert('Success', 'Course generated successfully!');
  };

  const openCourseDetail = (course: Course) => {
    setSelectedCourse(course);
    setIsCourseModalOpen(true);
  };

  const takeQuizForLevel = (level: Level) => {
    const quizQuestions = level.quiz.map((q, idx) => {
      const correctAnswer = typeof q.correct_answer === 'number'
        ? q.options[q.correct_answer]
        : q.correct_answer;
      return {
        id: idx + 1,
        question: q.question,
        type: 'Multiple Choice' as const,
        options: q.options,
        correct_answer: correctAnswer,
      };
    });
    setQuizToTake({
      title: `${level.difficulty} Quiz`,
      questions: quizQuestions,
      levelId: level.level_id,
      passingScore: level.passing_score,
    });
    setIsQuizModalOpen(true);
  };

  const handleSelectTab = (tab: 'lessons' | 'quizzes' | 'groups') => {
    if (tab === selectedTab) return;
    Haptics.selectionAsync();
    setSelectedTab(tab);
  };


  // --- MAIN TABS VIEW ---
  return (
    <LinearGradient
      colors={[COLORS.bgSecondary, COLORS.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.mainWrapper}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 24 }]}
      >
        <Text style={styles.headerTitle}>Activities</Text>
        <Text style={styles.headerSubtitle}>Courses, quizzes, and study groups</Text>
      </LinearGradient>

      <View
        style={styles.tabsContainer}
        accessibilityRole="tablist"
      >
        {([
          ['lessons', 'Courses'],
          ['quizzes', 'Quizzes'],
          ['groups', 'Groups'],
        ] as const).map(([key, label]) => {
          const isActive = selectedTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => handleSelectTab(key)}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
              <View style={[styles.activeTabIndicator, !isActive && styles.activeTabIndicatorInactive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.purplePrimary}
            colors={[COLORS.purplePrimary]}
          />
        }
      >
        {/* COURSES VIEW */}
        {selectedTab === 'lessons' && loading && <TabSkeleton tab="lessons" />}
        {selectedTab === 'lessons' && !loading && (
          <View style={styles.itemsList}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/courses')}>
              <LinearGradient
                colors={[COLORS.purpleDeep, COLORS.purpleVibrant]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.coursePathBtn}
              >
                <Ionicons name="map-outline" size={20} color="white" />
                <Text style={styles.coursePathBtnText}>Open Course Path</Text>
                <Ionicons name="chevron-forward" size={18} color="white" style={{ opacity: 0.7 }} />
              </LinearGradient>
            </TouchableOpacity>
            {courses.length === 0 && <EmptyCourseState />}
            {courses.map((course, index) => {
              const completedLevels = course.levels.filter((l) => {
                const score = levelProgress[levelKey(course.course_title, l.level_id)] ?? 0;
                return score >= l.passing_score;
              }).length;
              return (
                <CourseCard
                  key={`course-${index}`}
                  course={course}
                  completedLevels={completedLevels}
                  onPress={() => openCourseDetail(course)}
                />
              );
            })}
          </View>
        )}

        {/* QUIZZES VIEW */}
        {selectedTab === 'quizzes' && loading && <TabSkeleton tab="quizzes" />}
        {selectedTab === 'quizzes' && !loading && (
          <View style={[styles.itemsList, { paddingHorizontal: 24 }]}>
            {quizzes.length === 0 && (
              <View style={styles.emptyStateCard}>
                <View style={styles.emptyStateIconContainer}>
                  <Ionicons name="help-circle-outline" size={48} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.emptyStateTitle}>No quizzes yet</Text>
                <Text style={styles.emptyStateText}>Complete lessons to unlock AI quizzes.</Text>
              </View>
            )}
            {quizzes.map((quiz) => (
              <View key={quiz.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgesRow}>
                      <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.questions?.length || 0} Qs</Text></View>
                      {quiz.quiz_type && <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.quiz_type}</Text></View>}
                    </View>
                    <Text style={styles.cardTitle}>{quiz.title}</Text>
                    <Text style={styles.metaText}>Created {new Date(quiz.created_at).toLocaleDateString()}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.takeQuizBtn}
                    onPress={() => {
                      setQuizToTake({
                        title: quiz.title,
                        questions: quiz.questions.map((q: any) => ({
                          id: q.id,
                          question: q.question_text,
                          type: (quiz.quiz_type || 'Multiple Choice') as any,
                          options: q.options,
                          correct_answer: q.correct_answer,
                        })),
                        levelId: -1,
                        passingScore: 0,
                      });
                      setIsQuizModalOpen(true);
                    }}
                  >
                    <Ionicons name="play-outline" size={16} color="white" />
                    <Text style={styles.takeQuizBtnText}>Take</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* GROUPS VIEW */}
        {selectedTab === 'groups' && loading && <TabSkeleton tab="groups" />}
        {selectedTab === 'groups' && !loading && (
          <View style={styles.inboxContainer}>
            <View style={styles.inboxActions}>
              <TouchableOpacity style={styles.inboxBtn} onPress={() => setIsCreateModalOpen(true)}>
                <Ionicons name="create-outline" size={18} color={COLORS.purpleDeep} />
                <Text style={styles.inboxBtnText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inboxBtn} onPress={() => setIsJoinModalOpen(true)}>
                <Ionicons name="enter-outline" size={18} color={COLORS.purpleDeep} />
                <Text style={styles.inboxBtnText}>Join Code</Text>
              </TouchableOpacity>
            </View>

            {groups.length === 0 && (
              <View style={styles.emptyStateCard}>
                <View style={styles.emptyStateIconContainer}>
                  <Ionicons name="people-outline" size={48} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.emptyStateTitle}>No study groups yet</Text>
                <Text style={styles.emptyStateText}>Create a group for your class, or join one with a code from a classmate.</Text>
                <View style={styles.emptyStateActions}>
                  <TouchableOpacity style={styles.emptyStatePrimaryBtn} onPress={() => setIsCreateModalOpen(true)}>
                    <Ionicons name="add" size={16} color="white" />
                    <Text style={styles.emptyStatePrimaryBtnText}>Create Group</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.emptyStateSecondaryBtn} onPress={() => setIsJoinModalOpen(true)}>
                    <Text style={styles.emptyStateSecondaryBtnText}>Join with Code</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {groups.map((group) => (
              <TouchableOpacity key={group.id} style={styles.inboxRow} onPress={() => openChat(group)} activeOpacity={0.7}>
                <View style={styles.inboxAvatar}>
                  <Text style={styles.inboxAvatarText}>{group.name.substring(0, 2).toUpperCase()}</Text>
                </View>
                <View style={styles.inboxDetails}>
                  <View style={styles.inboxRowTop}>
                    <Text style={styles.inboxName} numberOfLines={1}>{group.name}</Text>
                  </View>
                  <Text style={styles.inboxPreview} numberOfLines={1}>
                    {group.members_count} {group.members_count === 1 ? 'member' : 'members'} • Tap to enter chat
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* --- MODALS --- */}

      {/* Create Group Modal */}
      <Modal visible={isCreateModalOpen} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Group</Text>
              <TouchableOpacity onPress={() => setIsCreateModalOpen(false)}><Ionicons name="close" size={24} color={COLORS.textDark} /></TouchableOpacity>
            </View>
            <TextInput style={styles.modalInput} placeholder="Group Name" placeholderTextColor="#9CA3AF" value={newGroupName} onChangeText={setNewGroupName} />
            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleCreateGroup} disabled={isSubmitting}>
              {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.modalSubmitBtnText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Join Group Modal */}
      <Modal visible={isJoinModalOpen} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Join Group</Text>
              <TouchableOpacity onPress={() => setIsJoinModalOpen(false)}><Ionicons name="close" size={24} color={COLORS.textDark} /></TouchableOpacity>
            </View>
            <TextInput style={[styles.modalInput, { textAlign: 'center', fontSize: 20, letterSpacing: 5 }]} placeholder="CODE" placeholderTextColor="#9CA3AF" autoCapitalize="characters" maxLength={6} value={joinCodeInput} onChangeText={setJoinCodeInput} />
            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleJoinGroup} disabled={isSubmitting}>
              {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.modalSubmitBtnText}>Join</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* TAKE QUIZ MODAL */}
      <Modal visible={isQuizModalOpen} animationType="slide">
        <TakeQuiz
          quizTitle={quizToTake?.title || 'Quiz'}
          questions={quizToTake?.questions || []}
          onFinish={async (score) => {
            const total = quizToTake?.questions.length ?? 0;
            const percent = total > 0 ? Math.round((score / total) * 100) : 0;

            try {
              const quizResult = await completeQuiz(score, total);

              if (quizToTake && quizToTake.levelId !== -1 && selectedCourse) {
                const levelId = quizToTake.levelId;
                const passingScore = quizToTake.passingScore;
                const passed = percent >= passingScore;

                updateLevelProgress(selectedCourse, levelId, percent);

                try {
                  await completeLesson(
                    selectedCourse.course_title,
                    levelId,
                    percent,
                    100,
                    passed,
                  );
                  if (passed) {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }
                } catch (error) {
                  console.error('Failed to persist lesson progress:', error);
                }
              }

              // Reward info is rendered inside the TakeQuiz results screen.
              return { xp: quizResult.xp, badges: quizResult.badges };
            } catch (error) {
              console.error('Failed to record quiz completion:', error);
              // Fall back to local-only progress update so unlocks still work offline.
              if (quizToTake && quizToTake.levelId !== -1 && selectedCourse) {
                updateLevelProgress(selectedCourse, quizToTake.levelId, percent);
              }
              return { xp: 0, badges: [] };
            }
          }}
          onClose={() => {
            setIsQuizModalOpen(false);
            setQuizToTake(null);
          }}
        />
      </Modal>

      {/* GENERATE COURSE MODAL */}
      <Modal visible={isGenerateLessonModalOpen} animationType="slide">
        <LessonGenerator
          onCourseGenerated={handleCourseGenerated}
          onCancel={() => setIsGenerateLessonModalOpen(false)}
        />
      </Modal>

      {/* COURSE DETAIL MODAL */}
      <Modal visible={isCourseModalOpen} animationType="slide">
        {selectedCourse && (
          <CourseDetailModal
            course={selectedCourse}
            levelProgress={levelProgress}
            onTakeQuiz={takeQuizForLevel}
            onClose={() => setIsCourseModalOpen(false)}
          />
        )}
      </Modal>

      {/* QUIZ GENERATOR MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isGenerateQuizModalOpen}
        onRequestClose={() => setIsGenerateQuizModalOpen(false)}
      >
        <View style={styles.quizGenModalOverlay}>
          <View style={styles.quizGenModalContent}>
            <View style={styles.quizGenModalHeader}>
              <Text style={styles.quizGenModalTitle}>Quiz Generator</Text>
              <TouchableOpacity onPress={() => setIsGenerateQuizModalOpen(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {isGeneratingQuiz ? (
              <View style={styles.quizGenLoadingContainer}>
                <View style={styles.quizGenLoadingIconContainer}>
                  <ActivityIndicator size="large" color={COLORS.purplePrimary} />
                  <Ionicons name="sparkles" size={24} color={COLORS.purplePrimary} style={styles.quizGenSparkleIcon} />
                </View>
                <Text style={styles.quizGenStatusTitle}>{quizGenerationStatus}</Text>
                <Text style={styles.quizGenStatusSubtitle}>SAGE AI is crafting the perfect assessment for you.</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={styles.quizGenModalForm}>
                <Text style={styles.quizGenLabel}>Selected Material</Text>
                <View style={styles.quizGenMaterialPreview}>
                  <View style={styles.quizGenMaterialIconBg}>
                    <Ionicons name={quizFile ? "document-text" : "cloud-upload-outline"} size={24} color={COLORS.purplePrimary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.quizGenMaterialName} numberOfLines={1}>
                      {quizFile ? quizFile.name : "No file selected"}
                    </Text>
                    <Text style={styles.quizGenMaterialMeta}>
                      {quizFile
                        ? `${quizFile.name.split('.').pop()?.toUpperCase() || 'FILE'} • ${quizFile.size ? (quizFile.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Unknown size'}`
                        : "Select a PDF or text file"}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.quizGenChangeBtn} onPress={pickQuizFile}>
                    <Text style={styles.quizGenChangeBtnText}>{quizFile ? "Change" : "Select"}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.quizGenLabel}>Difficulty</Text>
                <View style={styles.quizGenDifficultyRow}>
                  {['Easy', 'Medium', 'Hard'].map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.quizGenChip, quizDifficulty === d && styles.quizGenChipActive]}
                      onPress={() => setQuizDifficulty(d)}
                    >
                      <Text style={[styles.quizGenChipText, quizDifficulty === d && styles.quizGenChipTextActive]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.quizGenRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quizGenLabel}>Questions</Text>
                    <TextInput
                      style={styles.quizGenInput}
                      value={quizCount}
                      onChangeText={setQuizCount}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ width: 16 }} />
                  <View style={{ flex: 2 }}>
                    <Text style={styles.quizGenLabel}>Question Type</Text>
                    <TouchableOpacity
                      style={styles.quizGenSelector}
                      onPress={() => setIsQuizTypeDropdownOpen(!isQuizTypeDropdownOpen)}
                    >
                      <Text style={styles.quizGenSelectorText}>{quizType}</Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                    {isQuizTypeDropdownOpen && (
                      <ScrollView style={styles.quizGenDropdown} nestedScrollEnabled={true}>
                        {questionTypeOptions.map((type) => (
                          <TouchableOpacity
                            key={type}
                            style={styles.quizGenDropdownItem}
                            onPress={() => {
                              setQuizType(type);
                              setIsQuizTypeDropdownOpen(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.quizGenDropdownItemText}>{type}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </View>

                <Text style={styles.quizGenLabel}>Additional Instruction (Optional)</Text>
                <TextInput
                  style={[styles.quizGenInput, styles.quizGenTextArea]}
                  placeholder="e.g. Include more questions about Newton's Second Law"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  numberOfLines={3}
                  value={quizInstructions}
                  onChangeText={setQuizInstructions}
                />

                <TouchableOpacity
                  style={[styles.quizGenGenerateButton, isGeneratingQuiz && { opacity: 0.7 }]}
                  onPress={handleGenerateQuiz}
                  disabled={isGeneratingQuiz}
                >
                  {isGeneratingQuiz ? <ActivityIndicator color="white" /> : (
                    <>
                      <Ionicons name="sparkles" size={20} color="white" style={{ marginRight: 8 }} />
                      <Text style={styles.quizGenGenerateButtonText}>Generate Quiz</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* FAB — contextual per tab */}
      {(selectedTab === 'lessons' || selectedTab === 'quizzes') && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            if (selectedTab === 'lessons') {
              setIsGenerateLessonModalOpen(true);
            } else {
              setIsGenerateQuizModalOpen(true);
              setIsQuizTypeDropdownOpen(false);
            }
          }}
          accessibilityLabel={selectedTab === 'lessons' ? 'Generate new course' : 'Generate new quiz'}
          accessibilityRole="button"
        >
          <Ionicons name={selectedTab === 'lessons' ? 'add' : 'sparkles'} size={24} color="white" />
        </TouchableOpacity>
      )}
    </LinearGradient>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  mainWrapper: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },

  // Header with purple gradient and curved bottom
  header: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTitle: {
    color: 'white',
    fontSize: 32,
    fontFamily: FONTS.black,
    fontWeight: '900',
    letterSpacing: -2,
  },
  headerSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontFamily: FONTS.medium,
    marginTop: 4,
  },

  // Tabs with high visibility
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    paddingTop: 16,
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
  },
  tabTextActive: {
    color: COLORS.purpleDeep,
    fontFamily: FONTS.bold,
  },
  
  content: { flex: 1 },
  itemsList: { paddingBottom: 20, paddingTop: 16 },
  coursePathBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 16,
    gap: 8,
    elevation: 4,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  coursePathBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 15 },
  
  emptyStateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    borderStyle: 'dashed',
    marginTop: 20,
  },
  emptyStateIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    color: COLORS.purpleDark,
    fontSize: 16,
    fontFamily: FONTS.bold,
    marginBottom: 6,
  },
  emptyStateText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyStateActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  emptyStatePrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.purplePrimary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyStatePrimaryBtnText: {
    color: 'white',
    fontFamily: FONTS.bold,
    fontSize: 13,
  },
  emptyStateSecondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyStateSecondaryBtnText: {
    color: COLORS.purpleDeep,
    fontFamily: FONTS.semiBold,
    fontSize: 13,
  },

  card: { 
    backgroundColor: COLORS.surface, 
    borderRadius: 20, 
    padding: 20, 
    marginBottom: 16, 
    borderWidth: 1, 
    borderColor: COLORS.border,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 0 },
  colorDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  subjectBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  subjectText: { fontSize: 12, color: COLORS.textMuted, fontFamily: FONTS.semiBold, textTransform: 'uppercase' },
  cardTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 8 },
  metaInfo: { flexDirection: 'row', gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: COLORS.textMuted, fontFamily: FONTS.regular },
  statusIcon: { justifyContent: 'center', paddingLeft: 12 },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },

  badgesRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  badgePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bgSecondary },
  badgePillText: { fontSize: 10, color: COLORS.textMuted, fontFamily: FONTS.semiBold },
  takeQuizBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.purplePrimary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, gap: 6, alignSelf: 'center', shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:2}, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  takeQuizBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 13 },

  inboxContainer: { paddingTop: 8 },
  inboxActions: { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  inboxBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, paddingVertical: 12, borderRadius: 14, gap: 6, borderWidth: 1, borderColor: COLORS.border },
  inboxBtnText: { color: COLORS.purpleDeep, fontFamily: FONTS.semiBold, fontSize: 14 },
  inboxRow: { flexDirection: 'row', padding: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border, alignItems: 'center', marginHorizontal: 24, marginBottom: 12, borderRadius: 16 },
  inboxAvatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 14, backgroundColor: COLORS.purpleVibrant, shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:2}, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  inboxAvatarText: { color: 'white', fontSize: 16, fontFamily: FONTS.bold },
  inboxDetails: { flex: 1 },
  inboxRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },
  inboxName: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary, flex: 1 },
  inboxPreview: { fontSize: 13, color: COLORS.textMuted, fontFamily: FONTS.regular },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textDark },
  modalInput: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 20, fontFamily: FONTS.regular, borderWidth: 1, borderColor: COLORS.border },
  modalSubmitBtn: { padding: 16, alignItems: 'center', backgroundColor: COLORS.purplePrimary, borderRadius: 12 },
  modalSubmitBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 14 },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    zIndex: 10,
  },


  // Quiz Generator Styles (themed to shared palette)
  quizGenModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  quizGenModalContent: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    width: '100%',
    maxHeight: '90%',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  quizGenModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  quizGenModalTitle: { fontSize: 22, fontWeight: 'bold', color: COLORS.textPrimary, fontFamily: FONTS.bold },
  quizGenModalForm: { marginBottom: 10 },
  quizGenLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textMutedStrong, marginBottom: 8, marginTop: 16, fontFamily: FONTS.semiBold },
  quizGenMaterialPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quizGenMaterialIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.purpleGhost,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quizGenMaterialName: { fontSize: 15, fontWeight: '600', color: COLORS.textDark, fontFamily: FONTS.semiBold },
  quizGenMaterialMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2, fontFamily: FONTS.regular },
  quizGenChangeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  quizGenChangeBtnText: { color: COLORS.purplePrimary, fontSize: 13, fontWeight: '600', fontFamily: FONTS.semiBold },
  quizGenDifficultyRow: { flexDirection: 'row', gap: 10 },
  quizGenChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quizGenChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  quizGenChipText: { fontSize: 14, fontWeight: '500', color: COLORS.textMutedStrong, fontFamily: FONTS.medium },
  quizGenChipTextActive: { color: 'white', fontWeight: '600', fontFamily: FONTS.semiBold },
  quizGenRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  quizGenInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: COLORS.textDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontFamily: FONTS.regular,
  },
  quizGenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    height: 48,
  },
  quizGenSelectorText: { fontSize: 15, color: COLORS.textDark, fontFamily: FONTS.regular },
  quizGenTextArea: { minHeight: 80, textAlignVertical: 'top' },
  quizGenDropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 1000,
    maxHeight: 200,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  quizGenGenerateButton: {
    backgroundColor: COLORS.purplePrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 32,
    marginBottom: 20,
    elevation: 4,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  quizGenGenerateButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16, fontFamily: FONTS.bold },
  quizGenDropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSecondary,
  },
  quizGenDropdownItemText: {
    fontSize: 15,
    color: COLORS.textDark,
    fontFamily: FONTS.regular,
  },
  quizGenLoadingContainer: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  quizGenLoadingIconContainer: { position: 'relative', marginBottom: 24, width: 80, height: 80, justifyContent: 'center', alignItems: 'center' },
  quizGenSparkleIcon: { position: 'absolute', top: 0, right: 0 },
  quizGenStatusTitle: { fontSize: 20, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8, textAlign: 'center', fontFamily: FONTS.bold },
  quizGenStatusSubtitle: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', marginBottom: 32, paddingHorizontal: 20, fontFamily: FONTS.regular },
});
