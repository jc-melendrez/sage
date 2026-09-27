import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Modal, LayoutAnimation, Platform, UIManager, Alert, StatusBar, KeyboardAvoidingView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from '@ronradtke/react-native-markdown-display';
import { pickDocument, pickImage, readAsBase64, describeFileError, isImageUri, SUPPORTED_LABEL, SUPPORTED_IMAGE_LABEL, type PickedDocument } from '@/services/fileUpload';

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
  /**
   * Name of the document or photo the user sent with this turn. The server
   * stores it, so reloading a conversation shows the attachment chip again
   * instead of a bare answer with no trace of what prompted it.
   */
  fileName?: string;
  fileMime?: string;
  fileSize?: number | null;
}

interface ChatSession {
  id: number;
  title: string;
  pinned?: boolean;
  updated_at?: string;
}

/**
 * Pinned conversations first, then most recently updated. The server already
 * orders this way, but pinning or unpinning only patched one row locally, so
 * the list did not move until the next reload.
 */
function sortSessionsPinnedFirst(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.id - b.id;
  });
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
  const [attachedFile, setAttachedFile] = useState<PickedDocument | null>(null);

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
        setSessions(sortSessionsPinnedFirst(data));
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

  /** PATCH a chat session, surfacing server errors instead of failing silently. */
  const patchSession = async (
    sessionId: number,
    body: Record<string, unknown>,
  ): Promise<{ id: number; title: string; pinned: boolean }> => {
    const token = await getToken();
    const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'Could not update this conversation.');
    }
    return res.json();
  };

  const handlePinSession = async (sessionId: number, currentlyPinned: boolean) => {
    closeMenu();
    try {
      const data = await patchSession(sessionId, { pinned: !currentlyPinned });
      setSessions(prev => {
        // The server keeps at most one pin, so applying its answer to *all*
        // rows is what mirrors reality: previously whatever was pinned before
        // stayed pinned here, so the list showed two pins until a reload.
        const next = prev.map(s => ({ ...s, pinned: s.id === sessionId ? data.pinned : false }));
        return sortSessionsPinnedFirst(next);
      });
    } catch (err) {
      console.error('Failed to pin session:', err);
      Alert.alert('Could not pin', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const startRenameSession = (sessionId: number, currentTitle: string) => {
    setEditingSessionId(sessionId);
    setEditTitle(currentTitle);
    closeMenu();
  };

  const saveRenameSession = async (sessionId: number) => {
    const nextTitle = editTitle.trim();
    // Always leave edit mode, even when the title is unchanged or blank —
    // otherwise the row stays stuck as a text input.
    setEditingSessionId(null);
    setEditTitle('');
    if (!nextTitle) return;
    try {
      const data = await patchSession(sessionId, { title: nextTitle });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: data.title } : s));
    } catch (err) {
      console.error('Failed to rename session:', err);
      Alert.alert('Could not rename', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const deleteSession = async (sessionId: number) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Could not delete this conversation.');
      }
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        startNewChat();
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      Alert.alert('Could not delete', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const handleDeleteSession = (sessionId: number) => {
    closeMenu();
    Alert.alert(
      'Delete Chat',
      'Are you sure you want to delete this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteSession(sessionId) },
      ],
    );
  };

  // 4. Send Message
  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputValue).trim();
    if (isLoading || isTyping) return;
    // A bare attachment is a valid prompt; the server knows to just read it.
    if (!textToSend && !attachedFile) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    resetUserScrolled();

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      // No typed text means the chip alone represents the turn.
      text: textToSend,
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      fileName: attachedFileName || undefined,
      fileMime: attachedFile?.mimeType || undefined,
      fileSize: attachedFile?.size ?? null,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // 🌟 Capture the file locally and clear state immediately
    const fileToProcess = attachedFile;
    setAttachedFile(null);
    setAttachedFileName(null);

    // Base64 the file and let the server decide what to do with it. Doing the
    // reading client-side meant we could only ever read .txt, and every other
    // document reached the model as nothing but a filename. Photos go to the
    // vision model; the server routes on MIME.
    let filePayload: { name: string; data: string; mime?: string } | null = null;
    if (fileToProcess) {
      try {
        filePayload = {
          name: fileToProcess.name,
          data: await readAsBase64(fileToProcess.uri),
          mime: fileToProcess.mimeType || undefined,
        };
      } catch (err) {
        console.error("File read failed:", err);
        filePayload = null;
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
          message: textToSend,
          file: filePayload,
          session_id: activeSessionId
        })
      });

      if (!response.ok) {
        // The API returns { error } for bad uploads; surface that instead of
        // dumping raw JSON into the chat bubble.
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'The assistant could not process that request.');
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
      // Prefer the message the server sent (e.g. the friendly "save as .docx"
      // note for legacy uploads) over a generic "backend is down" line that
      // sends users chasing a server that is actually running fine.
      const detail = error instanceof Error && error.message
        ? error.message
        : "Sorry, I couldn't reach the server. Make sure your Django backend is running the latest code!";
      setMessages((prev) => [...prev, {
        id: Date.now() + 1,
        type: 'ai',
        text: detail,
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      }]);
    } finally {
      setIsLoading(false);
      setIsTyping(false);
      setAttachedFileName(null);
      setAttachedFile(null); // Clear the attachment after sending
    }
  };

  // 5. Attach study material for the AI to read
  const handleFileUpload = async () => {
    try {
      const file = await pickDocument();
      if (!file) return;

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAttachedFile(file);
      setAttachedFileName(file.name);
    } catch (err) {
      console.error("File processing error:", err);
      Alert.alert("Unsupported file", describeFileError(err));
    }
  };

  // Photos go to a vision model, which is a different server path from
  // documents. Sharing one button would have sent photos down the text
  // extractor, where they came out as mojibake.
  const handlePhotoPick = async () => {
    try {
      const photo = await pickImage();
      if (!photo) return;

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAttachedFile(photo);
      setAttachedFileName(photo.name);
    } catch (err) {
      console.error("Photo picker error:", err);
      Alert.alert("Can't attach photo", describeFileError(err));
    }
  };

  // Long-press the paperclip for photos, tap for documents.
  const handleAttachmentMenu = () => {
    Alert.alert('Attach', 'What do you want to send?', [
      { text: `Document (${SUPPORTED_LABEL})`, onPress: handleFileUpload },
      { text: `Photo (${SUPPORTED_IMAGE_LABEL})`, onPress: handlePhotoPick },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const clearAttachment = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAttachedFile(null);
    setAttachedFileName(null);
  };

  // An attachment is enough on its own — "summarise this" with no typed
  // prompt is a valid ask, so sending must not require text.
  const busy = isLoading || isTyping;
  const canSend = !!inputValue.trim() || !!attachedFile;

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
                      onPress={() => {
                        // Tapping the row opens the chat — but not while the
                        // 3-dots sheet is up or the row is being renamed.
                        if (isEditing || menuSessionId !== null) return;
                        closeMenu();
                        loadHistory(session.id);
                      }}
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

                      {/* The legacy "Old Chat History" bucket is a virtual
                          row with no database row behind it, so pin/rename/
                          delete would 404. Hide the control entirely. */}
                      {session.id !== 0 ? (
                        <TouchableOpacity
                          style={styles.sessionMenuButton}
                          onPress={() => toggleMenu(session.id)}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="ellipsis-horizontal" size={22} color={isActive ? "rgba(255,255,255,0.7)" : COLORS.textMuted} />
                        </TouchableOpacity>
                      ) : null}
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

          {/* Chat 3-dots menu — an in-tree overlay, NOT a nested <Modal>.
              Android drops a second Modal on top of another, which is why
              Pin/Rename/Delete silently did nothing. */}
          {menuSessionId !== null && (() => {
            const session = sessions.find((s) => s.id === menuSessionId);
            if (!session) return null;
            return (
              <Pressable style={styles.menuSheetOverlay} onPress={closeMenu}>
                <Pressable style={styles.menuSheetCard} onPress={() => {}}>
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
                </Pressable>
              </Pressable>
            );
          })()}
        </View>
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
              {message.type === 'user' && message.fileName && (
                <View style={styles.messageFileChip}>
                  <Ionicons
                    name={
                      (message.fileMime || '').startsWith('image/')
                        ? 'image-outline'
                        : 'document-text-outline'
                    }
                    size={14}
                    color="white"
                  />
                  <Text style={styles.messageFileName} numberOfLines={1}>
                    {message.fileName}
                  </Text>
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
                <Ionicons
                  name={isImageUri(attachedFileName) ? 'image' : 'document'}
                  size={14}
                  color="white"
                />
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
            onPress={handleAttachmentMenu} 
            style={styles.attachButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Attach a document or photo"
          >
            <Ionicons name="attach" size={24} color={COLORS.purpleVibrant} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handlePhotoPick}
            style={styles.attachButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo for SAGE to look at"
          >
            <Ionicons name="camera-outline" size={23} color={COLORS.purpleVibrant} />
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
              { backgroundColor: !canSend || busy ? COLORS.surface : COLORS.purplePrimary }
            ]} 
            onPress={() => handleSend()} 
            disabled={!canSend || busy}
            activeOpacity={0.8}
          >
            <Ionicons 
              name="send" 
              size={18} 
              color={!canSend || busy ? COLORS.textMuted : 'white'} 
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
    flexDirection: 'row',
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

  // Attachment chip inside a sent message bubble
  messageFileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  messageFileName: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: 'white',
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
  // Absolute, not flex:1. modalOverlay is a row, so a flex child here would
  // steal width from the 80% sidebar and squeeze the sheet into a thin strip.
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