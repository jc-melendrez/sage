import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Modal, LayoutAnimation, Platform, UIManager, Alert, StatusBar } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { LinearGradient } from 'expo-linear-gradient';

// 🌟 Enable Layout Animations for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 🎨 Unified Purple Palette
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
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

interface Message {
  id: number;
  type: 'user' | 'ai';
  text: string;
  time: string;
}

interface ChatSession {
  id: number;
  title: string;
}

export default function AIAssistantScreen() {
  const scrollViewRef = useRef<ScrollView>(null);

  // --- Multi-Thread State ---
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  
  // --- Message State ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<any>(null);

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
    setMessages([]); 
    
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/history/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const history = await res.json();
        setMessages(history);
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
      }
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  // 3. Start a Blank Canvas
  const startNewChat = () => {
    setActiveSessionId(null); 
    setMessages([{
      id: 1,
      type: 'ai',
      text: "Hi! I'm your SAGE AI assistant. Let's start a new topic. How can I help?",
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }]);
    setIsMenuVisible(false);
  };

  // 4. Send Message
  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || inputValue;
    if (!textToSend.trim() || isLoading) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      text: textToSend.trim(),
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

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

      // --- Simulated Typing Animation ---
      const aiMessageId = Date.now() + 1;
      const fullReply = data.reply;

      // 1. Add an empty AI message bubble first
      setMessages((prev) => [...prev, {
        id: aiMessageId,
        type: 'ai',
        text: '',
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      }]);

      // 2. Animate the text filling in
      let charIndex = 0;
      const typingInterval = setInterval(() => {
        setMessages((prev) => prev.map(m => 
          m.id === aiMessageId ? { ...m, text: fullReply.substring(0, charIndex + 1) } : m
        ));
        charIndex++;
        
        if (charIndex >= fullReply.length) {
          clearInterval(typingInterval);
        }
        
        // Auto-scroll as the text grows to keep the latest lines visible
        scrollViewRef.current?.scrollToEnd({ animated: false });
      }, 15); // 15ms per character creates a smooth typing feel

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
      setAttachedFileName(null);
      setAttachedFile(null); // Clear the attachment after sending
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
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
    <LinearGradient
      colors={[COLORS.bgSecondary, COLORS.bg]}
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
              style={styles.newChatButton} 
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
              {sessions.map(session => (
                <TouchableOpacity 
                  key={session.id} 
                  style={[
                    styles.sessionItem, 
                    activeSessionId === session.id && styles.activeSessionItem
                  ]}
                  onPress={() => loadHistory(session.id)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.sessionIconBox,
                    activeSessionId === session.id && styles.activeSessionIconBox
                  ]}>
                    <Ionicons 
                      name="chatbubble" 
                      size={18} 
                      color={activeSessionId === session.id ? "white" : COLORS.purpleVibrant} 
                    />
                  </View>
                  <Text 
                    style={[
                      styles.sessionText, 
                      activeSessionId === session.id && styles.activeSessionText
                    ]} 
                    numberOfLines={1}
                  >
                    {session.title}
                  </Text>
                  {activeSessionId === session.id && (
                    <View style={styles.activeIndicator}>
                      <View style={styles.activeDot} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <TouchableOpacity 
            style={styles.modalCloseArea} 
            onPress={() => setIsMenuVisible(false)} 
          />
        </View>
      </Modal>

      {/* Messages Scroll Area */}
      <ScrollView 
        ref={scrollViewRef} 
        style={styles.messagesContainer} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.messagesContent}
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
              <Text style={[
                styles.messageText, 
                message.type === 'user' ? styles.userMessageText : styles.aiMessageText
              ]}>
                {message.text}
              </Text>
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

        {messages.length === 1 && !isLoading && (
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
              editable={!isLoading}
              multiline
            />
          </View>
          <TouchableOpacity 
            style={[
              styles.sendButton, 
              { backgroundColor: isLoading || !inputValue.trim() ? COLORS.surface : COLORS.purplePrimary }
            ]} 
            onPress={() => handleSend()} 
            disabled={isLoading || !inputValue.trim()}
            activeOpacity={0.8}
          >
            <Ionicons 
              name="send" 
              size={18} 
              color={isLoading || !inputValue.trim() ? COLORS.textMuted : 'white'} 
            />
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
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
  menuButton: { 
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
    backgroundColor: COLORS.surface,
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
});