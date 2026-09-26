import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Modal, LayoutAnimation, Platform, UIManager, Alert, StatusBar, KeyboardAvoidingView, Pressable } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from '@ronradtke/react-native-markdown-display';

// 🌟 Enable Layout Animations for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 🎨 Unified Purple Palette
const COLORS = {
  bg: '#FFFFFF',
  bgSecondary: '#F4F2FA',
  surface: '#FFFFFF',
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
  textSecondary: '#CBD5E1',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

// 🎨 Markdown styles for SAGE AI replies — mirrored to the app theme
const markdownStyles = StyleSheet.create({
  body: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  text: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.regular,
    fontSize: 14,
  },
  paragraph: {
    marginTop: 2,
    marginBottom: 6,
  },
  heading1: { fontSize: 21, fontFamily: FONTS.extraBold, color: COLORS.purpleDeep, marginTop: 12, marginBottom: 6 },
  heading2: { fontSize: 18, fontFamily: FONTS.extraBold, color: COLORS.purpleDeep, marginTop: 10, marginBottom: 4 },
  heading3: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.purpleDeep, marginTop: 10, marginBottom: 4 },
  heading4: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.purpleDeep, marginTop: 8, marginBottom: 4 },
  heading5: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.purpleDeep, marginTop: 8, marginBottom: 3 },
  heading6: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.purpleDeep, marginTop: 6, marginBottom: 3 },
  strong: { fontFamily: FONTS.bold },
  em: { fontFamily: FONTS.medium, fontStyle: 'italic' },
  s: { textDecorationLine: 'line-through' },
  link: { color: COLORS.purplePrimary, textDecorationLine: 'underline' },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.purpleLight,
    backgroundColor: COLORS.bgSecondary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginVertical: 8,
  },
  code_inline: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: COLORS.purpleDark,
    backgroundColor: COLORS.bgSecondary,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  code_block: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgSecondary,
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  fence: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgSecondary,
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { marginBottom: 4 },
  bullet_list_icon: { color: COLORS.purplePrimary, fontFamily: FONTS.bold, fontSize: 14 },
  ordered_list_icon: { color: COLORS.purplePrimary, fontFamily: FONTS.bold, fontSize: 14 },
  hr: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth * 2,
    marginVertical: 12,
  },
  tableHeaderCell: { fontFamily: FONTS.bold, color: COLORS.purpleDeep },
  tableCell: { fontFamily: FONTS.regular, color: COLORS.textPrimary },
});

interface Message {
  id: number;
  type: 'user' | 'ai';
  text: string;
  time: string;
}

interface ChatSession {
  id: number;
  title: string;
  pinned?: boolean;
}

export default function AIAssistantScreen() {
  const scrollViewRef = useRef<ScrollView>(null);
  const userScrolledRef = useRef(false);

  // --- Multi-Thread State ---
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  
  // Session menu & inline edit state
  const [menuSessionId, setMenuSessionId] = useState<number | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  
  // --- Message State ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<any>(null);

  const handleScroll = (event: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const isAtBottom = contentOffset.y >= contentSize.height - layoutMeasurement.height - 50;
    userScrolledRef.current = !isAtBottom;
  };

  const handleContentSizeChange = () => {
    if (!userScrolledRef.current) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  };

  const resetUserScrolled = () => {
    userScrolledRef.current = false;
  };

  const quickActions = [
    { id: 1, label: 'Study Plan', icon: 'book', color: COLORS.warning },
    { id: 2, label: 'Set Goals', icon: 'flag', color: COLORS.success },
    { id: 3, label: 'Schedule', icon: 'calendar', color: COLORS.purplePrimary }, 
    { id: 4, label: 'Progress', icon: 'trending-up', color: '#F97316' },
  ];

  // 1. Load Sessions on Startup
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
        if (data.length > 0 && !activeSessionId) {
          loadHistory(data[0].id);
        } else if (data.length === 0) {
          startNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to load sessions", err);
    }
  };

  // 2. Load a Specific Chat Thread
  const loadHistory = async (sessionId: number) => {
    setActiveSessionId(sessionId);
    setIsMenuVisible(false);
    resetUserScrolled();
    setMessages([]); 
    
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/history/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const history = await res.json();
        setMessages(history);
      }
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  // 3. Start a Blank Canvas
  const startNewChat = () => {
    setActiveSessionId(null); 
    resetUserScrolled();
    setMessages([{
      id: 1,
      type: 'ai',
      text: "Hi! I'm your SAGE AI assistant. Let's start a new topic. How can I help?",
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }]);
    setIsMenuVisible(false);
  };

  // Session Menu Actions
  const toggleMenu = (sessionId: number) => {
    setMenuSessionId(menuSessionId === sessionId ? null : sessionId);
  };

  const closeMenu = () => {
    setMenuSessionId(null);
  };

  const handlePinSession = async (sessionId: number, currentlyPinned: boolean) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pinned: !currentlyPinned }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, pinned: data.pinned } : s));
      }
    } catch (err) {
      console.error('Failed to pin session:', err);
    }
    closeMenu();
  };

  const startRenameSession = (sessionId: number, currentTitle: string) => {
    setEditingSessionId(sessionId);
    setEditTitle(currentTitle);
    closeMenu();
  };

  const saveRenameSession = async (sessionId: number) => {
    if (!editTitle.trim()) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      if (res.ok) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: editTitle.trim() } : s));
      }
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    setEditingSessionId(null);
    setEditTitle('');
  };

  const handleDeleteSession = async (sessionId: number) => {
    closeMenu();
    Alert.alert(
      'Delete Chat',
      'Are you sure you want to delete this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getToken();
              const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                  startNewChat();
                }
              }
            } catch (err) {
              console.error('Failed to delete session:', err);
            }
          },
        },
      ],
    );
  };

  // 4. Send Message
  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || inputValue;
    if (!textToSend.trim() || isLoading || isTyping) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    resetUserScrolled();

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      text: textToSend.trim(),
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // 🌟 Capture the file locally and clear state immediately
    const fileToProcess = attachedFile;
    setAttachedFile(null);
    setAttachedFileName(null);

    let extractedText = "";
    if (fileToProcess) {
      try {
        if (fileToProcess.mimeType === 'text/plain') {
          extractedText = await FileSystem.readAsStringAsync(fileToProcess.uri);
        } else {
          extractedText = `[FILE ATTACHED]\nName: ${fileToProcess.name}\nType: ${fileToProcess.mimeType}\nSize: ${fileToProcess.size} bytes`;
        }
      } catch (err) {
        console.error("Text extraction failed:", err);
      }
    }

    const THINKING_MIN_MS = 650;
    const thinkingStartedAt = Date.now();
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/ai/ask/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          message: textToSend.trim(),
          attachment_text: extractedText,
          session_id: activeSessionId 
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const data = await response.json();
      
      // If this was a brand new chat, Django just created an ID for it. Save it!
      if (!activeSessionId && data.session_id) {
        setActiveSessionId(data.session_id);
        loadSessions(); 
      }

      // --- Show the full reply immediately (no typing animation) ---
      const aiMessageId = Date.now() + 1;
      const fullReply = data.reply || '';

      // Keep the "thinking" indicator visible long enough to be noticed,
      // even when the backend answers almost instantly.
      const elapsed = Date.now() - thinkingStartedAt;
      if (elapsed < THINKING_MIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, THINKING_MIN_MS - elapsed));
      }

      // Switch from "thinking" to showing the reply so the indicator hides.
      setIsLoading(false);

      // Add the full AI reply in one go
      setMessages((prev) => [...prev, {
        id: aiMessageId,
        type: 'ai',
        text: fullReply || "Sorry, I didn't get a response. Please try again.",
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      }]);

    } catch (error) {
      console.error("AI Chat Error:", error);
      setMessages((prev) => [...prev, {
        id: Date.now() + 1,
        type: 'ai',
        text: "Sorry, I couldn't reach the server. Make sure your Django backend is running the latest code!",
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      }]);
    } finally {
      setIsLoading(false);
      setIsTyping(false);
      setAttachedFileName(null);
      setAttachedFile(null); // Clear the attachment after sending
    }
  };

  // 5. Handle File Upload and Text Extraction
  const handleFileUpload = async () => {
    try {
      // Select the file from the device
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAttachedFile(file);
      setAttachedFileName(file.name);
    } catch (err) {
      console.error("File processing error:", err);
      Alert.alert("Error", "Could not process the selected file.");
    }
  };

  const clearAttachment = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAttachedFile(null);
    setAttachedFileName(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      contentContainerStyle={{ flex: 1 }}
    >
    <LinearGradient
      colors={['#FFFFFF', '#FFFFFF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity 
            onPress={() => setIsMenuVisible(true)} 
            style={styles.menuButton}
            activeOpacity={0.7}
          >
            <Ionicons name="menu" size={26} color="white" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>SAGE AI</Text>
            <Text style={styles.headerSubtitle}>
              {activeSessionId ? "Active Session" : "New Conversation"}
            </Text>
          </View>
        </View>
        <TouchableOpacity 
          onPress={startNewChat} 
          style={styles.newChatHeaderBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={22} color="white" />
        </TouchableOpacity>
      </LinearGradient>

      {/* 🌟 Sidebar Modal */}
      <Modal visible={isMenuVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient
              colors={[COLORS.purpleDeep, COLORS.purpleDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.modalHeader}
            >
              <Text style={styles.modalTitle}>Chat History</Text>
              <TouchableOpacity 
                onPress={() => setIsMenuVisible(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color="white" />
              </TouchableOpacity>
            </LinearGradient>

            <TouchableOpacity 
              style={[styles.newChatButton, { marginTop: 16 }]} 
              onPress={startNewChat}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.newChatButtonGradient}
              >
                <Ionicons name="add" size={20} color="white" />
                <Text style={styles.newChatText}>Start New Chat</Text>
              </LinearGradient>
            </TouchableOpacity>

            <ScrollView style={styles.sessionList} showsVerticalScrollIndicator={false}>
              {sessions.map(session => {
                const isActive = activeSessionId === session.id;
                const isEditing = editingSessionId === session.id;

                return (
                  <View key={session.id} style={styles.sessionItemWrapper}>
                    <TouchableOpacity 
                      style={[
                        styles.sessionItem, 
                        isActive && styles.activeSessionItem
                      ]}
                      onPress={() => !isEditing && !isMenuOpen && loadHistory(session.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.sessionIconBox,
                        isActive && styles.activeSessionIconBox
                      ]}>
                        <Ionicons 
                          name="chatbubble" 
                          size={18} 
                          color={isActive ? "white" : COLORS.purpleVibrant} 
                        />
                      </View>
                      
                      {isEditing ? (
                        <TextInput
                          style={[styles.sessionText, isActive && styles.activeSessionText, styles.editInput]}
                          value={editTitle}
                          onChangeText={setEditTitle}
                          onBlur={() => saveRenameSession(session.id)}
                          onSubmitEditing={() => saveRenameSession(session.id)}
                          autoFocus
                          maxLength={100}
                        />
                      ) : (
                        <View style={styles.sessionContent}>
                          <View style={styles.sessionTitleRow}>
                            {session.pinned && (
                              <Ionicons name="pin" size={14} color={isActive ? "white" : COLORS.warning} style={styles.pinIcon} />
                            )}
                            <Text 
                              style={[styles.sessionText, isActive && styles.activeSessionText]} 
                              numberOfLines={1}
                            >
                              {session.title}
                            </Text>
                          </View>
                        </View>
                      )}

                      <TouchableOpacity
                        style={styles.sessionMenuButton}
                        onPress={(e) => { e.stopPropagation(); toggleMenu(session.id); }}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={22} color={isActive ? "rgba(255,255,255,0.7)" : COLORS.textMuted} />
                      </TouchableOpacity>

                      {isActive && !isEditing && (
                        <View style={styles.activeIndicator}>
                          <View style={styles.activeDot} />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <TouchableOpacity 
            style={styles.modalCloseArea} 
            onPress={() => setIsMenuVisible(false)} 
          />
        </View>
      </Modal>

      {/* Chat 3-dots menu — modal action sheet (Pin / Rename / Delete) */}
      <Modal
        visible={menuSessionId !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <Pressable style={styles.menuSheetOverlay} onPress={closeMenu}>
          <Pressable style={styles.menuSheetCard} onPress={() => {}}>
            {(() => {
              const session = sessions.find((s) => s.id === menuSessionId);
              if (!session) return null;
              return (
                <>
                  <Text style={styles.menuSheetTitle} numberOfLines={2}>{session.title}</Text>
                  <TouchableOpacity style={styles.menuSheetRow} onPress={() => handlePinSession(session.id, session.pinned || false)} activeOpacity={0.7}>
                    <Ionicons name={session.pinned ? "pin-outline" : "pin"} size={20} color={COLORS.textPrimary} style={styles.menuSheetIcon} />
                    <Text style={styles.menuSheetRowText}>{session.pinned ? 'Unpin' : 'Pin'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuSheetRow} onPress={() => startRenameSession(session.id, session.title)} activeOpacity={0.7}>
                    <Ionicons name="create-outline" size={20} color={COLORS.textPrimary} style={styles.menuSheetIcon} />
                    <Text style={styles.menuSheetRowText}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.menuSheetRow, styles.menuSheetDanger]} onPress={() => handleDeleteSession(session.id)} activeOpacity={0.7}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.danger} style={styles.menuSheetIcon} />
                    <Text style={[styles.menuSheetRowText, { color: COLORS.danger }]}>Delete</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Messages Scroll Area */}
      <ScrollView 
        ref={scrollViewRef} 
        style={styles.messagesContainer} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.messagesContent}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
      >
        {messages.map((message) => (
          <View 
            key={message.id} 
            style={[
              styles.messageWrapper, 
              message.type === 'user' ? styles.userMessageWrapper : styles.aiMessageWrapper
            ]}
          >
            <View style={[
              styles.messageBubble, 
              message.type === 'user' 
                ? styles.userMessage 
                : styles.aiMessage
            ]}>
              {message.type === 'ai' && (
                <View style={styles.aiMessageHeader}>
                  <LinearGradient
                    colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.aiIconBox}
                  >
                    <Ionicons name="sparkles" size={14} color="white" />
                  </LinearGradient>
                  <Text style={styles.aiLabel}>SAGE AI</Text>
                </View>
              )}
              {message.type === 'ai' ? (
                <Markdown style={markdownStyles}>{message.text}</Markdown>
              ) : (
                <Text style={[styles.messageText, styles.userMessageText]}>
                  {message.text}
                </Text>
              )}
              <Text style={[
                styles.messageTime, 
                message.type === 'user' ? styles.userMessageTime : styles.aiMessageTime
              ]}>
                {message.time}
              </Text>
            </View>
          </View>
        ))}
        
        {isLoading && (
          <View style={[styles.messageWrapper, styles.aiMessageWrapper]}>
            <View style={[styles.messageBubble, styles.aiMessage, styles.typingBubble]}>
              <View style={styles.typingIndicator}>
                <ActivityIndicator size="small" color={COLORS.purpleVibrant} />
                <Text style={styles.typingText}>SAGE AI is thinking...</Text>
              </View>
            </View>
          </View>
        )}

        {messages.length === 1 && !isLoading && !isTyping && (
          <View style={styles.quickActionsContainer}>
            <Text style={styles.quickActionsTitle}>Suggested Topics</Text>
            <View style={styles.quickActionsGrid}>
              {quickActions.map((action) => (
                <TouchableOpacity 
                  key={action.id} 
                  style={styles.quickActionButton}
                  onPress={() => {
                    setTimeout(() => {
                      handleSend(`Help me with my ${action.label.toLowerCase()}`);
                    }, 250);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: `${action.color}15` }]}>
                    <Ionicons name={action.icon as any} size={24} color={action.color} />
                  </View>
                  <Text style={styles.quickActionLabel}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input Area */}
      <View style={styles.inputContainer}>
        {attachedFileName && (
          <View style={styles.attachmentPreview}>
            <View style={styles.attachmentBadge}>
              <LinearGradient
                colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.attachmentIcon}
              >
                <Ionicons name="document" size={14} color="white" />
              </LinearGradient>
              <Text style={styles.attachmentName} numberOfLines={1}>{attachedFileName}</Text>
              <TouchableOpacity onPress={clearAttachment} style={styles.removeAttachment}>
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.inputBox}>
          <TouchableOpacity 
            onPress={handleFileUpload} 
            style={styles.attachButton}
            activeOpacity={0.7}
          >
            <Ionicons name="attach" size={24} color={COLORS.purpleVibrant} />
          </TouchableOpacity>
          <View style={styles.inputField}>
            <TextInput 
              style={styles.input} 
              placeholder="Ask me anything..." 
              placeholderTextColor={COLORS.textMuted} 
              value={inputValue} 
              onChangeText={setInputValue} 
              onSubmitEditing={() => handleSend()} 
              editable={!isLoading && !isTyping}
              multiline
            />
          </View>
          <TouchableOpacity 
            style={[
              styles.sendButton, 
              { backgroundColor: isLoading || isTyping || !inputValue.trim() ? COLORS.surface : COLORS.purplePrimary }
            ]} 
            onPress={() => handleSend()} 
            disabled={isLoading || isTyping || !inputValue.trim()}
            activeOpacity={0.8}
          >
            <Ionicons 
              name="send" 
              size={18} 
              color={isLoading || isTyping || !inputValue.trim() ? COLORS.textMuted : 'white'} 
            />
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  headerContent: { 
    flexDirection: 'row', 
    gap: 14, 
    alignItems: 'center' 
  },
sessionMenuButton: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  headerTitle: { 
    fontSize: 22, 
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
    letterSpacing: -0.5,
  },
  headerSubtitle: { 
    fontSize: 12, 
    fontFamily: FONTS.medium,
    color: COLORS.purplePale,
    marginTop: 2,
  },
  newChatHeaderBtn: { 
    backgroundColor: 'rgba(255,255,255,0.2)', 
    padding: 10, 
    borderRadius: 14,
  },
  
  // Sidebar Styles
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    flexDirection: 'row' 
  },
  modalContent: { 
    backgroundColor: COLORS.surface,
    width: '80%', 
    height: '100%', 
    borderTopRightRadius: 28, 
    borderBottomRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  modalCloseArea: { 
    flex: 1
  },
  modalHeader: { 
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: { 
    fontSize: 22, 
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
  },
  newChatButton: { 
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  newChatButtonGradient: {
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: 16, 
    gap: 10,
  },
  newChatText: { 
    color: 'white', 
    fontFamily: FONTS.bold,
    fontWeight: '700',
    fontSize: 16,
  },
  sessionList: { 
    flex: 1,
    paddingHorizontal: 16,
  },
  sessionItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    marginBottom: 8,
    borderRadius: 16,
    gap: 12,
    backgroundColor: COLORS.bgSecondary,
  },
  activeSessionItem: { 
    backgroundColor: COLORS.purplePrimary,
  },
  sessionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeSessionIconBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  sessionText: { 
    fontSize: 15, 
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary, 
    flex: 1,
  },
  activeSessionText: { 
    color: 'white', 
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  activeIndicator: {
    marginLeft: 4,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },

  // Messages
  messagesContainer: { 
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 20, 
    paddingVertical: 16, 
    paddingBottom: 20,
  },
  messageWrapper: { 
    marginBottom: 16, 
    flexDirection: 'row' 
  },
  userMessageWrapper: { 
    justifyContent: 'flex-end' 
  },
  aiMessageWrapper: { 
    justifyContent: 'flex-start' 
  },
  messageBubble: { 
    maxWidth: '85%', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderRadius: 20,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  userMessage: { 
    borderBottomRightRadius: 6,
    backgroundColor: COLORS.purplePrimary,
  },
  aiMessage: { 
    borderBottomLeftRadius: 6,
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typingBubble: {
    minWidth: 120,
  },
  aiMessageHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6, 
    marginBottom: 6 
  },
  aiIconBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiLabel: { 
    fontSize: 11, 
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.purplePrimary,
  },
  messageText: { 
    fontSize: 14, 
    lineHeight: 20,
  },
  userMessageText: {
    color: 'white',
    fontFamily: FONTS.regular,
  },
  aiMessageText: {
    color: COLORS.textPrimary,
    fontFamily: FONTS.regular,
  },
  messageTime: { 
    fontSize: 10, 
    marginTop: 6, 
    alignSelf: 'flex-end',
    fontFamily: FONTS.medium,
  },
  userMessageTime: {
    color: 'rgba(255,255,255,0.7)',
  },
  aiMessageTime: {
    color: COLORS.textMuted,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.medium,
    fontStyle: 'italic',
  },
  
  // Quick Actions
  quickActionsContainer: { 
    marginTop: 32, 
    alignItems: 'center',
    marginBottom: 20,
  },
  quickActionsTitle: { 
    fontSize: 15, 
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textPrimary, 
    marginBottom: 16,
  },
  quickActionsGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    justifyContent: 'center', 
    gap: 12,
  },
  quickActionButton: { 
    alignItems: 'center', 
    width: '45%', 
    paddingVertical: 18, 
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickActionIcon: { 
    width: 52, 
    height: 52, 
    borderRadius: 18, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 10,
  },
  quickActionLabel: { 
    fontSize: 13, 
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },

  // Input Area
  inputContainer: { 
    paddingHorizontal: 20, 
    paddingBottom: Platform.OS === 'ios' ? 30 : 20, 
    paddingTop: 12, 
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  inputBox: { 
    flexDirection: 'row', 
    gap: 10, 
    alignItems: 'flex-end' 
  },
  attachButton: { 
    padding: 8,
    marginBottom: 4,
  },
  inputField: { 
    flex: 1, 
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
  },
  input: { 
    fontSize: 14, 
    fontFamily: FONTS.regular,
    color: COLORS.textPrimary,
    maxHeight: 100,
  },
  sendButton: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    justifyContent: 'center', 
    alignItems: 'center',
    marginBottom: 4,
  },
  
  // Attachment
  attachmentPreview: { 
    marginBottom: 12,
  },
  attachmentBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.bgSecondary,
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 16, 
    alignSelf: 'flex-start', 
    gap: 10, 
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  attachmentIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentName: { 
    fontSize: 13, 
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary, 
    flexShrink: 1,
  },
  removeAttachment: {
    padding: 2,
  },

  // Session item new styles
  sessionItemWrapper: {
    marginBottom: 8,
  },
  sessionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  pinIcon: {
    marginRight: 2,
  },
  editInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.purplePrimary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
  },
  menuButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
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
    color: COLORS.textPrimary,
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
});