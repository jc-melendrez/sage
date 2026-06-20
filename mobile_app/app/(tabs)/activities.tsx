import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, 
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard'; // 🌟 NEW: Clipboard for the Copy Button
import firestore from '@react-native-firebase/firestore';
import { API_BASE_URL } from '@/config/api';
import { getToken, getCurrentUser } from '@/services/authService';
import TakeQuiz from '../../components/TakeQuiz';

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

interface Lesson {
  id: number;
  title: string;
  subject: string;
  duration: string;
  progress: number;
  status: 'completed' | 'in-progress' | 'not-started';
  points: number;
  color: string;
}

interface Quiz {
  id: number;
  title: string;
  created_at: string;
  quiz_type?: string;
  questions: any[];
  difficulty?: string; // Optional since backend might not store it yet
}

export default function ActivitiesScreen() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedTab, setSelectedTab] = useState('groups');
  
  // Real API State
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(false);

  // Quiz Player State
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [quizToTake, setQuizToTake] = useState<Quiz | null>(null);

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
  const scrollViewRef = useRef<ScrollView>(null);
  const chatUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  // Cleanup chat unsubscribe listener when leaving the chat screen
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

      // Fetch Groups and Quizzes in parallel
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

  // --- 🌟 NEW: Copy to Clipboard Function ---
  const copyToClipboard = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Alert.alert("Code Copied!", "The join code has been copied to your clipboard.");
  };

  // --- Chat Functions ---
  const openChat = async (group: StudyGroup) => {
    setActiveGroup(group);
    setIsActionMenuOpen(false);
    
    // Unsubscribe from any existing listener first
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

    // Connect real-time Firestore listener for this group's messages
    try {
      const unsub = firestore()
        .collection('groups')
        .doc(String(group.id))
        .collection('messages')
        .orderBy('created_at', 'asc')
        .onSnapshot(snapshot => {
          if (snapshot) {
            const firestoreMsgs = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                id: data.id,
                text: data.text,
                sender_id: data.sender_id,
                sender_name: data.sender_name,
                time: data.time || '',
              };
            });

            setMessages(prev => {
              // Filter out local temporary messages that are already synced (matching by text and sender)
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
      id: Date.now(), text: textToSend, sender_id: currentUser?.id, sender_name: currentUser?.first_name || 'Me', time: 'Just now'
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

  // --- Group Management Functions ---
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
    } finally { setIsSubmitting(false); }
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
    } finally { setIsSubmitting(false); }
  };

  // Static Fallback Data
  const lessons: Lesson[] = [
    { id: 1, title: 'Introduction to Calculus', subject: 'Mathematics', duration: '45 min', progress: 100, status: 'completed', points: 250, color: '#3B82F6' },
    { id: 2, title: "Newton's Laws of Motion", subject: 'Physics', duration: '30 min', progress: 60, status: 'in-progress', points: 200, color: '#10B981' },
  ];

  // --- ACTIVE CHAT VIEW ---
  if (activeGroup) {
    const isAdmin = currentUser?.id === activeGroup.created_by;

    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {/* 🌟 HEADER PADDING REDUCED */}
        <View style={styles.chatHeader}>
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
        </View>

        {/* Chat Messages */}
        <ScrollView ref={scrollViewRef} style={styles.chatArea} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {messages.map((msg) => {
            const isMe = msg.sender_id === currentUser?.id;
            return (
              <View key={msg.id} style={[styles.messageWrapper, isMe ? styles.messageMe : styles.messageOther]}>
                {!isMe && <Text style={styles.senderName}>{msg.sender_name}</Text>}
                <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  <Text style={[styles.messageText, isMe ? { color: 'white' } : { color: '#1F2937' }]}>{msg.text}</Text>
                </View>
                <Text style={styles.messageTime}>{msg.time}</Text>
              </View>
            );
          })}
        </ScrollView>

        {/* Action Menu (+ Button) */}
        {isActionMenuOpen && (
          <View style={styles.actionMenuContainer}>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn}>
                <View style={[styles.actionIconBox, { backgroundColor: '#3B82F6' }]}><Ionicons name="document-text" size={20} color="white" /></View>
                <Text style={styles.actionBtnText}>File</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn}>
                <View style={[styles.actionIconBox, { backgroundColor: '#10B981' }]}><Ionicons name="image" size={20} color="white" /></View>
                <Text style={styles.actionBtnText}>Photo</Text>
              </TouchableOpacity>
              
              {/* ADMIN ONLY FEATURES */}
              {isAdmin && (
                <>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert("Admin Tool", "Launching Mock Quiz...")}>
                    <View style={[styles.actionIconBox, { backgroundColor: '#F59E0B' }]}><Ionicons name="bulb" size={20} color="white" /></View>
                    <Text style={styles.actionBtnText}>Start Mock Quiz</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn}>
                    <View style={[styles.actionIconBox, { backgroundColor: '#8B5CF6' }]}><Ionicons name="calendar" size={20} color="white" /></View>
                    <Text style={styles.actionBtnText}>Schedule</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* Chat Input */}
        <View style={styles.inputContainer}>
          <TouchableOpacity onPress={() => setIsActionMenuOpen(!isActionMenuOpen)} style={styles.plusButton}>
            <Ionicons name={isActionMenuOpen ? "close" : "add"} size={28} color="#6D28D9" />
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
          <TouchableOpacity style={[styles.sendButton, !chatInput.trim() && { opacity: 0.5 }]} onPress={sendChatMessage}>
            <Ionicons name="send" size={16} color="white" />
          </TouchableOpacity>
        </View>

        {/* 🌟 UPGRADED GROUP SETTINGS MODAL */}
        <Modal visible={isSettingsOpen} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { minHeight: '65%' }]}>
              
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Group Info</Text>
                <TouchableOpacity onPress={() => setIsSettingsOpen(false)}>
                  <Ionicons name="close" size={24} color="#1F2937" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                
                {/* Avatar & Title */}
                <View style={{ alignItems: 'center', marginBottom: 24 }}>
                  <View style={styles.bigAvatar}><Text style={styles.bigAvatarText}>{activeGroup.name.substring(0, 2).toUpperCase()}</Text></View>
                  <Text style={styles.settingsGroupName}>{activeGroup.name}</Text>
                  <Text style={styles.settingsGroupDesc}>{activeGroup.description || 'No description provided.'}</Text>
                  {isAdmin && <Text style={styles.adminBadge}>Admin</Text>}
                </View>

                {/* Invite Code Block */}
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>Invite Members</Text>
                  <Text style={styles.settingsDesc}>Share this secret code with classmates so they can join.</Text>
                  <View style={styles.codeBox}>
                    <Text style={styles.codeText}>{activeGroup.join_code}</Text>
                    {/* 🌟 FULLY FUNCTIONAL COPY BUTTON */}
                    <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(activeGroup.join_code)}>
                      <Ionicons name="copy-outline" size={16} color="white" />
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13, marginLeft: 6 }}>Copy</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Settings Options List */}
                <View style={styles.settingsOptionsBlock}>
                  
                  <View style={styles.settingsOptionRow}>
                    <View style={styles.settingsOptionIcon}><Ionicons name="notifications-outline" size={20} color="#4B5563" /></View>
                    <Text style={styles.settingsOptionText}>Mute Notifications</Text>
                    <Switch value={isMuted} onValueChange={setIsMuted} trackColor={{ false: '#D1D5DB', true: '#8B5CF6' }} />
                  </View>
                  
                  <TouchableOpacity style={styles.settingsOptionRow}>
                    <View style={styles.settingsOptionIcon}><Ionicons name="people-outline" size={20} color="#4B5563" /></View>
                    <Text style={styles.settingsOptionText}>View Members ({activeGroup.members_count})</Text>
                    <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                  </TouchableOpacity>

                  {isAdmin && (
                    <TouchableOpacity style={styles.settingsOptionRow}>
                      <View style={styles.settingsOptionIcon}><Ionicons name="create-outline" size={20} color="#4B5563" /></View>
                      <Text style={styles.settingsOptionText}>Edit Group Info</Text>
                      <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={[styles.settingsOptionRow, { borderBottomWidth: 0 }]} onPress={() => { setIsSettingsOpen(false); setActiveGroup(null); }}>
                    <View style={[styles.settingsOptionIcon, { backgroundColor: '#FEE2E2' }]}><Ionicons name="log-out-outline" size={20} color="#EF4444" /></View>
                    <Text style={[styles.settingsOptionText, { color: '#EF4444' }]}>Leave Group</Text>
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
    <View style={styles.container}>
      {/* 🌟 HEADER PADDING REDUCED */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Activities</Text>
        <Text style={styles.headerSubtitle}>Lessons, quizzes, and group tasks</Text>
      </View>

      <View style={styles.tabsContainer}>
        {/*
        <TouchableOpacity style={[styles.tab, selectedTab === 'lessons' && styles.tabActive]} onPress={() => setSelectedTab('lessons')}>
          <Text style={[styles.tabText, selectedTab === 'lessons' && styles.tabTextActive]}>Lessons</Text>
        </TouchableOpacity>
        */}
        <TouchableOpacity style={[styles.tab, selectedTab === 'quizzes' && styles.tabActive]} onPress={() => setSelectedTab('quizzes')}>
          <Text style={[styles.tabText, selectedTab === 'quizzes' && styles.tabTextActive]}>Quizzes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, selectedTab === 'groups' && styles.tabActive]} onPress={() => setSelectedTab('groups')}>
          <Text style={[styles.tabText, selectedTab === 'groups' && styles.tabTextActive]}>Groups</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* LESSONS VIEW */}
        {selectedTab === 'lessons' && (
          <View style={styles.itemsList}>
            {lessons.map((lesson) => (
              <View key={lesson.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.subjectBadge}>
                      <View style={[styles.colorDot, { backgroundColor: lesson.color }]} />
                      <Text style={styles.subjectText}>{lesson.subject}</Text>
                    </View>
                    <Text style={styles.cardTitle}>{lesson.title}</Text>
                    <View style={styles.metaInfo}>
                      <View style={styles.metaItem}><Ionicons name="time-outline" size={12} color="#6B7280" /><Text style={styles.metaText}>{lesson.duration}</Text></View>
                      <View style={styles.metaItem}><Ionicons name="trophy-outline" size={12} color="#6B7280" /><Text style={styles.metaText}>{lesson.points} pts</Text></View>
                    </View>
                  </View>
                  <View style={styles.statusIcon}>
                    {lesson.status === 'completed' && <Ionicons name="checkmark-circle" size={24} color="#10B981" />}
                    {lesson.status === 'in-progress' && <Ionicons name="play-circle" size={24} color="#6D28D9" />}
                    {lesson.status === 'not-started' && <Ionicons name="book-outline" size={24} color="#D1D5DB" />}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* QUIZZES VIEW */}
        {selectedTab === 'quizzes' && (
          <View style={styles.itemsList}>
            {quizzes.length === 0 && !loading && (
              <Text style={{ textAlign: 'center', color: '#6B7280', marginTop: 20 }}>No quizzes generated yet.</Text>
            )}
            {quizzes.map((quiz) => (
              <View key={quiz.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgesRow}>
                      <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.questions?.length || 0} Questions</Text></View>
                      <View style={styles.badgePill}><Text style={styles.badgePillText}>{quiz.quiz_type}</Text></View>
                      <View style={[styles.badgePill, { borderColor: '#7C3AED' }]}>
                        <Text style={[styles.badgePillText, { color: '#7C3AED' }]}>AI Generated</Text>
                      </View>
                    </View>
                    <Text style={styles.cardTitle}>{quiz.title}</Text>
                    <Text style={styles.metaText}>Created {new Date(quiz.created_at).toLocaleDateString()}</Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.takeQuizBtn} 
                    onPress={() => {
                      setQuizToTake(quiz);
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

        {/* MESSENGER-STYLE INBOX */}
        {selectedTab === 'groups' && (
          <View style={styles.inboxContainer}>
            <View style={styles.inboxActions}>
              <TouchableOpacity style={styles.inboxBtn} onPress={() => setIsCreateModalOpen(true)}>
                <Ionicons name="create-outline" size={18} color="#6D28D9" />
                <Text style={styles.inboxBtnText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inboxBtn} onPress={() => setIsJoinModalOpen(true)}>
                <Ionicons name="enter-outline" size={18} color="#6D28D9" />
                <Text style={styles.inboxBtnText}>Join Code</Text>
              </TouchableOpacity>
            </View>

            {loading ? <ActivityIndicator size="large" color="#6D28D9" style={{ marginTop: 40 }} /> : 
              groups.map((group) => (
                <TouchableOpacity key={group.id} style={styles.inboxRow} onPress={() => openChat(group)}>
                  <View style={styles.inboxAvatar}>
                    <Text style={styles.inboxAvatarText}>{group.name.substring(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={styles.inboxDetails}>
                    <View style={styles.inboxRowTop}>
                      <Text style={styles.inboxName} numberOfLines={1}>{group.name}</Text>
                      <Text style={styles.inboxTime}>Active</Text>
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

      {/* CREATE & JOIN MODALS */}
      <Modal visible={isCreateModalOpen} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Group</Text>
              <TouchableOpacity onPress={() => setIsCreateModalOpen(false)}><Ionicons name="close" size={24} color="#1F2937" /></TouchableOpacity>
            </View>
            <TextInput style={styles.modalInput} placeholder="Group Name" placeholderTextColor="#9CA3AF" value={newGroupName} onChangeText={setNewGroupName} />
            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleCreateGroup}>
              {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isJoinModalOpen} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Join Group</Text>
              <TouchableOpacity onPress={() => setIsJoinModalOpen(false)}><Ionicons name="close" size={24} color="#1F2937" /></TouchableOpacity>
            </View>
            <TextInput style={[styles.modalInput, { textAlign: 'center', fontSize: 20, letterSpacing: 5 }]} placeholder="CODE" placeholderTextColor="#9CA3AF" autoCapitalize="characters" maxLength={6} value={joinCodeInput} onChangeText={setJoinCodeInput} />
            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleJoinGroup}>
              {isSubmitting ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Join</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* TAKE QUIZ MODAL */}
      <Modal visible={isQuizModalOpen} animationType="slide">
        <TakeQuiz 
          quizTitle={quizToTake?.title || 'Quiz'}
          questions={quizToTake?.questions.map((q: any) => ({
            id: q.id,
            question: q.question_text,
            type: (quizToTake.quiz_type || 'Multiple Choice') as any,
            options: q.options,
            correct_answer: q.correct_answer
          })) || []}
          onFinish={(score) => {
            setIsQuizModalOpen(false);
            setQuizToTake(null);
          }}
          onClose={() => {
            setIsQuizModalOpen(false);
            setQuizToTake(null);
          }}
        />
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#F9FAFB' },
  
  // Standard header padding used with SafeAreaView
  header: { backgroundColor: '#6D28D9', paddingTop: 20, paddingBottom: 24, paddingHorizontal: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: 'white' },
  headerSubtitle: { fontSize: 12, color: '#DDD6FE', marginTop: 2 },
  
  tabsContainer: { flexDirection: 'row', backgroundColor: '#F9FAFB', paddingHorizontal: 16, paddingTop: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#6D28D9' },
  tabText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  tabTextActive: { color: '#6D28D9', fontWeight: '700' },
  content: { flex: 1 },

  // Inbox Styles 
  inboxContainer: { paddingTop: 8 },
  inboxActions: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  inboxBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3E8FF', paddingVertical: 8, borderRadius: 10, gap: 6 },
  inboxBtnText: { color: '#6D28D9', fontWeight: '600', fontSize: 13 },
  inboxRow: { flexDirection: 'row', padding: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', alignItems: 'center' },
  inboxAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#6D28D9', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  inboxAvatarText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  inboxDetails: { flex: 1 },
  inboxRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  inboxName: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 },
  inboxTime: { fontSize: 11, color: '#6B7280' },
  inboxPreview: { fontSize: 13, color: '#6B7280' },

  chatHeader: { backgroundColor: '#6D28D9', paddingTop: 16, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 4 },
  chatHeaderTitleBox: { flex: 1, alignItems: 'center' },
  chatHeaderTitle: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  chatHeaderSubtitle: { color: '#DDD6FE', fontSize: 11, marginTop: 2 },
  chatArea: { flex: 1, backgroundColor: '#F3F4F6' },
  
  messageWrapper: { marginBottom: 16, maxWidth: '80%' },
  messageMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: { fontSize: 10, color: '#6B7280', marginBottom: 4, marginLeft: 4 },
  messageBubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe: { backgroundColor: '#6D28D9', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: 'white', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#E5E7EB' },
  messageText: { fontSize: 14, lineHeight: 20 },
  messageTime: { fontSize: 9, color: '#9CA3AF', marginTop: 4 },

  actionMenuContainer: { backgroundColor: 'white', paddingVertical: 16, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-start', flexWrap: 'wrap', gap: 12 },
  actionBtn: { alignItems: 'center', width: '22%', marginBottom: 12 },
  actionIconBox: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  actionBtnText: { fontSize: 10, color: '#4B5563', fontWeight: '500', textAlign: 'center' },
  
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  plusButton: { padding: 4, marginRight: 6 },
  textInputWrapper: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 20, paddingHorizontal: 14,maxHeight: 100 },
  textInput: { fontSize: 14, color: '#1F2937' },
  sendButton: { backgroundColor: '#6D28D9', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginLeft: 8, marginBottom: 2 },

  itemsList: { paddingHorizontal: 16, paddingBottom: 20, paddingTop: 16 },
  card: { backgroundColor: 'white', borderRadius: 14, padding: 14, marginBottom: 14, elevation: 1, borderWidth: 1, borderColor: '#F3F4F6' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  colorDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  subjectBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  subjectText: { fontSize: 11, color: '#6B7280', fontWeight: '500' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 6 },
  
  metaInfo: { flexDirection: 'row', gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  statusIcon: { justifyContent: 'center', paddingLeft: 12 },
  
  progressSection: { marginBottom: 14 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  progressPercent: { fontSize: 12, color: '#111827', fontWeight: '600' },
  progressBar: { height: 6, backgroundColor: '#F3F4F6', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  
  badgesRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  badgePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: 'white' },
  badgePillText: { fontSize: 10, color: '#4B5563', fontWeight: '600' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: 'white', borderRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  modalInput: { backgroundColor: '#F3F4F6', borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 16 },
  modalSubmitBtn: { backgroundColor: '#6D28D9', padding: 14, borderRadius: 10, alignItems: 'center' },

  // 🌟 UPGRADED SETTINGS UI STYLES 
  bigAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#6D28D9', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  bigAvatarText: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  settingsGroupName: { fontSize: 20, fontWeight: 'bold', color: '#1F2937' },
  settingsGroupDesc: { fontSize: 13, color: '#6B7280', marginTop: 4, textAlign: 'center', paddingHorizontal: 20 },
  adminBadge: { backgroundColor: '#FEE2E2', color: '#EF4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, fontSize: 11, fontWeight: 'bold', marginTop: 8, overflow: 'hidden' },
  
  settingsSection: { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E5E7EB', marginTop: 16 },
  settingsSectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  settingsDesc: { fontSize: 12, color: '#6B7280', marginBottom: 16 },
  codeBox: { flexDirection: 'row', backgroundColor: '#1F2937', borderRadius: 10, padding: 4, alignItems: 'center' },
  codeText: { flex: 1, color: 'white', fontSize: 20, letterSpacing: 4, textAlign: 'center', fontWeight: 'bold' },
  copyBtn: { backgroundColor: '#6D28D9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' },

  settingsOptionsBlock: { marginTop: 16, backgroundColor: '#F9FAFB', borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 16 },
  settingsOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  settingsOptionIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  settingsOptionText: { flex: 1, fontSize: 15, fontWeight: '500', color: '#1F2937' },

  takeQuizBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#7C3AED', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, gap: 4, alignSelf: 'center' },
  takeQuizBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
});