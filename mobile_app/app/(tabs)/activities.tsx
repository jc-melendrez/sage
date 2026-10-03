import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
  TextInput, ActivityIndicator, Alert, Platform, StatusBar, RefreshControl,
  Pressable
} from 'react-native';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/config/api';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';
import { RateLimitError, isRateLimitError, normalizeRetryAfter } from '@/services/aiLimits';
import { apiCall } from '@/services/apiClient';
import { invalidateCachePrefix } from '@/services/apiCache';
import { completeQuiz } from '@/services/gamificationService';
import TakeQuiz from '../../components/TakeQuiz';
import QuizInfoModal from '@/components/QuizInfoModal';
import { getEnrolledCourses, joinCourseByCode, CourseSummary } from '@/services/courseService';
import { deleteQuiz, startQuizAttempt, shareQuizToGroup, updateQuiz } from '@/services/quizService';
import { notify } from '@/services/notify';
import { pickDocument, readAsBase64, describeFileError, SUPPORTED_LABEL, type PickedDocument } from '@/services/fileUpload';
import JoinCodeInput, { JOIN_CODE_LENGTH, joinCodeToString } from '@/components/JoinCodeInput';
import ModalScreenHeader from '@/components/ModalScreenHeader';
import { palette as COLORS, fontFamily as FONTS } from '@/constants/theme';
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

interface Quiz {
  id: number;
  title: string;
  created_at: string;
  quiz_type?: string;
  available_until?: string | null;
  /** How many times the current user has attempted this quiz. */
  attempt_count?: number;
  /** True when the current user wrote this quiz — such quizzes award no XP. */
  is_owner?: boolean;
  questions: any[];
}

interface EditQuestion {
  id?: number;
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

interface EditDraft {
  id: number;
  title: string;
  // No available_until: the editor does not surface a deadline, and keeping it
  // in the draft invited someone to "clear" it by blanking the textbox. Saves
  // echo editTarget's existing value instead, so removing the field cannot wipe
  // a deadline that is already set.
  questions: EditQuestion[];
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
  const [enrolledCourses, setEnrolledCourses] = useState<CourseSummary[]>([]);

  // --- Group Management Modals ---
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState<string[]>(() => Array(JOIN_CODE_LENGTH).fill(''));
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Join Class Modal (enrolled backend courses) ---
  const [isJoinCourseModalOpen, setIsJoinCourseModalOpen] = useState(false);
  const [classCodeInput, setClassCodeInput] = useState<string[]>(() => Array(JOIN_CODE_LENGTH).fill(''));
  const [isJoiningClass, setIsJoiningClass] = useState(false);


  // --- Quiz Player State ---
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [quizToTake, setQuizToTake] = useState<{ id?: number; title: string; questions: any[]; levelId: number; passingScore: number } | null>(null);
  const [isQuizStarting, setIsQuizStarting] = useState(false);

  // --- Quiz Generator State ---
  const [isGenerateQuizModalOpen, setIsGenerateQuizModalOpen] = useState(false);
  const [quizFile, setQuizFile] = useState<PickedDocument | null>(null);
  const [quizDifficulty, setQuizDifficulty] = useState('Medium');
  const [quizCount, setQuizCount] = useState('10');
  const [quizType, setQuizType] = useState('Multiple Choice');
  const [isQuizTypeDropdownOpen, setIsQuizTypeDropdownOpen] = useState(false);
  const [quizInstructions, setQuizInstructions] = useState('');
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [quizGenerationStatus, setQuizGenerationStatus] = useState('');
  const questionTypeOptions = ['Multiple Choice', 'True/False', 'Short Answer', 'Fill-in-the-Blank'];

  // --- Own-quiz share / edit ---
  // This tab only ever lists the caller's own quizzes: the backend
  // GET /ai/quizzes/ with no ?course= returns Quiz.objects.filter(user=request.user).
  // Sharing and editing therefore only ever apply to quizzes the user created,
  // never to an educator's course quizzes.
  const [shareTarget, setShareTarget] = useState<Quiz | null>(null);
  const [shareGroups, setShareGroups] = useState<{ id: string; name: string }[]>([]);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSharing, setIsSharing] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Quiz | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editOriginal, setEditOriginal] = useState<string | null>(null);
  const [editView, setEditView] = useState<'list' | 'question'>('list');
  const [editQIndex, setEditQIndex] = useState<number | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // --- 3-dots menu state ---
  const [menuQuizId, setMenuQuizId] = useState<number | null>(null);

  // --- Quiz info modal state ---
  const [infoModalQuiz, setInfoModalQuiz] = useState<Quiz | null>(null);
  // Kept alongside the quiz so the sheet can say "Retake Quiz" even after the
  // list re-sorts underneath it.
  const [infoModalAttempted, setInfoModalAttempted] = useState(false);

  // --- Rename modal state ---
  const [renameQuizId, setRenameQuizId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const handleShareQuiz = async (quiz: Quiz) => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/users/groups/mine/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load groups');
      const groups = await res.json();
      setShareGroups(groups.map((g: any) => ({ id: String(g.id), name: g.name })));
      setShareTarget(quiz);
      setIsShareOpen(true);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to load groups');
    }
  };

  const handleShareToGroup = async (groupId: string, groupName?: string) => {
    if (!shareTarget) return;
    const where = groupName ? ` to ${groupName}` : ' to the group chat.';
    try {
      setIsSharing(groupId);
      const { message } = await shareQuizToGroup(groupId, shareTarget.id);
      setIsShareOpen(false);
      notify('Shared!', `"${message}" was sent${where}`);
    } catch (err) {
      // shareQuizToGroup rethrows the server's own `error`/`detail`, so this
      // shows the real reason (not a member, no access, quiz gone) instead of
      // a blanket "please try again".
      notify('Failed to share', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsSharing(null);
    }
  };

  const openEditor = (quiz: Quiz) => {
    const draft: EditDraft = {
      id: quiz.id,
      title: quiz.title,
      questions: (quiz.questions || []).map((q) => ({
        id: q.id,
        question_text: q.question_text || '',
        options: [...(q.options || [])],
        correct_answer: q.correct_answer || '',
        explanation: q.explanation || '',
      })),
    };
    setEditTarget(quiz);
    setEditDraft(draft);
    setEditOriginal(JSON.stringify(draft));
    setEditView('list');
    setEditQIndex(null);
  };

  const closeEditor = () => {
    setEditTarget(null);
    setEditDraft(null);
    setEditOriginal(null);
    setEditView('list');
    setEditQIndex(null);
  };

  const requestCloseEditor = () => {
    if (isSavingEdit) return;
    const dirty = editOriginal !== null && editDraft && JSON.stringify(editDraft) !== editOriginal;
    if (!dirty) {
      closeEditor();
      return;
    }
    Alert.alert(
      'Unsaved Changes',
      'You have unsaved changes to this quiz. What would you like to do?',
      [
        { text: 'Don\'t Save', style: 'destructive', onPress: closeEditor },
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: () => handleSaveEdit() },
      ],
      { cancelable: true },
    );
  };

  const openQuestion = (index: number) => {
    setEditQIndex(index);
    setEditView('question');
  };

  const goToList = () => {
    setEditView('list');
    setEditQIndex(null);
  };

  const updateDraftTitle = (title: string) => setEditDraft((d) => (d ? { ...d, title } : d));

  const updateEditQuestion = (index: number, field: 'question_text' | 'correct_answer' | 'explanation', value: string) => {
    setEditDraft((d) => {
      if (!d) return d;
      const questions = d.questions.map((q, i) => (i === index ? { ...q, [field]: value } : q));
      return { ...d, questions };
    });
  };

  const updateEditOption = (qIndex: number, oIndex: number, text: string) => {
    setEditDraft((d) => {
      if (!d) return d;
      const questions = d.questions.map((q, i) => {
        if (i !== qIndex) return q;
        const options = q.options.map((opt, oi) => (oi === oIndex ? text : opt));
        const correct_answer = q.correct_answer === q.options[oIndex] ? text : q.correct_answer;
        return { ...q, options, correct_answer };
      });
      return { ...d, questions };
    });
  };

  const addEditOption = (qIndex: number) => {
    setEditDraft((d) => {
      if (!d) return d;
      const questions = d.questions.map((q, i) => (i === qIndex ? { ...q, options: [...q.options, ''] } : q));
      return { ...d, questions };
    });
  };

  const removeEditOption = (qIndex: number, oIndex: number) => {
    setEditDraft((d) => {
      if (!d) return d;
      const questions = d.questions.map((q, i) => {
        if (i !== qIndex) return q;
        const removed = q.options[oIndex];
        const options = q.options.filter((_, oi) => oi !== oIndex);
        const correct_answer = q.correct_answer === removed ? '' : q.correct_answer;
        return { ...q, options, correct_answer };
      });
      return { ...d, questions };
    });
  };

  const setEditCorrect = (qIndex: number, optionText: string) => {
    updateEditQuestion(qIndex, 'correct_answer', optionText);
  };

  const removeEditQuestion = (qIndex: number) => {
    setEditDraft((d) => {
      if (!d) return d;
      return { ...d, questions: d.questions.filter((_, i) => i !== qIndex) };
    });
  };

  const removeActiveQuestion = () => {
    if (editQIndex === null) return;
    const index = editQIndex;
    Alert.alert(
      'Delete Question',
      `Remove Question ${index + 1} from this quiz?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeEditQuestion(index);
            goToList();
          },
        },
      ],
    );
  };

  const addEditQuestion = () => {
    setEditDraft((d) => {
      if (!d) return d;
      const hasOptions = d.questions.length > 0 && d.questions[0].options.length > 0;
      return {
        ...d,
        questions: [...d.questions, { question_text: '', options: hasOptions ? ['', ''] : [], correct_answer: '', explanation: '' }],
      };
    });
    setEditQIndex((editDraft?.questions.length ?? 0));
    setEditView('question');
  };

  const handleSaveEdit = async () => {
    if (!editDraft) return;
    const title = editDraft.title.trim();
    if (!title) {
      Alert.alert('Title Required', 'Please enter a title for your quiz.');
      return;
    }
    for (let i = 0; i < editDraft.questions.length; i++) {
      const q = editDraft.questions[i];
      if (!q.question_text.trim()) {
        Alert.alert('Incomplete Question', `Question ${i + 1} needs question text.`);
        return;
      }
      if (q.options.length > 0) {
        const nonEmpty = q.options.filter((o) => o.trim());
        if (nonEmpty.length < 2) {
          Alert.alert('Incomplete Question', `Question ${i + 1} needs at least two options.`);
          return;
        }
        if (!q.correct_answer) {
          Alert.alert('Missing Correct Answer', `Pick the correct answer for Question ${i + 1}.`);
          return;
        }
      } else if (!q.correct_answer.trim()) {
        Alert.alert('Missing Answer', `Question ${i + 1} needs an answer.`);
        return;
      }
    }

    try {
      setIsSavingEdit(true);
      const updated = await updateQuiz(editDraft.id, {
        title,
        // Echoed, not cleared. The editor has no deadline field, so sending null
        // here would silently wipe a deadline the user never touched.
        available_until: editTarget?.available_until ?? null,
        questions: editDraft.questions.map((q) => ({
          id: q.id,
          question_text: q.question_text.trim(),
          options: q.options.map((o) => o.trim()).filter((o) => o !== ''),
          correct_answer: q.correct_answer,
          explanation: q.explanation.trim(),
        })),
      });
      setQuizzes((prev) => prev.map((quiz) => (quiz.id === updated.id ? { ...quiz, ...updated } : quiz)));
      invalidateCachePrefix('/ai/quizzes');
      closeEditor();
      notify('Saved', 'Your quiz was updated.');
    } catch (err) {
      notify('Save failed', err instanceof Error ? err.message : 'Could not update the quiz.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // --- 3-dots menu functions ---
  const toggleMenu = (quizId: number) => {
    setMenuQuizId(menuQuizId === quizId ? null : quizId);
  };

  const closeMenu = () => {
    setMenuQuizId(null);
  };

  // --- Rename quiz ---
  const openRenameModal = (quiz: Quiz) => {
    setRenameQuizId(quiz.id);
    setRenameTitle(quiz.title);
    closeMenu();
  };

  const handleRenameQuiz = async () => {
    if (!renameQuizId || !renameTitle.trim()) return;
    try {
      setIsRenaming(true);
      const updated = await updateQuiz(renameQuizId, { title: renameTitle.trim() });
      setQuizzes((prev) => prev.map((q) => (q.id === updated.id ? { ...q, ...updated } : q)));
      invalidateCachePrefix('/ai/quizzes');
      setRenameQuizId(null);
      setRenameTitle('');
      notify('Renamed', 'Quiz title updated.');
    } catch (err) {
      notify('Rename failed', err instanceof Error ? err.message : 'Could not rename the quiz.');
    } finally {
      setIsRenaming(false);
    }
  };

  const pickQuizFile = async () => {
    try {
      const file = await pickDocument();
      if (!file) return;
      setQuizFile(file);
    } catch (err) {
      console.error("File picker error:", err);
      Alert.alert("Unsupported file", describeFileError(err));
    }
  };

  const handleGenerateQuiz = async () => {
    if (!quizFile) {
      Alert.alert("Material Required", `Please select a study material (${SUPPORTED_LABEL}) before generating a quiz.`);
      return;
    }
    setIsGeneratingQuiz(true);
    try {
      // Honest stage-based progress: real steps only, no fabricated percentages.
      setQuizGenerationStatus("Reading file...");

      const base64Data = await readAsBase64(quizFile.uri);

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
        if (response.status === 429) {
          // The daily AI budget or the per-hour quiz burst limit. Thrown as its
          // own type so the catch below can say "later" instead of "Failed",
          // which would have the educator retry into the same refusal.
          throw new RateLimitError(
            (Array.isArray(errorData.detail) ? errorData.detail.join(' ') : errorData.detail)
              || 'Quiz limit reached. Please try again later.',
            normalizeRetryAfter(response.headers.get('Retry-After')),
          );
        }
        // A gunicorn/Cloudflare timeout answers with HTML, not JSON, so
        // errorData is empty and the educator only saw "Failed to generate
        // quiz" with no way to tell a timeout from a rejected request.
        throw new Error(
          errorData.error || errorData.detail || (
            response.status === 504
              ? "Quiz generation timed out. Please try again with fewer questions."
              : `Failed to generate quiz (HTTP ${response.status})`
          )
        );
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
      if (isRateLimitError(err)) {
        Alert.alert("AI limit", err.message);
      } else {
        Alert.alert("Generation Failed", err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setIsGeneratingQuiz(false);
      setQuizGenerationStatus('');
    }
  };

  const loadInitialData = React.useCallback(async (opts?: { isRefresh?: boolean }) => {
    const isRefresh = opts?.isRefresh ?? false;
    try {
      setLoading(!isRefresh);
      // Go through apiCall's SWR HTTP cache so both the group list and quiz
      // list paint instantly on every visit and revalidate in the background.
      // Pull-to-refresh uses `refresh`, not `noCache`: `noCache` skips the cache
      // write as well, so refreshing left the pre-refresh copy sitting in the
      // cache and the very next visit painted the stale list.
      const [groupRes, quizRes, enrolled] = await Promise.all([
        apiCall<StudyGroup[]>('/users/groups/mine/', { refresh: isRefresh }).catch(() => null),
        apiCall<Quiz[]>('/ai/quizzes/', { refresh: isRefresh }).catch(() => null),
        getEnrolledCourses().catch(() => null),
      ]);

      if (Array.isArray(groupRes)) setGroups(groupRes);
      if (Array.isArray(quizRes)) setQuizzes(quizRes);
      if (Array.isArray(enrolled)) setEnrolledCourses(enrolled);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await loadInitialData({ isRefresh: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadInitialData]);

  const handleTakeQuiz = async (quiz: Quiz) => {
    if (quiz.available_until && new Date(quiz.available_until).getTime() <= Date.now()) {
      Alert.alert('Quiz Closed', `This quiz closed on ${new Date(quiz.available_until).toLocaleString()}.`);
      return;
    }
    // Started straight from the info sheet. It used to close the sheet and
    // raise a second "Take this quiz? / Retake this quiz?" Alert on top of it,
    // which asked the student to confirm something they had just confirmed.
    // Retakes are unlimited and the server counts attempts, so there is
    // nothing to guard against here anyway.
    setIsQuizStarting(true);
    try {
      await startQuizAttempt(quiz.id);
      setQuizToTake({
        id: quiz.id,
        title: quiz.title,
        questions: quiz.questions.map((q: any) => ({
          id: q.id,
          question: q.question_text,
          type: (quiz.quiz_type || 'Multiple Choice') as any,
          options: q.options,
          correct_answer: q.correct_answer,
          // The model already writes an explanation per question and the
          // serializer already returns it; the mapping threw it away, so the
          // end-of-quiz review had nothing to explain the answers with.
          explanation: q.explanation ?? '',
        })),
        levelId: -1,
        passingScore: 0,
      });
      setInfoModalQuiz(null);
      setIsQuizModalOpen(true);
    } catch (err) {
      Alert.alert(
        'Cannot Take Quiz',
        err instanceof Error ? err.message : 'This quiz is no longer available.',
      );
    } finally {
      setIsQuizStarting(false);
    }
  };

  const handleDeleteQuiz = (quiz: Quiz) => {
    Alert.alert(
      'Delete quiz',
      `"${quiz.title}" will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteQuiz(quiz.id);
              setQuizzes((prev) => prev.filter((q) => q.id !== quiz.id));
              // The row disappeared with no confirmation at all, so a
              // successful delete looked like the tap had done nothing.
              notify('Quiz deleted', `"${quiz.title}" was removed.`);
            } catch (err) {
              notify('Delete failed', err instanceof Error ? err.message : 'Could not delete the quiz.');
            }
          },
        },
      ],
    );
  };

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
        invalidateCachePrefix('/users/groups/mine');
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
    const code = joinCodeToString(joinCodeInput);
    if (code.length !== JOIN_CODE_LENGTH) {
      Alert.alert(
        'Code Required',
        `Please enter the ${JOIN_CODE_LENGTH}-character join code. You've entered ${code.length}.`,
      );
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
        const data = await res.json().catch(() => ({}));
        setJoinCodeInput(Array(JOIN_CODE_LENGTH).fill(''));
        setIsJoinModalOpen(false);
        if (data?.status === 'pending') {
          Alert.alert('Request Sent', data.message || 'The group admin will approve your join request.');
        } else {
          invalidateCachePrefix('/users/groups/mine');
          loadInitialData();
        }
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

  const handleJoinClass = async () => {
    const code = joinCodeToString(classCodeInput);
    if (code.length !== JOIN_CODE_LENGTH) {
      Alert.alert(
        'Code Required',
        `Please enter the ${JOIN_CODE_LENGTH}-character join code shared by your educator. You've entered ${code.length}.`,
      );
      return;
    }
    try {
      setIsJoiningClass(true);
      await joinCourseByCode(code);
      setClassCodeInput(Array(JOIN_CODE_LENGTH).fill(''));
      setIsJoinCourseModalOpen(false);
      await loadInitialData({ isRefresh: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could Not Join Class', err instanceof Error ? err.message : 'Invalid join code.');
    } finally {
      setIsJoiningClass(false);
    }
  };

  const handleSelectTab = (tab: 'lessons' | 'quizzes' | 'groups') => {
    if (tab === selectedTab) return;
    Haptics.selectionAsync();
    setSelectedTab(tab);
  };


  // --- MAIN TABS VIEW ---
  return (
    <LinearGradient
      colors={['#FFFFFF', '#FFFFFF']}
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
            {/* MY CLASSES — educator-created, joined via code */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Classes</Text>
              <TouchableOpacity
                style={styles.sectionAction}
                onPress={() => setIsJoinCourseModalOpen(true)}
                accessibilityLabel="Join a class with a code"
              >
                <Ionicons name="add" size={16} color={COLORS.purpleDeep} />
                <Text style={styles.sectionActionText}>Join</Text>
              </TouchableOpacity>
            </View>
            {enrolledCourses.map((course) => (
              <TouchableOpacity
                key={course.id}
                style={styles.classCard}
                activeOpacity={0.7}
                onPress={() => router.push(`/course/${course.id}` as any)}
              >
                <View style={styles.classIconBox}>
                  <Ionicons name="school-outline" size={20} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.classTitle} numberOfLines={2}>{course.name}</Text>
                  <Text style={styles.classMeta} numberOfLines={1}>
                    {course.educator?.display_name || 'Educator'} · {course.student_count} {course.student_count === 1 ? 'student' : 'students'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
            {enrolledCourses.length === 0 && (
              <Text style={styles.sectionEmptyText}>
                No classes yet. Join with a code from your educator.
              </Text>
            )}
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
                <TouchableOpacity
                  style={styles.quizCardPress}
                  onPress={() => {
                    // Don't open the info sheet while the 3-dots menu is up.
                    if (menuQuizId !== null) return;
                    closeMenu();
                    setInfoModalAttempted((quiz.attempt_count ?? 0) > 0);
                    setInfoModalQuiz(quiz);
                  }}
                  activeOpacity={0.9}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgesRow}>
                      <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.questions?.length || 0} Qs</Text></View>
                      {quiz.quiz_type && <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.quiz_type}</Text></View>}
                    </View>
                    <Text style={styles.cardTitle}>{quiz.title}</Text>
                    <Text style={styles.metaText}>Created {new Date(quiz.created_at).toLocaleDateString()}</Text>
                    {quiz.available_until && (
                      <Text style={styles.metaText}>
                        {new Date(quiz.available_until).getTime() <= Date.now()
                          ? `Closed ${new Date(quiz.available_until).toLocaleString()}`
                          : `Closes ${new Date(quiz.available_until).toLocaleString()}`}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.menuBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      toggleMenu(quiz.id);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={22} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </TouchableOpacity>
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
        <KeyboardSafeView style={styles.modalOverlay}>
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
        </KeyboardSafeView>
      </Modal>

      {/* Join Group Modal */}
      <Modal visible={isJoinModalOpen} animationType="fade" transparent={true}>
        <View style={styles.joinOverlay}>
          <KeyboardSafeView
            style={styles.joinKeyboardWrap}
          >
            <View style={[styles.modalContent, styles.joinModalCard]}>
              <TouchableOpacity style={styles.closeInviteBtn} onPress={() => { if (!isSubmitting) setIsJoinModalOpen(false); }}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
              <Text style={styles.joinModalTitle}>JOIN GROUP</Text>
              <Text style={styles.joinModalSub}>Enter the code your classmate shared to join their study group.</Text>
              <JoinCodeInput
                slots={joinCodeInput}
                onChange={setJoinCodeInput}
                editable={!isSubmitting}
                containerStyle={styles.codeBoxes}
                boxStyle={styles.codeBox}
                filledBoxStyle={styles.codeBoxFilled}
                accessibilityLabel="Group code"
              />
              <TouchableOpacity
                style={[styles.joinSubmitBtn, isSubmitting && { opacity: 0.7 }]}
                onPress={handleJoinGroup}
                disabled={isSubmitting}
              >
                {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.joinSubmitBtnText}>Join Group</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardSafeView>
        </View>
      </Modal>

      {/* Join Class Modal (educator courses) */}
      <Modal visible={isJoinCourseModalOpen} animationType="fade" transparent={true}>
        <View style={styles.joinOverlay}>
          <KeyboardSafeView
            style={styles.joinKeyboardWrap}
          >
            <View style={[styles.modalContent, styles.joinModalCard]}>
              <TouchableOpacity style={styles.closeInviteBtn} onPress={() => { if (!isJoiningClass) setIsJoinCourseModalOpen(false); }}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
              <Text style={styles.joinModalTitle}>JOIN CLASS</Text>
              <Text style={styles.joinModalSub}>Enter the 6-character join code shared by your educator.</Text>
              <JoinCodeInput
                slots={classCodeInput}
                onChange={setClassCodeInput}
                editable={!isJoiningClass}
                containerStyle={styles.codeBoxes}
                boxStyle={styles.codeBox}
                filledBoxStyle={styles.codeBoxFilled}
                accessibilityLabel="Class code"
              />
              <TouchableOpacity
                style={[styles.joinSubmitBtn, isJoiningClass && { opacity: 0.7 }]}
                onPress={handleJoinClass}
                disabled={isJoiningClass}
              >
                {isJoiningClass ? <ActivityIndicator color="white" /> : <Text style={styles.joinSubmitBtnText}>Join Class</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardSafeView>
        </View>
      </Modal>

      {/* TAKE QUIZ MODAL */}
      <Modal visible={isQuizModalOpen} animationType="slide">
        <TakeQuiz
          quizTitle={quizToTake?.title || 'Quiz'}
          questions={quizToTake?.questions || []}
          onFinish={async (score) => {
            const total = quizToTake?.questions.length ?? 0;
            // No try/catch: completeQuiz already raises a message describing
            // what went wrong, and swallowing it into `{ xp: 0 }` reported a
            // failed save as a successful one with no XP.
            const quizResult = await completeQuiz(score, total, undefined, quizToTake?.id);
            return { xp: quizResult.xp, badges: quizResult.badges };
          }}
          onFinishError={(message) => {
            // The quiz stays open so the attempt is not lost, and the student
            // can retry the save.
            Alert.alert("Couldn't save your result", message);
          }}
          onClose={() => {
            setIsQuizModalOpen(false);
            setQuizToTake(null);
            loadInitialData({ isRefresh: true });
          }}
        />
      </Modal>

      {/* QUIZ GENERATOR MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isGenerateQuizModalOpen}
        onRequestClose={() => setIsGenerateQuizModalOpen(false)}
      >
        <KeyboardSafeView style={styles.quizGenModalOverlay}>
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
                        : `Select a ${SUPPORTED_LABEL} file`}
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
        </KeyboardSafeView>
      </Modal>

      {/* Share own quiz to a study group */}
      <Modal
        visible={isShareOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsShareOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardSafeView
            style={styles.shareSheet}
          >
            <View style={styles.shareSheetHeader}>
              <Text style={styles.shareSheetTitle}>Share Quiz</Text>
              <TouchableOpacity onPress={() => setIsShareOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.shareSheetSubtitle} numberOfLines={1}>
              {shareTarget ? `Send "${shareTarget.title}" to a study group` : ''}
            </Text>
            {shareGroups.length === 0 ? (
              <View style={styles.shareSheetEmpty}>
                <Ionicons name="people-outline" size={32} color={COLORS.textMuted} />
                <Text style={styles.shareSheetEmptyText}>No study groups yet</Text>
                <Text style={styles.shareSheetEmptySub}>Create or join a group on the Groups tab first.</Text>
              </View>
            ) : (
              <ScrollView style={styles.shareGroupList} contentContainerStyle={{ gap: 8 }}>
                {shareGroups.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.shareGroupItem}
                    onPress={() => handleShareToGroup(g.id, g.name)}
                    disabled={isSharing !== null}
                    activeOpacity={0.7}
                  >
                    <View style={styles.shareGroupIcon}>
                      <Ionicons name="people-outline" size={18} color={COLORS.purpleVibrant} />
                    </View>
                    <Text style={styles.shareGroupName} numberOfLines={1}>{g.name}</Text>
                    {isSharing === g.id ? (
                      <ActivityIndicator size="small" color={COLORS.purpleVibrant} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </KeyboardSafeView>
        </View>
      </Modal>

      {/* Edit own quiz — question list + per-question editor */}
      <Modal
        visible={editTarget !== null}
        animationType="slide"
        onRequestClose={requestCloseEditor}
      >
        <KeyboardSafeView style={styles.editorRoot}>
          <View style={styles.editorCard}>
            {editView === 'list' ? (
              <ModalScreenHeader
                title="Edit Quiz"
                backgroundColor={COLORS.surface}
                borderColor={COLORS.border}
                titleStyle={styles.editorHeaderTitle}
                left={
                  <TouchableOpacity onPress={requestCloseEditor} style={styles.editorHeaderBtn} disabled={isSavingEdit}>
                    <Ionicons name="close" size={24} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                }
                right={
                  <TouchableOpacity
                    style={[styles.editorSaveBtn, isSavingEdit && { opacity: 0.6 }]}
                    onPress={handleSaveEdit}
                    disabled={isSavingEdit}
                  >
                    {isSavingEdit ? <ActivityIndicator size="small" color="white" /> : <Text style={styles.editorSaveText}>Save</Text>}
                  </TouchableOpacity>
                }
              />
            ) : (
              <ModalScreenHeader
                title={editQIndex !== null ? `Question ${editQIndex + 1}` : 'Question'}
                backgroundColor={COLORS.surface}
                borderColor={COLORS.border}
                titleStyle={styles.editorHeaderTitle}
                left={
                  <TouchableOpacity onPress={goToList} style={styles.editorHeaderBtn} disabled={isSavingEdit}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                }
                right={
                  <TouchableOpacity onPress={removeActiveQuestion} style={styles.editorHeaderBtn} disabled={isSavingEdit}>
                    <Ionicons name="trash-outline" size={22} color={COLORS.danger} />
                  </TouchableOpacity>
                }
              />
            )}

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
              {editDraft && editView === 'list' && (
                <>
                  <Text style={styles.editorLabel}>Quiz Title</Text>
                  <TextInput
                    style={styles.editorTitleInput}
                    value={editDraft.title}
                    onChangeText={updateDraftTitle}
                    placeholder="Quiz title"
                    placeholderTextColor={COLORS.textMuted}
                    editable={!isSavingEdit}
                  />

                  <Text style={styles.editorMeta}>
                    {editDraft.questions.length} {editDraft.questions.length === 1 ? 'question' : 'questions'} · {editTarget?.quiz_type || 'quiz'} · Tap a question to edit it
                  </Text>

                  {editDraft.questions.length === 0 && (
                    <View style={styles.editorEmpty}>
                      <Ionicons name="help-circle-outline" size={40} color={COLORS.textMuted} />
                      <Text style={styles.editorEmptyText}>No questions yet — tap {"\u201CAdd Question\u201D"} below.</Text>
                    </View>
                  )}

                  {editDraft.questions.map((question, qIndex) => (
                    <TouchableOpacity
                      key={question.id ?? `new-${qIndex}`}
                      style={styles.questionRow}
                      onPress={() => openQuestion(qIndex)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.questionRowNum}>
                        <Text style={styles.questionRowNumText}>{qIndex + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.questionRowText} numberOfLines={2}>
                          {question.question_text.trim() || 'Untitled question'}
                        </Text>
                        <Text style={styles.questionRowMeta} numberOfLines={1}>
                          Answer: {question.correct_answer.trim() || 'not set'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity style={styles.addQuestionBtn} onPress={addEditQuestion} disabled={isSavingEdit}>
                    <Ionicons name="add-circle-outline" size={18} color={COLORS.purplePrimary} />
                    <Text style={styles.addQuestionText}>Add Question</Text>
                  </TouchableOpacity>
                </>
              )}

              {editDraft && editView === 'question' && editQIndex !== null && editDraft.questions[editQIndex] && (
                (() => {
                  const question = editDraft.questions[editQIndex];
                  const qIndex = editQIndex;
                  return (
                    <>
                      <Text style={styles.editorLabel}>Question</Text>
                      <TextInput
                        style={[styles.editorInput, styles.questionTextInput]}
                        value={question.question_text}
                        onChangeText={(text) => updateEditQuestion(qIndex, 'question_text', text)}
                        placeholder="Enter the question"
                        placeholderTextColor={COLORS.textMuted}
                        multiline
                        editable={!isSavingEdit}
                      />

                      {question.options.length > 0 ? (
                        <>
                          <Text style={styles.editorLabel}>Options</Text>
                          {question.options.map((option, oIndex) => {
                            const isCorrect = option === question.correct_answer && !!option;
                            return (
                              <View key={oIndex} style={styles.optionRow}>
                                <TouchableOpacity onPress={() => setEditCorrect(qIndex, option)} style={styles.optionCheck}>
                                  <Ionicons
                                    name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                                    size={20}
                                    color={isCorrect ? COLORS.success : COLORS.textMuted}
                                  />
                                </TouchableOpacity>
                                <TextInput
                                  style={styles.optionInput}
                                  value={option}
                                  onChangeText={(text) => updateEditOption(qIndex, oIndex, text)}
                                  placeholder={`Option ${oIndex + 1}`}
                                  placeholderTextColor={COLORS.textMuted}
                                  editable={!isSavingEdit}
                                />
                                <TouchableOpacity onPress={() => removeEditOption(qIndex, oIndex)} style={styles.optionRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                  <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                          <TouchableOpacity style={styles.addOptionBtn} onPress={() => addEditOption(qIndex)} disabled={isSavingEdit}>
                            <Ionicons name="add" size={16} color={COLORS.purplePrimary} />
                            <Text style={styles.addOptionText}>Add Option</Text>
                          </TouchableOpacity>
                          <Text style={styles.editorHint}>Tap the circle next to an option to mark it as the correct answer.</Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.editorLabel}>Answer</Text>
                          <TextInput
                            style={styles.editorInput}
                            value={question.correct_answer}
                            onChangeText={(text) => updateEditQuestion(qIndex, 'correct_answer', text)}
                            placeholder="Enter the correct answer"
                            placeholderTextColor={COLORS.textMuted}
                            editable={!isSavingEdit}
                          />
                        </>
                      )}

                      <Text style={styles.editorLabel}>Explanation (Optional)</Text>
                      <TextInput
                        style={[styles.editorInput, styles.explanationInput]}
                        value={question.explanation}
                        onChangeText={(text) => updateEditQuestion(qIndex, 'explanation', text)}
                        placeholder="Brief explanation why"
                        placeholderTextColor={COLORS.textMuted}
                        multiline
                        editable={!isSavingEdit}
                      />

                      <TouchableOpacity style={styles.qDoneBtn} onPress={goToList} disabled={isSavingEdit}>
                        <Ionicons name="checkmark" size={18} color="white" />
                        <Text style={styles.qDoneBtnText}>Done</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()
              )}
            </ScrollView>
          </View>
        </KeyboardSafeView>
      </Modal>

      {/* Quiz Info — in-tree overlay (a nested <Modal> would be dropped on Android) */}
      <QuizInfoModal
        quiz={infoModalQuiz}
        attempted={infoModalAttempted}
        starting={isQuizStarting}
        onClose={() => setInfoModalQuiz(null)}
        onStart={() => { const q = infoModalQuiz; if (q) handleTakeQuiz(q); }}
      />

      {/* Quiz 3-dots menu — in-tree overlay (Rename / Edit / Share / Delete) */}
      {menuQuizId !== null && (() => {
        const quiz = quizzes.find((q) => q.id === menuQuizId);
        if (!quiz) return null;
        return (
          <Pressable style={styles.menuSheetOverlay} onPress={closeMenu}>
            <Pressable style={styles.menuSheetCard} onPress={() => {}}>
              <Text style={styles.menuSheetTitle} numberOfLines={2}>{quiz.title}</Text>
              <TouchableOpacity style={styles.menuSheetRow} onPress={() => { closeMenu(); openRenameModal(quiz); }} activeOpacity={0.7}>
                <Ionicons name="pencil-outline" size={20} color={COLORS.textPrimary} style={styles.menuSheetIcon} />
                <Text style={styles.menuSheetRowText}>Rename</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuSheetRow} onPress={() => { closeMenu(); openEditor(quiz); }} activeOpacity={0.7}>
                <Ionicons name="create-outline" size={20} color={COLORS.purpleVibrant} style={styles.menuSheetIcon} />
                <Text style={styles.menuSheetRowText}>Edit questions</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuSheetRow} onPress={() => { closeMenu(); handleShareQuiz(quiz); }} activeOpacity={0.7}>
                <Ionicons name="share-outline" size={20} color={COLORS.purpleVibrant} style={styles.menuSheetIcon} />
                <Text style={styles.menuSheetRowText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.menuSheetRow, styles.menuSheetDanger]} onPress={() => { closeMenu(); handleDeleteQuiz(quiz); }} activeOpacity={0.7}>
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} style={styles.menuSheetIcon} />
                <Text style={[styles.menuSheetRowText, { color: COLORS.danger }]}>Delete</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        );
      })()}

      {/* Rename Quiz Modal */}
      <Modal
        visible={renameQuizId !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => { setRenameQuizId(null); setRenameTitle(''); }}
      >
        <KeyboardSafeView style={styles.renameModalOverlay}>
          <View style={styles.renameModalContent}>
            <Text style={styles.renameModalTitle}>Rename Quiz</Text>
            <TextInput
              style={styles.renameModalInput}
              value={renameTitle}
              onChangeText={setRenameTitle}
              placeholder="Quiz title"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
            />
            <View style={styles.renameModalActions}>
              <TouchableOpacity style={styles.renameModalCancel} onPress={() => { setRenameQuizId(null); setRenameTitle(''); }}>
                <Text style={styles.renameModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameModalConfirm, isRenaming && { opacity: 0.7 }]} onPress={handleRenameQuiz} disabled={isRenaming}>
                {isRenaming ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.renameModalConfirmText}>Rename</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardSafeView>
      </Modal>

      {/* FAB — contextual per tab (not on Courses; students join instead of creating) */}
      {selectedTab === 'quizzes' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            setIsGenerateQuizModalOpen(true);
            setIsQuizTypeDropdownOpen(false);
          }}
          accessibilityLabel='Generate new quiz'
          accessibilityRole="button"
        >
          <Ionicons name='sparkles' size={24} color="white" />
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

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionSpacing: { marginHorizontal: 24, marginBottom: 12 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  sectionActionText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.purpleDeep },
  sectionEmptyText: { marginHorizontal: 24, marginBottom: 16, fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, fontStyle: 'italic' },

  classCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, marginHorizontal: 24, marginBottom: 12, padding: 16, gap: 12, shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  classIconBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: COLORS.purpleVibrant, justifyContent: 'center', alignItems: 'center' },
  classTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 3 },
  classMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  
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
    position: 'relative',
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  quizCardPress: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  quizCardActions: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  quizCardIconBtn: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  menuBtn: { padding: 8 },
  // Absolute, not flex:1. The screen root is a column, so a flex child here
  // would split the height with the list and squash it into the top half.
  menuSheetOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
    zIndex: 20,
    elevation: 20,
  },
  menuSheetCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 8,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  menuSheetTitle: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    color: COLORS.textMutedStrong,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 4,
  },
  menuSheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12 },
  menuSheetIcon: { width: 24 },
  menuSheetRowText: { fontSize: 15, fontFamily: FONTS.medium, fontWeight: '600', color: COLORS.textPrimary },
  menuSheetDanger: { marginTop: 4, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 16 },

  // Quiz info modal
  infoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  infoModalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  infoModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  infoModalBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  closeBtn: { padding: 4 },
  infoModalTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 16 },
  infoModalMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  infoModalMetaText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, flexShrink: 1 },
  infoModalStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  infoModalStartBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 15 },

  // Quiz editor (Edit own quiz)
  editorRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  // Centred and height-bounded so the header (X + Save) is always on screen and
  // a long quiz scrolls inside the card instead of pushing the header out of
  // the modal. flexShrink lets the ScrollView yield height to the header.
  editorCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    flexShrink: 1,
    backgroundColor: COLORS.bg,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editorHeaderBtn: { padding: 6 },
  editorHeaderTitle: { fontFamily: FONTS.bold, color: COLORS.textPrimary },
  editorSaveBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  editorSaveText: { color: 'white', fontFamily: FONTS.bold, fontSize: 14 },
  editorContent: { padding: 20, paddingBottom: 48 },
  editorLabel: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.textMutedStrong,
    marginTop: 14,
    marginBottom: 6,
  },
  editorInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
  },
  editorTitleInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  editorMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 10, fontFamily: FONTS.regular, lineHeight: 17 },
  editorHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 8, fontFamily: FONTS.regular, lineHeight: 17 },
  editorEmpty: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  editorEmptyText: { fontSize: 13, color: COLORS.textMuted, fontFamily: FONTS.regular },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 10,
  },
  questionRowNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionRowNumText: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.purplePrimary },
  questionRowText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  questionRowMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 3, fontFamily: FONTS.regular },
  questionTextInput: { minHeight: 60, textAlignVertical: 'top' },
  qDoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 22,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  qDoneBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 15 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  optionCheck: { padding: 4 },
  optionInput: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
  },
  optionRemove: { padding: 4 },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, alignSelf: 'flex-start' },
  addOptionText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.purplePrimary },
  explanationInput: { minHeight: 70, textAlignVertical: 'top' },
  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.purpleLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addQuestionText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.purplePrimary },

  // Rename modal
  renameModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  renameModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  renameModalTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 16, textAlign: 'center' },
  renameModalInput: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  renameModalActions: { flexDirection: 'row', gap: 12 },
  renameModalCancel: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  renameModalCancelText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textSecondary },
  renameModalConfirm: {
    flex: 1,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  renameModalConfirmText: { fontSize: 14, fontFamily: FONTS.bold, color: 'white' },

  shareSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  shareSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shareSheetTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  shareSheetSubtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 6, marginBottom: 16 },
  shareSheetHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 8, lineHeight: 17 },
  shareSheetEmpty: { alignItems: 'center', paddingVertical: 40 },
  shareSheetEmptyText: { fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.textSecondary, marginTop: 12 },
  shareSheetEmptySub: { fontSize: 13, color: COLORS.textMuted, marginTop: 4, textAlign: 'center', paddingHorizontal: 20 },
  shareGroupList: { maxHeight: 340 },
  shareGroupItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: COLORS.bg, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  shareGroupIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
  },
  shareGroupName: { flex: 1, fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textPrimary },
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
  joinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
  joinKeyboardWrap: { width: '100%', alignItems: 'center' },
  joinModalCard: { width: '90%', alignSelf: 'center', alignItems: 'center', position: 'relative', borderWidth: 0 },
  closeInviteBtn: { position: 'absolute', top: 16, right: 16, padding: 4, zIndex: 10 },
  joinModalTitle: { fontSize: 20, fontFamily: FONTS.black, color: COLORS.purpleDeep, marginBottom: 6 },
  joinModalSub: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center', marginBottom: 24 },
  codeBoxes: { marginBottom: 24 },
  codeBox: {
    width: 40,
    height: 50,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
    backgroundColor: COLORS.bgSecondary,
    color: COLORS.purpleDark,
    fontSize: 24,
    fontFamily: FONTS.black,
    textAlign: 'center',
    paddingVertical: 0,
  },
  codeBoxFilled: { borderColor: COLORS.success, backgroundColor: 'white' },
  joinSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
  },
  joinSubmitBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 14 },
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
