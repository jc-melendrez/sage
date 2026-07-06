import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch, StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import firestore from '@react-native-firebase/firestore';
import { API_BASE_URL } from '@/config/api';
import { getToken, getCurrentUser } from '@/services/authService';
import TakeQuiz from '../../components/TakeQuiz';
import LessonDisplay from '../../components/LessonDisplay';
import LessonGenerator from '@/components/LessonGenerator';

//  Rich Purple Palette (Matching Dashboard)
const COLORS = {
  bg: '#baaeda',
  bgSecondary: '#dad6e7',
  surface: '#cdc2dd',
  surfaceLight: '#5A4F6C',
  
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
  purpleGhost: '#DDD6FE',
  
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1', // Light, used on dark backgrounds
  textDark: '#1F2937',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

// 🔠 Typography System
const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

// --- Interfaces ---
interface StudyGroup {
  id: number;
  name: string;
  description: string;
  members_count: number;
  join_code: string;
  created_by: number;
}

interface GroupMessage {
  id: number;
  text: string;
  sender_id: number;
  sender_name: string;
  time: string;
}

interface Course {
  course_title: string;
  subject: string;
  user_id?: number;
  levels: Level[];
}

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
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedTab, setSelectedTab] = useState('groups');

  // Group & Quiz state
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(false);

  // --- NEW: Courses state ---
  const [courses, setCourses] = useState<Course[]>([]);
  const [levelProgress, setLevelProgress] = useState<{ [levelId: number]: number }>({});
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);

  // --- Quiz Player State ---
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [quizToTake, setQuizToTake] = useState<{ title: string; questions: any[]; levelId: number; passingScore: number } | null>(null);

  // --- Messenger & Chat State ---
  const [activeGroup, setActiveGroup] = useState<StudyGroup | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // --- Group Management Modals ---
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Generate Lesson Modal ---
  const [isGenerateLessonModalOpen, setIsGenerateLessonModalOpen] = useState(false);
  const [isLessonDisplayModalOpen, setIsLessonDisplayModalOpen] = useState(false);
  const [lessonToDisplay, setLessonToDisplay] = useState<any>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const chatUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => { loadInitialData(); }, []);

  useEffect(() => {
    if (!activeGroup && chatUnsubscribeRef.current) {
      chatUnsubscribeRef.current();
      chatUnsubscribeRef.current = null;
    }
    return () => {
      if (chatUnsubscribeRef.current) {
        chatUnsubscribeRef.current();
        chatUnsubscribeRef.current = null;
      }
    };
  }, [activeGroup]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const user = await getCurrentUser();
      setCurrentUser(user);
      const token = await getToken();

      const [groupRes, quizRes] = await Promise.all([
        fetch(`${API_BASE_URL}/users/groups/mine/`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/ai/quizzes/`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (groupRes.ok) setGroups(await groupRes.json());
      if (quizRes.ok) setQuizzes(await quizRes.json());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Alert.alert("Code Copied!", "The join code has been copied to your clipboard.");
  };

  const openChat = async (group: StudyGroup) => {
    setActiveGroup(group);
    setIsActionMenuOpen(false);

    if (chatUnsubscribeRef.current) {
      chatUnsubscribeRef.current();
      chatUnsubscribeRef.current = null;
    }

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/${group.id}/chat/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const initialMsgs = await res.json();
        setMessages(initialMsgs);
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
      }
    } catch (error) {
      console.error("Failed to load initial messages:", error);
    }

    try {
      const unsub = firestore()
        .collection('studyGroups')
        .doc(String(group.id))
        .collection('messages')
        .orderBy('created_at', 'asc')
        .onSnapshot(snapshot => {
          if (snapshot) {
            const firestoreMsgs = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                text: data.text,
                sender_id: data.sender_id,
                sender_name: data.sender_name,
                time: data.time || '',
              };
            });

            setMessages(prev => {
              const tempMessages = prev.filter(m => m.id > 1000000000000);
              const unsyncedTemp = tempMessages.filter(temp =>
                !firestoreMsgs.some(f => f.sender_id === temp.sender_id && f.text === temp.text)
              );
              return [...firestoreMsgs, ...unsyncedTemp];
            });

            setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
          }
        }, error => {
          console.error("Firestore Chat Subscription Error:", error);
        });

      chatUnsubscribeRef.current = unsub;
    } catch (firestoreError) {
      console.error("Failed to initialize firestore listener:", firestoreError);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !activeGroup) return;
    const textToSend = chatInput.trim();
    setChatInput('');

    const tempMsg: GroupMessage = {
      id: Date.now(),
      text: textToSend,
      sender_id: currentUser?.id,
      sender_name: currentUser?.first_name || 'Me',
      time: 'Just now'
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/${activeGroup.id}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text: textToSend })
      });
      if (res.ok) {
        const realMsg = await res.json();
        setMessages(prev => prev.map(m => m.id === tempMsg.id ? realMsg : m));
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      setIsSubmitting(true);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/create/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: newGroupName })
      });
      if (res.ok) {
        setNewGroupName('');
        setIsCreateModalOpen(false);
        loadInitialData();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!joinCodeInput.trim()) return;
    try {
      setIsSubmitting(true);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/join/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ join_code: joinCodeInput.toUpperCase() })
      });
      if (res.ok) {
        setJoinCodeInput('');
        setIsJoinModalOpen(false);
        loadInitialData();
      } else {
        Alert.alert("Error", "Invalid Join Code");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getLevelScore = (levelId: number): number => levelProgress[levelId] ?? 0;

  const isLevelUnlocked = (course: Course, levelIndex: number): boolean => {
    if (levelIndex === 0) return true;
    const prevLevel = course.levels[levelIndex - 1];
    const prevScore = getLevelScore(prevLevel.level_id);
    return prevScore >= prevLevel.passing_score;
  };

  const updateLevelProgress = (levelId: number, score: number) => {
    setLevelProgress(prev => ({ ...prev, [levelId]: score }));
  };

  const handleCourseGenerated = (course: Course) => {
    setCourses(prev => [course, ...prev]);
    setIsGenerateLessonModalOpen(false);
    Alert.alert('Success', 'Course generated successfully!');
  };

  const openCourseDetail = (course: Course) => {
    setSelectedCourse(course);
    setIsCourseModalOpen(true);
  };

  const takeQuizForLevel = (level: Level) => {
    const quizQuestions = level.quiz.map((q, idx) => ({
      id: idx + 1,
      question: q.question,
      type: 'Multiple Choice',
      options: q.options,
      correct_answer: q.correct_answer,
    }));
    setQuizToTake({
      title: `${level.difficulty} Quiz`,
      questions: quizQuestions,
      levelId: level.level_id,
      passingScore: level.passing_score,
    });
    setIsQuizModalOpen(true);
  };

  const renderLevels = (course: Course) => {
    return course.levels.map((level, index) => {
      const unlocked = isLevelUnlocked(course, index);
      const score = getLevelScore(level.level_id);
      const passed = score >= level.passing_score;

      return (
        <View key={level.level_id} style={styles.levelCard}>
          <View style={styles.levelHeader}>
            <View style={styles.levelLeft}>
              <Text style={styles.levelDifficulty}>
                {unlocked ? '' : '🔒'} {level.difficulty}
              </Text>
              {score > 0 && (
                <View style={styles.levelScoreBadge}>
                  <Text style={styles.levelScoreText}>{score}%</Text>
                </View>
              )}
              {passed && (
                <View style={styles.levelPassBadge}>
                  <Text style={styles.levelPassText}>✅ Passed</Text>
                </View>
              )}
            </View>
            <Text style={styles.levelPassingScore}>Pass: {level.passing_score}%</Text>
          </View>

          <View style={styles.levelActions}>
            <TouchableOpacity
              style={[styles.levelButton, !unlocked && styles.levelButtonDisabled]}
              disabled={!unlocked}
              onPress={() => {
                Alert.alert('Content', level.content.substring(0, 200) + '...');
              }}
            >
              <Ionicons name="book-outline" size={16} color={unlocked ? 'white' : '#9CA3AF'} />
              <Text style={[styles.levelButtonText, !unlocked && { color: '#9CA3AF' }]}>
                View Content
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.levelButton, styles.levelQuizButton, !unlocked && styles.levelButtonDisabled]}
              disabled={!unlocked}
              onPress={() => takeQuizForLevel(level)}
            >
              <Ionicons name="help-circle-outline" size={16} color={unlocked ? 'white' : '#9CA3AF'} />
              <Text style={[styles.levelButtonText, !unlocked && { color: '#9CA3AF' }]}>
                Take Quiz
              </Text>
            </TouchableOpacity>
          </View>

          {index < course.levels.length - 1 && (
            <View style={styles.levelDivider}>
              <Ionicons name="arrow-down" size={20} color={COLORS.purpleLight} />
            </View>
          )}
        </View>
      );
    });
  };

  // --- ACTIVE CHAT VIEW ---
  if (activeGroup) {
    const isAdmin = currentUser?.id === activeGroup.created_by;
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} />
        
        {/* Chat Header */}
        <LinearGradient
          colors={[COLORS.purpleDeep, COLORS.purpleDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.chatHeader}
        >
          <TouchableOpacity onPress={() => setActiveGroup(null)} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={24} color="white" />
          </TouchableOpacity>
          <View style={styles.chatHeaderTitleBox}>
            <Text style={styles.chatHeaderTitle}>{activeGroup.name}</Text>
            <Text style={styles.chatHeaderSubtitle}>{activeGroup.members_count} members</Text>
          </View>
          <TouchableOpacity onPress={() => setIsSettingsOpen(true)} style={{ padding: 4 }}>
            <Ionicons name="settings-outline" size={22} color="white" />
          </TouchableOpacity>
        </LinearGradient>

        <ScrollView ref={scrollViewRef} style={styles.chatArea} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {messages.map((msg) => {
            const isMe = msg.sender_id === currentUser?.id;
            return (
              <View key={msg.id} style={[styles.messageWrapper, isMe ? styles.messageMe : styles.messageOther]}>
                {!isMe && <Text style={styles.senderName}>{msg.sender_name}</Text>}
                <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  <Text style={[styles.messageText, isMe ? { color: 'white' } : { color: COLORS.textDark }]}>{msg.text}</Text>
                </View>
                <Text style={styles.messageTime}>{msg.time}</Text>
              </View>
            );
          })}
        </ScrollView>

        {isActionMenuOpen && (
          <View style={styles.actionMenuContainer}>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn}>
                <View style={[styles.actionIconBox, { backgroundColor: COLORS.purplePrimary }]}><Ionicons name="document-text" size={20} color="white" /></View>
                <Text style={styles.actionBtnText}>File</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn}>
                <View style={[styles.actionIconBox, { backgroundColor: COLORS.success }]}><Ionicons name="image" size={20} color="white" /></View>
                <Text style={styles.actionBtnText}>Photo</Text>
              </TouchableOpacity>
              {isAdmin && (
                <>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert("Admin Tool", "Launching Mock Quiz...")}>
                    <View style={[styles.actionIconBox, { backgroundColor: COLORS.warning }]}><Ionicons name="bulb" size={20} color="white" /></View>
                    <Text style={styles.actionBtnText}>Start Mock Quiz</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn}>
                    <View style={[styles.actionIconBox, { backgroundColor: COLORS.accent }]}><Ionicons name="calendar" size={20} color="white" /></View>
                    <Text style={styles.actionBtnText}>Schedule</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TouchableOpacity onPress={() => setIsActionMenuOpen(!isActionMenuOpen)} style={styles.plusButton}>
            <Ionicons name={isActionMenuOpen ? "close" : "add"} size={28} color={COLORS.purpleDeep} />
          </TouchableOpacity>
          <View style={styles.textInputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder="Message group..."
              placeholderTextColor="#9CA3AF"
              value={chatInput}
              onChangeText={setChatInput}
              multiline
            />
          </View>
          <TouchableOpacity 
            style={[styles.sendButton, !chatInput.trim() && { opacity: 0.5, backgroundColor: COLORS.textMuted }]} 
            onPress={sendChatMessage}
          >
            <Ionicons name="send" size={16} color="white" />
          </TouchableOpacity>
        </View>

        <Modal visible={isSettingsOpen} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { minHeight: '65%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Group Info</Text>
                <TouchableOpacity onPress={() => setIsSettingsOpen(false)}>
                  <Ionicons name="close" size={24} color={COLORS.textDark} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ alignItems: 'center', marginBottom: 24 }}>
                  <LinearGradient
                    colors={[COLORS.purpleDeep, COLORS.purpleVibrant]}
                    style={styles.bigAvatar}
                  >
                    <Text style={styles.bigAvatarText}>{activeGroup.name.substring(0, 2).toUpperCase()}</Text>
                  </LinearGradient>
                  <Text style={styles.settingsGroupName}>{activeGroup.name}</Text>
                  <Text style={styles.settingsGroupDesc}>{activeGroup.description || 'No description provided.'}</Text>
                  {isAdmin && <Text style={styles.adminBadge}>Admin</Text>}
                </View>
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>Invite Members</Text>
                  <Text style={styles.settingsDesc}>Share this secret code with classmates so they can join.</Text>
                  <View style={styles.codeBox}>
                    <Text style={styles.codeText}>{activeGroup.join_code}</Text>
                    <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(activeGroup.join_code)}>
                      <Ionicons name="copy-outline" size={16} color="white" />
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginLeft: 6 }}>Copy</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.settingsOptionsBlock}>
                  <View style={styles.settingsOptionRow}>
                    <View style={styles.settingsOptionIcon}><Ionicons name="notifications-outline" size={20} color={COLORS.textDark} /></View>
                    <Text style={styles.settingsOptionText}>Mute Notifications</Text>
                    <Switch value={isMuted} onValueChange={setIsMuted} trackColor={{ false: '#D1D5DB', true: COLORS.purpleVibrant }} />
                  </View>
                  <TouchableOpacity style={styles.settingsOptionRow}>
                    <View style={styles.settingsOptionIcon}><Ionicons name="people-outline" size={20} color={COLORS.textDark} /></View>
                    <Text style={styles.settingsOptionText}>View Members ({activeGroup.members_count})</Text>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>
                  {isAdmin && (
                    <TouchableOpacity style={styles.settingsOptionRow}>
                      <View style={styles.settingsOptionIcon}><Ionicons name="create-outline" size={20} color={COLORS.textDark} /></View>
                      <Text style={styles.settingsOptionText}>Edit Group Info</Text>
                      <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.settingsOptionRow, { borderBottomWidth: 0 }]} onPress={() => { setIsSettingsOpen(false); setActiveGroup(null); }}>
                    <View style={[styles.settingsOptionIcon, { backgroundColor: '#FEE2E2' }]}><Ionicons name="log-out-outline" size={20} color={COLORS.danger} /></View>
                    <Text style={[styles.settingsOptionText, { color: COLORS.danger }]}>Leave Group</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  // --- MAIN TABS VIEW ---
  return (
    <LinearGradient
      colors={[COLORS.bgSecondary, COLORS.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.mainWrapper}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* ✅ UPDATED: Purple gradient header matching Dashboard design */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Text style={styles.headerTitle}>Activities</Text>
        <Text style={styles.headerSubtitle}>Lessons, quizzes, and group tasks</Text>
      </LinearGradient>

      {/* ✅ UPDATED: High-visibility tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity 
          style={[styles.tab, selectedTab === 'lessons' && styles.tabActive]} 
          onPress={() => setSelectedTab('lessons')}
        >
          <Text style={[styles.tabText, selectedTab === 'lessons' && styles.tabTextActive]}>Courses</Text>
          {selectedTab === 'lessons' && <View style={styles.activeTabIndicator} />}
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tab, selectedTab === 'quizzes' && styles.tabActive]} 
          onPress={() => setSelectedTab('quizzes')}
        >
          <Text style={[styles.tabText, selectedTab === 'quizzes' && styles.tabTextActive]}>Quizzes</Text>
          {selectedTab === 'quizzes' && <View style={styles.activeTabIndicator} />}
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tab, selectedTab === 'groups' && styles.tabActive]} 
          onPress={() => setSelectedTab('groups')}
        >
          <Text style={[styles.tabText, selectedTab === 'groups' && styles.tabTextActive]}>Groups</Text>
          {selectedTab === 'groups' && <View style={styles.activeTabIndicator} />}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* COURSES VIEW */}
        {selectedTab === 'lessons' && (
          <View style={styles.itemsList}>
            {courses.length === 0 && (
              <View style={styles.emptyStateCard}>
                <View style={styles.emptyStateIconContainer}>
                  <Ionicons name="book-outline" size={48} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.emptyStateTitle}>No courses yet</Text>
                <Text style={styles.emptyStateText}>Tap + to generate a personalized course.</Text>
              </View>
            )}
            {courses.map((course, index) => (
              <TouchableOpacity
                key={`course-${index}`}
                style={styles.card}
                onPress={() => openCourseDetail(course)}
                activeOpacity={0.7}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.subjectBadge}>
                      <View style={[styles.colorDot, { backgroundColor: COLORS.purplePrimary }]} />
                      <Text style={styles.subjectText}>{course.subject}</Text>
                    </View>
                    <Text style={styles.cardTitle}>{course.course_title}</Text>
                    <View style={styles.metaInfo}>
                      <View style={styles.metaItem}>
                        <Ionicons name="layers-outline" size={12} color={COLORS.textMuted} />
                        <Text style={styles.metaText}>{course.levels.length} levels</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.statusIcon}>
                    <LinearGradient
                      colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                      style={styles.chevronCircle}
                    >
                      <Ionicons name="chevron-forward" size={20} color="white" />
                    </LinearGradient>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* QUIZZES VIEW */}
        {selectedTab === 'quizzes' && (
          <View style={styles.itemsList}>
            {quizzes.length === 0 && !loading && (
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
                      <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.quiz_type}</Text></View>
                      <View style={[styles.badgePill, { borderColor: COLORS.purplePrimary }]}>
                        <Text style={[styles.badgePillText, { color: COLORS.purplePrimary }]}>AI Generated</Text>
                      </View>
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
        {selectedTab === 'groups' && (
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

            {loading ? <ActivityIndicator size="large" color={COLORS.purpleVibrant} style={{ marginTop: 40 }} /> :
              groups.map((group) => (
                <TouchableOpacity key={group.id} style={styles.inboxRow} onPress={() => openChat(group)} activeOpacity={0.7}>
                  <LinearGradient
                    colors={[COLORS.purpleDark, COLORS.purpleVibrant]}
                    style={styles.inboxAvatar}
                  >
                    <Text style={styles.inboxAvatarText}>{group.name.substring(0, 2).toUpperCase()}</Text>
                  </LinearGradient>
                  <View style={styles.inboxDetails}>
                    <View style={styles.inboxRowTop}>
                      <Text style={styles.inboxName} numberOfLines={1}>{group.name}</Text>
                      <View style={styles.liveBadgeSmall}>
                         <View style={styles.liveDotSmall} />
                         <Text style={styles.liveTextSmall}>Active</Text>
                      </View>
                    </View>
                    <Text style={styles.inboxPreview} numberOfLines={1}>
                      {group.members_count} members • Tap to enter chat...
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            }
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
            <LinearGradient
              colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.modalSubmitBtnGradient}
            >
              <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleCreateGroup}>
                {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Create</Text>}
              </TouchableOpacity>
            </LinearGradient>
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
            <LinearGradient
              colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.modalSubmitBtnGradient}
            >
              <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleJoinGroup}>
                {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Join</Text>}
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* TAKE QUIZ MODAL */}
      <Modal visible={isQuizModalOpen} animationType="slide">
        <TakeQuiz
          quizTitle={quizToTake?.title || 'Quiz'}
          questions={quizToTake?.questions || []}
          onFinish={(score) => {
            if (quizToTake && quizToTake.levelId !== -1) {
              const levelId = quizToTake.levelId;
              const passingScore = quizToTake.passingScore;
              updateLevelProgress(levelId, score);
              if (score >= passingScore) {
                Alert.alert(' Passed!', `You scored ${score}% and unlocked the next level.`);
              } else {
                Alert.alert('Keep trying!', `You scored ${score}%. Need ${passingScore}% to unlock the next level.`);
              }
            } else {
              Alert.alert('Quiz Finished', `Your score: ${score}%`);
            }
            setIsQuizModalOpen(false);
            setQuizToTake(null);
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
        <View style={styles.courseModalContainer}>
          <LinearGradient
            colors={[COLORS.purpleDeep, COLORS.purpleDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.courseModalHeader}
          >
            <TouchableOpacity onPress={() => setIsCourseModalOpen(false)} style={styles.courseModalBack}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <View style={styles.courseModalTitleBox}>
              <Text style={styles.courseModalTitle}>{selectedCourse?.course_title}</Text>
              <Text style={styles.courseModalSubtitle}>{selectedCourse?.subject}</Text>
            </View>
            <View style={{ width: 40 }} />
          </LinearGradient>
          <ScrollView style={styles.courseModalContent}>
            {selectedCourse && renderLevels(selectedCourse)}
          </ScrollView>
        </View>
      </Modal>

      {/* LEGACY LESSON DISPLAY MODAL */}
      <Modal visible={isLessonDisplayModalOpen} animationType="slide">
        {lessonToDisplay && (
          <LessonDisplay
            lesson={lessonToDisplay}
            onClose={() => setIsLessonDisplayModalOpen(false)}
          />
        )}
      </Modal>

      {/* FAB */}
      {selectedTab === 'lessons' && (
        <LinearGradient
          colors={[COLORS.purpleDeep, COLORS.purpleVibrant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.generateLessonFab}
        >
          <TouchableOpacity
            onPress={() => setIsGenerateLessonModalOpen(true)}
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="add" size={24} color="white" />
          </TouchableOpacity>
        </LinearGradient>
      )}
    </LinearGradient>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  mainWrapper: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },

  // ✅ UPDATED: Header with purple gradient and curved bottom
  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
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

  // ✅ UPDATED: Tabs with high visibility
  tabsContainer: { 
    flexDirection: 'row', 
    backgroundColor: 'transparent', 
    paddingHorizontal: 24, 
    paddingTop: 16, 
    paddingBottom: 8 
  },
  tab: { 
    flex: 1, 
    paddingVertical: 12, 
    alignItems: 'center', 
    position: 'relative' 
  },
  tabActive: { },
  activeTabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 24,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.purpleDeep,
  },
  tabText: { 
    fontSize: 15, 
    color: COLORS.purpleLight, // Visible light purple for inactive
    fontFamily: FONTS.semiBold 
  },
  tabTextActive: { 
    color: COLORS.purpleDeep, // Deep purple for active
    fontFamily: FONTS.bold, 
    fontSize: 16 
  },
  
  content: { flex: 1 },
  itemsList: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 16 },
  
  emptyStateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
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
    color: COLORS.purpleLight,
    fontSize: 14,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 20,
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
  badgePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.5)' },
  badgePillText: { fontSize: 10, color: COLORS.textDark, fontFamily: FONTS.semiBold },
  takeQuizBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.purplePrimary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, gap: 6, alignSelf: 'center', shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:2}, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  takeQuizBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 13 },

  inboxContainer: { paddingTop: 8 },
  inboxActions: { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  inboxBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, paddingVertical: 12, borderRadius: 14, gap: 6, borderWidth: 1, borderColor: COLORS.border },
  inboxBtnText: { color: COLORS.purpleDeep, fontFamily: FONTS.semiBold, fontSize: 14 },
  inboxRow: { flexDirection: 'row', padding: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border, alignItems: 'center', marginHorizontal: 24, marginBottom: 12, borderRadius: 16 },
  inboxAvatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 14, shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:2}, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  inboxAvatarText: { color: 'white', fontSize: 16, fontFamily: FONTS.bold },
  inboxDetails: { flex: 1 },
  inboxRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },
  inboxName: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textPrimary, flex: 1 },
  liveBadgeSmall: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.success, marginRight: 4 },
  liveTextSmall: { fontSize: 10, color: COLORS.success, fontFamily: FONTS.bold },
  inboxPreview: { fontSize: 13, color: COLORS.textMuted, fontFamily: FONTS.regular },

  chatHeader: { paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 4 },
  chatHeaderTitleBox: { flex: 1, alignItems: 'center' },
  chatHeaderTitle: { color: 'white', fontSize: 18, fontFamily: FONTS.bold },
  chatHeaderSubtitle: { color: COLORS.purplePale, fontSize: 12, marginTop: 2, fontFamily: FONTS.medium },
  chatArea: { flex: 1, backgroundColor: COLORS.bg },
  messageWrapper: { marginBottom: 16, maxWidth: '80%' },
  messageMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: { fontSize: 10, color: COLORS.textMuted, marginBottom: 4, marginLeft: 4, fontFamily: FONTS.medium },
  messageBubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleMe: { backgroundColor: COLORS.purplePrimary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  messageText: { fontSize: 15, lineHeight: 22, fontFamily: FONTS.regular },
  messageTime: { fontSize: 10, color: COLORS.textMuted, marginTop: 4, fontFamily: FONTS.medium },

  actionMenuContainer: { backgroundColor: COLORS.surface, paddingVertical: 16, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-start', flexWrap: 'wrap', gap: 16 },
  actionBtn: { alignItems: 'center', width: '22%', marginBottom: 12 },
  actionIconBox: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 6, shadowColor: '#000', shadowOffset: {width:0, height:2}, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  actionBtnText: { fontSize: 11, color: COLORS.textDark, fontFamily: FONTS.medium, textAlign: 'center' },

  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  plusButton: { padding: 6, marginRight: 8, backgroundColor: COLORS.bgSecondary, borderRadius: 20, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  textInputWrapper: { flex: 1, backgroundColor: COLORS.bg, borderRadius: 20, paddingHorizontal: 16, maxHeight: 100, borderWidth: 1, borderColor: COLORS.border },
  textInput: { fontSize: 15, color: COLORS.textDark, fontFamily: FONTS.regular, paddingVertical: 8 },
  sendButton: { backgroundColor: COLORS.purplePrimary, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 8, marginBottom: 2, shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:2}, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textDark },
  modalInput: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 20, fontFamily: FONTS.regular, borderWidth: 1, borderColor: COLORS.border },
  modalSubmitBtnGradient: { borderRadius: 12, overflow: 'hidden' },
  modalSubmitBtn: { padding: 16, alignItems: 'center' },

  generateLessonFab: { position: 'absolute', bottom: 24, right: 24, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, zIndex: 10 },

  // Course detail styles
  courseModalContainer: { flex: 1, backgroundColor: COLORS.bg },
  courseModalHeader: { paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingBottom: 20, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  courseModalBack: { padding: 4 },
  courseModalTitleBox: { flex: 1, alignItems: 'center' },
  courseModalTitle: { color: 'white', fontSize: 18, fontFamily: FONTS.bold },
  courseModalSubtitle: { color: COLORS.purplePale, fontSize: 12, marginTop: 2, fontFamily: FONTS.medium },
  courseModalContent: { padding: 24 },

  levelCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border, shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:2}, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  levelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  levelLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelDifficulty: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textDark },
  levelScoreBadge: { backgroundColor: COLORS.purpleGhost, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  levelScoreText: { fontSize: 12, color: COLORS.purpleDeep, fontFamily: FONTS.bold },
  levelPassBadge: { backgroundColor: 'rgba(16, 185, 129, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  levelPassText: { fontSize: 12, color: COLORS.success, fontFamily: FONTS.bold },
  levelPassingScore: { fontSize: 12, color: COLORS.textMuted, fontFamily: FONTS.medium },
  levelActions: { flexDirection: 'row', gap: 12 },
  levelButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purplePrimary, paddingVertical: 12, borderRadius: 12, gap: 8 },
  levelQuizButton: { backgroundColor: COLORS.purpleVibrant },
  levelButtonDisabled: { backgroundColor: COLORS.bgSecondary },
  levelButtonText: { color: 'white', fontFamily: FONTS.semiBold, fontSize: 14 },
  levelDivider: { alignItems: 'center', marginVertical: 8 },

  // Settings modal styles
  bigAvatar: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 12, shadowColor: COLORS.purpleDeep, shadowOffset: {width:0, height:4}, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  bigAvatarText: { color: 'white', fontSize: 24, fontFamily: FONTS.bold },
  settingsGroupName: { fontSize: 22, fontFamily: FONTS.bold, color: COLORS.textDark },
  settingsGroupDesc: { fontSize: 14, color: COLORS.textMuted, marginTop: 6, textAlign: 'center', paddingHorizontal: 20, fontFamily: FONTS.regular },
  adminBadge: { backgroundColor: 'rgba(239, 68, 68, 0.1)', color: COLORS.danger, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, fontSize: 12, fontFamily: FONTS.bold, marginTop: 12 },
  settingsSection: { backgroundColor: COLORS.bg, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border, marginTop: 20 },
  settingsSectionTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textDark, marginBottom: 6 },
  settingsDesc: { fontSize: 13, color: COLORS.textMuted, marginBottom: 16, fontFamily: FONTS.regular },
  codeBox: { flexDirection: 'row', backgroundColor: COLORS.textDark, borderRadius: 12, padding: 6, alignItems: 'center' },
  codeText: { flex: 1, color: 'white', fontSize: 18, letterSpacing: 4, textAlign: 'center', fontFamily: FONTS.bold },
  copyBtn: { backgroundColor: COLORS.purplePrimary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  settingsOptionsBlock: { marginTop: 20, backgroundColor: COLORS.bg, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16 },
  settingsOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  settingsOptionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  settingsOptionText: { flex: 1, fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textDark },
});