import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
  TextInput, ActivityIndicator, Alert, Platform, StatusBar, RefreshControl,
  KeyboardAvoidingView, Pressable
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/config/api';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';
import { apiCall } from '@/services/apiClient';
import { invalidateCachePrefix } from '@/services/apiCache';
import { completeQuiz } from '@/services/gamificationService';
import TakeQuiz from '../../components/TakeQuiz';
import { getEnrolledCourses, joinCourseByCode, CourseSummary } from '@/services/courseService';
import { deleteQuiz, startQuizAttempt, getQuizShare, updateQuiz, parseDeadlineInput } from '@/services/quizService';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
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
  attempted?: boolean;
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
  available_until: string;
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
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Join Class Modal (enrolled backend courses) ---
  const [isJoinCourseModalOpen, setIsJoinCourseModalOpen] = useState(false);
  const [classCodeInput, setClassCodeInput] = useState('');
  const [isJoiningClass, setIsJoiningClass] = useState(false);

  const groupCodeRefs = useRef<any[]>([]);
  const classCodeRefs = useRef<any[]>([]);

  // --- Quiz Player State ---
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [quizToTake, setQuizToTake] = useState<{ id?: number; title: string; questions: any[]; levelId: number; passingScore: number } | null>(null);
  const [isQuizStarting, setIsQuizStarting] = useState(false);

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

  const handleShareToGroup = async (groupId: string) => {
    if (!shareTarget) return;
    try {
      setIsSharing(groupId);
      const shareData = await getQuizShare(shareTarget.id);
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: `📝 Quiz Shared: "${shareData.title}"`,
          attachments: [{
            type: 'quiz_embed',
            quiz_id: shareData.id,
            title: shareData.title,
            question_count: shareData.question_count,
            quiz_type: shareData.quiz_type,
            deep_link: shareData.deep_link,
          }],
        }),
      });
      if (!res.ok) throw new Error('Could not send to that group');
      setIsShareOpen(false);
      Alert.alert('Shared!', `"${shareData.title}" was sent to the group chat.`);
    } catch (err) {
      Alert.alert('Failed to share', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsSharing(null);
    }
  };

  const openEditor = (quiz: Quiz) => {
    const draft: EditDraft = {
      id: quiz.id,
      title: quiz.title,
      available_until: quiz.available_until
        ? new Date(quiz.available_until).toISOString().slice(0, 16).replace('T', ' ')
        : '',
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

  const updateDraftDeadline = (text: string) => setEditDraft((d) => (d ? { ...d, available_until: text } : d));

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

    let available_until: string | null = null;
    if (editDraft.available_until.trim()) {
      const parsed = parseDeadlineInput(editDraft.available_until);
      if (!parsed) {
        Alert.alert('Invalid Deadline', 'Enter the deadline as YYYY-MM-DD HH:MM (24-hour), or leave it blank.');
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        Alert.alert('Invalid Deadline', 'The deadline must be in the future.');
        return;
      }
      available_until = parsed.toISOString();
    }

    try {
      setIsSavingEdit(true);
      const updated = await updateQuiz(editDraft.id, {
        title,
        available_until,
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
      Alert.alert('Saved', 'Your quiz was updated.');
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Could not update the quiz.');
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
      Alert.alert('Renamed', 'Quiz title updated.');
    } catch (err) {
      Alert.alert('Rename failed', err instanceof Error ? err.message : 'Could not rename the quiz.');
    } finally {
      setIsRenaming(false);
    }
  };

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

  const loadInitialData = React.useCallback(async (opts?: { isRefresh?: boolean }) => {
    const isRefresh = opts?.isRefresh ?? false;
    try {
      setLoading(!isRefresh);
      // Go through apiCall's SWR HTTP cache so both the group list and quiz
      // list paint instantly on every visit and revalidate in the background.
      // Pull-to-refresh bypasses the cache for a true network hit.
      const [groupRes, quizRes, enrolled] = await Promise.all([
        apiCall<StudyGroup[]>('/users/groups/mine/', { noCache: isRefresh }).catch(() => null),
        apiCall<Quiz[]>('/ai/quizzes/', { noCache: isRefresh }).catch(() => null),
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

  const handleTakeQuiz = (quiz: Quiz) => {
    if (quiz.attempted) {
      Alert.alert('Already Taken', 'You already took this quiz. Each quiz can only be taken once.');
      return;
    }
    if (quiz.available_until && new Date(quiz.available_until).getTime() <= Date.now()) {
      Alert.alert('Quiz Closed', `This quiz closed on ${new Date(quiz.available_until).toLocaleString()}.`);
      return;
    }
    Alert.alert(
      'Take this quiz?',
      `You can only take "${quiz.title}" once.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
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
                })),
                levelId: -1,
                passingScore: 0,
              });
              setIsQuizModalOpen(true);
            } catch (err) {
              Alert.alert(
                'Cannot Take Quiz',
                err instanceof Error ? err.message : 'This quiz is no longer available.',
              );
            } finally {
              setIsQuizStarting(false);
            }
          },
        },
      ],
    );
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
            } catch (err) {
              Alert.alert('Delete failed', err instanceof Error ? err.message : 'Could not delete the quiz.');
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
        const data = await res.json().catch(() => ({}));
        setJoinCodeInput('');
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
    const code = classCodeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert('Code Required', 'Please enter the join code shared by your educator.');
      return;
    }
    try {
      setIsJoiningClass(true);
      await joinCourseByCode(code);
      setClassCodeInput('');
      setIsJoinCourseModalOpen(false);
      await loadInitialData({ isRefresh: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could Not Join Class', err instanceof Error ? err.message : 'Invalid join code.');
    } finally {
      setIsJoiningClass(false);
    }
  };

  const handleGroupCodeChange = (t: string, i: number) => {
    const char = t.slice(-1).toUpperCase();
    const next = joinCodeInput.split('').slice(0, 6);
    while (next.length < i) next.push('');
    if (!char) {
      next[i] = '';
      if (i > 0) next[i - 1] = '';
    } else {
      next[i] = char;
    }
    setJoinCodeInput(next.join('').slice(0, 6));
    if (char && i < 5) groupCodeRefs.current[i + 1]?.focus();
    else if (!char && i > 0) groupCodeRefs.current[i - 1]?.focus();
  };
  const handleGroupCodeKeyPress = (e: any, i: number) => {
    if (e.nativeEvent.key === 'Backspace' && !joinCodeInput[i] && i > 0) {
      const next = joinCodeInput.split('');
      next[i - 1] = '';
      setJoinCodeInput(next.join(''));
      groupCodeRefs.current[i - 1]?.focus();
    }
  };
  const handleClassCodeChange = (t: string, i: number) => {
    const char = t.slice(-1).toUpperCase();
    const next = classCodeInput.split('').slice(0, 6);
    while (next.length < i) next.push('');
    if (!char) {
      next[i] = '';
      if (i > 0) next[i - 1] = '';
    } else {
      next[i] = char;
    }
    setClassCodeInput(next.join('').slice(0, 6));
    if (char && i < 5) classCodeRefs.current[i + 1]?.focus();
    else if (!char && i > 0) classCodeRefs.current[i - 1]?.focus();
  };
  const handleClassCodeKeyPress = (e: any, i: number) => {
    if (e.nativeEvent.key === 'Backspace' && !classCodeInput[i] && i > 0) {
      const next = classCodeInput.split('');
      next[i - 1] = '';
      setClassCodeInput(next.join(''));
      classCodeRefs.current[i - 1]?.focus();
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
                  onPress={() => { closeMenu(); setInfoModalQuiz(quiz); }}
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Join Group Modal */}
      <Modal visible={isJoinModalOpen} animationType="fade" transparent={true}>
        <View style={styles.joinOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.joinKeyboardWrap}
          >
            <View style={[styles.modalContent, styles.joinModalCard]}>
              <TouchableOpacity style={styles.closeInviteBtn} onPress={() => { if (!isSubmitting) setIsJoinModalOpen(false); }}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
              <Text style={styles.joinModalTitle}>JOIN GROUP</Text>
              <Text style={styles.joinModalSub}>Enter the code your classmate shared to join their study group.</Text>
              <View style={styles.codeBoxes}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => { groupCodeRefs.current[i] = r; }}
                    style={[styles.codeBox, joinCodeInput[i] ? styles.codeBoxFilled : null]}
                    value={joinCodeInput[i] || ''}
                    onChangeText={(t) => handleGroupCodeChange(t, i)}
                    onKeyPress={(e) => handleGroupCodeKeyPress(e, i)}
                    maxLength={1}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!isSubmitting}
                  />
                ))}
              </View>
              <TouchableOpacity
                style={[styles.joinSubmitBtn, isSubmitting && { opacity: 0.7 }]}
                onPress={handleJoinGroup}
                disabled={isSubmitting}
              >
                {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={styles.joinSubmitBtnText}>Join Group</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Join Class Modal (educator courses) */}
      <Modal visible={isJoinCourseModalOpen} animationType="fade" transparent={true}>
        <View style={styles.joinOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.joinKeyboardWrap}
          >
            <View style={[styles.modalContent, styles.joinModalCard]}>
              <TouchableOpacity style={styles.closeInviteBtn} onPress={() => { if (!isJoiningClass) setIsJoinCourseModalOpen(false); }}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
              <Text style={styles.joinModalTitle}>JOIN CLASS</Text>
              <Text style={styles.joinModalSub}>Enter the 6-character join code shared by your educator.</Text>
              <View style={styles.codeBoxes}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => { classCodeRefs.current[i] = r; }}
                    style={[styles.codeBox, classCodeInput[i] ? styles.codeBoxFilled : null]}
                    value={classCodeInput[i] || ''}
                    onChangeText={(t) => handleClassCodeChange(t, i)}
                    onKeyPress={(e) => handleClassCodeKeyPress(e, i)}
                    maxLength={1}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!isJoiningClass}
                  />
                ))}
              </View>
              <TouchableOpacity
                style={[styles.joinSubmitBtn, isJoiningClass && { opacity: 0.7 }]}
                onPress={handleJoinClass}
                disabled={isJoiningClass}
              >
                {isJoiningClass ? <ActivityIndicator color="white" /> : <Text style={styles.joinSubmitBtnText}>Join Class</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* TAKE QUIZ MODAL */}
      <Modal visible={isQuizModalOpen} animationType="slide">
        <TakeQuiz
          quizTitle={quizToTake?.title || 'Quiz'}
          questions={quizToTake?.questions || []}
          onFinish={async (score) => {
            const total = quizToTake?.questions.length ?? 0;

            try {
              const quizResult = await completeQuiz(score, total, undefined, quizToTake?.id);
              return { xp: quizResult.xp, badges: quizResult.badges };
            } catch (error) {
              console.error('Failed to record quiz completion:', error);
              return { xp: 0, badges: [] };
            }
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.quizGenModalOverlay}>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Share own quiz to a study group */}
      <Modal
        visible={isShareOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsShareOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                    onPress={() => handleShareToGroup(g.id)}
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
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Edit own quiz — question list + per-question editor */}
      <Modal
        visible={editTarget !== null}
        animationType="slide"
        onRequestClose={requestCloseEditor}
      >
        <KeyboardAvoidingView style={styles.editorRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {editView === 'list' ? (
            <View style={styles.editorHeader}>
              <TouchableOpacity onPress={requestCloseEditor} style={styles.editorHeaderBtn} disabled={isSavingEdit}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.editorHeaderTitle}>Edit Quiz</Text>
              <TouchableOpacity
                style={[styles.editorSaveBtn, isSavingEdit && { opacity: 0.6 }]}
                onPress={handleSaveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? <ActivityIndicator size="small" color="white" /> : <Text style={styles.editorSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.editorHeader}>
              <TouchableOpacity onPress={goToList} style={styles.editorHeaderBtn} disabled={isSavingEdit}>
                <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.editorHeaderTitle}>
                {editQIndex !== null ? `Question ${editQIndex + 1}` : 'Question'}
              </Text>
              <TouchableOpacity onPress={removeActiveQuestion} style={styles.editorHeaderBtn} disabled={isSavingEdit}>
                <Ionicons name="trash-outline" size={22} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
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

                <Text style={styles.editorLabel}>Deadline (Optional) · YYYY-MM-DD HH:MM</Text>
                <View style={styles.editorDeadlineRow}>
                  <TextInput
                    style={[styles.editorInput, { flex: 1 }]}
                    value={editDraft.available_until}
                    onChangeText={updateDraftDeadline}
                    placeholder="e.g. 2026-10-01 23:59 — blank = no deadline"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSavingEdit}
                  />
                  {editDraft.available_until !== '' && (
                    <TouchableOpacity
                      style={styles.editorDeadlineClear}
                      onPress={() => updateDraftDeadline('')}
                      disabled={isSavingEdit}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close-circle" size={24} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Quiz Info Modal */}
      <Modal
        visible={infoModalQuiz !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setInfoModalQuiz(null)}
      >
        <View style={styles.infoModalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setInfoModalQuiz(null)} />
          {infoModalQuiz && (
            <View style={styles.infoModalCard}>
              <View style={styles.infoModalHeader}>
                <View style={[styles.badgePill, styles.infoModalBadge]}>
                  <Ionicons name={infoModalQuiz.quiz_type === 't/f' ? 'checkmark-outline' : 'list-outline'} size={14} color={COLORS.purpleVibrant} />
                  <Text style={styles.badgePillText}>{infoModalQuiz.quiz_type || 'quiz'}</Text>
                </View>
                <Pressable style={styles.closeBtn} onPress={() => setInfoModalQuiz(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={20} color={COLORS.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.infoModalTitle}>{infoModalQuiz.title}</Text>
              <View style={styles.infoModalMetaRow}>
                <Ionicons name="help-circle-outline" size={16} color={COLORS.purpleVibrant} />
                <Text style={styles.infoModalMetaText}>{infoModalQuiz.questions?.length || 0} questions</Text>
              </View>
              <View style={styles.infoModalMetaRow}>
                <Ionicons name="star-outline" size={16} color={COLORS.warning} />
                <Text style={styles.infoModalMetaText}>25 XP reward</Text>
              </View>
              {infoModalQuiz.available_until && (
                <View style={styles.infoModalMetaRow}>
                  <Ionicons name="time-outline" size={16} color={new Date(infoModalQuiz.available_until).getTime() <= Date.now() ? COLORS.danger : COLORS.warning} />
                  <Text style={[styles.infoModalMetaText, { color: new Date(infoModalQuiz.available_until).getTime() <= Date.now() ? COLORS.danger : COLORS.warning }]}>
                    {new Date(infoModalQuiz.available_until).getTime() <= Date.now()
                      ? `Closed ${new Date(infoModalQuiz.available_until).toLocaleString()}`
                      : `Closes ${new Date(infoModalQuiz.available_until).toLocaleString()}`}
                  </Text>
                </View>
              )}
              {infoModalQuiz.attempted ? (
                <View style={[styles.infoModalStartBtn, { backgroundColor: COLORS.success }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color="white" />
                  <Text style={styles.infoModalStartBtnText}>Already Taken</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.infoModalStartBtn}
                  onPress={() => { const q = infoModalQuiz; setInfoModalQuiz(null); handleTakeQuiz(q); }}
                  disabled={isQuizStarting}
                  activeOpacity={0.8}
                >
                  {isQuizStarting ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons name="play-outline" size={18} color="white" />
                      <Text style={styles.infoModalStartBtnText}>Start Quiz</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </Modal>

      {/* Quiz 3-dots menu — modal action sheet (Rename / Edit / Share / Delete) */}
      <Modal
        visible={menuQuizId !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <Pressable style={styles.menuSheetOverlay} onPress={closeMenu}>
          <Pressable style={styles.menuSheetCard} onPress={() => {}}>
            {(() => {
              const quiz = quizzes.find((q) => q.id === menuQuizId);
              if (!quiz) return null;
              return (
                <>
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
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rename Quiz Modal */}
      <Modal
        visible={renameQuizId !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => { setRenameQuizId(null); setRenameTitle(''); }}
      >
        <View style={styles.renameModalOverlay}>
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
        </View>
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
  menuSheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
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
  editorRoot: { flex: 1, backgroundColor: COLORS.bg },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  editorHeaderBtn: { padding: 8 },
  editorHeaderTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary },
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
  editorDeadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editorDeadlineClear: { padding: 4 },
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
  codeBoxes: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
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
