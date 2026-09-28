import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Modal, LayoutAnimation, Platform, UIManager, Alert, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import { notify } from '@/services/notify';
import {
  pickDocument,
  pickImage,
  readAsBase64,
  describeFileError,
  type PickedDocument,
  type PickedImage,
} from '@/services/fileUpload';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from '@ronradtke/react-native-markdown-display';

// 🌟 Enable Layout Animations for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Pinned chats first, then newest first within each group. The server returns
 * sessions already in this order, but pinning and deleting both rewrite the
 * list locally, so re-sorting is what stops a newly pinned chat from staying
 * wherever it happened to be.
 */
function sortSessionsPinnedFirst<T extends { pinned?: boolean; updated_at?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
  });
}

/** Pull the server's own error text out of a failed response. */
async function describeFailure(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return data?.error || data?.detail || fallback;
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
  // Set from the history endpoint's file_name/file_mime/file_size. Absent for
  // turns sent without an attachment, and for the optimistic copy we push
  // locally right after the user hits send.
  fileName?: string;
  fileMime?: string;
  fileSize?: number | null;
}

interface ChatSession {
  id: number;
  title: string;
  pinned?: boolean;
}

export type AIAssistantVariant = 'student' | 'educator';

interface QuickAction {
  id: number;
  label: string;
  icon: string;
  color: string;
  prompt?: string;
}

const STUDENT_QUICK_ACTIONS: QuickAction[] = [
  { id: 1, label: 'Study Plan', icon: 'book', color: COLORS.warning },
  { id: 2, label: 'Set Goals', icon: 'flag', color: COLORS.success },
  { id: 3, label: 'Schedule', icon: 'calendar', color: COLORS.purplePrimary },
  { id: 4, label: 'Progress', icon: 'trending-up', color: '#F97316' },
];

const EDUCATOR_QUICK_ACTIONS: QuickAction[] = [
  { id: 1, label: 'Lesson Ideas', icon: 'bulb', color: COLORS.warning, prompt: 'Generate lesson ideas for my class' },
  { id: 2, label: 'Quiz Generator', icon: 'help-circle', color: COLORS.success, prompt: 'Help me create a quiz for my students' },
  { id: 3, label: 'Student Insights', icon: 'stats-chart', color: COLORS.purplePrimary, prompt: 'Give me insights on how my students are doing' },
  { id: 4, label: 'Class Roster', icon: 'people', color: '#F97316', prompt: 'Help me manage my class roster' },
];

const QUICK_ACTIONS: Record<AIAssistantVariant, QuickAction[]> = {
  student: STUDENT_QUICK_ACTIONS,
  educator: EDUCATOR_QUICK_ACTIONS,
};

const GREETINGS: Record<AIAssistantVariant, string> = {
  student: "Hi! I'm your SAGE AI assistant. Let's start a new topic. How can I help?",
  educator: "Hi! I'm your SAGE AI assistant. Ask me about your classes, lessons, or students.",
};

/**
 * The history endpoint speaks Django's snake_case (file_name, file_mime,
 * file_size) while Message -- and the chip that renders it -- is camelCase.
 * The rows used to be dropped in untouched, so a reloaded conversation lost
 * every attachment label and the user could not tell which document a given
 * turn was about. Normalise here rather than renaming at both use sites.
 */
function mapHistoryRow(row: any): Message {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    time: row.time,
    fileName: row.file_name || undefined,
    fileMime: row.file_mime || undefined,
    fileSize: row.file_size ?? null,
  };
}

export default function AIAssistantScreen({ variant }: { variant: AIAssistantVariant }) {
  const scrollViewRef = useRef<ScrollView>(null);
  const userScrolledRef = useRef(false);
  // Set by loadHistory before it commits the populated message list. Opening a
  // thread renders twice -- once empty, once full -- and the empty pass's
  // scroll events otherwise leave userScrolledRef stuck true, so the populated
  // pass never scrolls and a long thread opens part-way down.
  const pendingHistoryScrollRef = useRef(false);

  // --- Multi-Thread State ---
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  
  // Session menu & inline edit state
  const [menuSessionId, setMenuSessionId] = useState<number | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // The row the 3-dots menu is currently anchored to, plus the button's measured
  // window coords. The menu is a single instance positioned against these, so
  // the tapped row's title/pinned state has to be held here rather than read
  // from the render closure that opened it.
  const [menuAnchor, setMenuAnchor] = useState<{ id: number; title: string; pinned: boolean } | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<{ x: number; y: number; y2: number; w: number } | null>(null);
  const menuButtonRefs = useRef<Record<number, View | null>>({});
  
  // --- Message State ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<PickedDocument | PickedImage | null>(null);

  const quickActions = QUICK_ACTIONS[variant];

  // A newly opened thread has to land at the newest message even though the
  // ScrollView still holds the previous thread's offset. `scrollToEnd` is a
  // no-op while the old content is still laid out, so the offset is zeroed
  // first and the scroll is retried on the next layout pass.
  const scrollToBottom = (animated: boolean, force = false) => {
    if (!force && userScrolledRef.current) return;
    const sv = scrollViewRef.current;
    if (!sv) return;
    requestAnimationFrame(() => {
      sv.scrollToEnd({ animated });
    });
  };

  const handleScroll = (event: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const isAtBottom = contentOffset.y >= contentSize.height - layoutMeasurement.height - 50;
    userScrolledRef.current = !isAtBottom;
  };

  const handleContentSizeChange = () => {
    if (pendingHistoryScrollRef.current) {
      pendingHistoryScrollRef.current = false;
      userScrolledRef.current = false;
      scrollToBottom(false, true);
      return;
    }
    scrollToBottom(true);
  };

  const resetUserScrolled = () => {
    userScrolledRef.current = false;
  };

  // Send is live when there is something to say or something attached.
  const sendDisabled = isLoading || isTyping || (!inputValue.trim() && !attachedFile);

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
    // Drop the previous thread's scroll position. Without this the new thread
    // inherits it, so switching from a long chat to a short one opened
    // mid-thread or on a blank area.
    scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    setMessages([]);
    
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/history/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const history = await res.json();
        // Flag before the populated render commits, so the layout pass that
        // finally has content is the one that scrolls.
        pendingHistoryScrollRef.current = true;
        setMessages(history.map(mapHistoryRow));
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
      text: GREETINGS[variant],
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }]);
    setIsMenuVisible(false);
  };

  // Session Menu Actions

  // Sidebar/panel geometry for placing the single dropdown. Measured lazily
  // rather than hardcoded: the modal is 80% width and the header height depends
  // on the platform safe-area padding, so a magic `top: 50` cannot be correct
  // for more than the one row it happened to be tuned against.
  const [panelLayout, setPanelLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const MENU_W = 140;
  const MENU_H = 146;   // 3 items + padding + the Delete separator
  const MENU_GAP = 6;

  /**
   * Open the 3-dots menu for a session, anchored to that row's button.
   *
   * `measureInWindow` gives window coords; the dropdown is absolutely
   * positioned inside the sidebar panel, so the window origin is subtracted
   * back out. When the button sits too low for the menu to fit beneath it, the
   * menu flips above instead of being clipped.
   */
  const openMenu = (sessionId: number) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (menuSessionId === sessionId) {
      closeMenu();
      return;
    }

    const node = menuButtonRefs.current[sessionId];
    // A missing ref means this row has not been laid out yet. Bail rather than
    // falling back: opening unpositioned would drop the menu at 0,0, which reads
    // as "the 3 dots don't work" just as much as not opening at all.
    if (!node) return;

    node.measureInWindow((x, y, w, h) => {
      setMenuAnchorRect({ x, y, y2: y + h, w });
      setMenuAnchor({ id: sessionId, title: session.title, pinned: !!session.pinned });
      setMenuSessionId(sessionId);
    });
  };

  const closeMenu = () => {
    setMenuSessionId(null);
    setMenuAnchor(null);
    setMenuAnchorRect(null);
  };

  // Derived placement for the single dropdown.
  const menuTop = (() => {
    if (!menuAnchorRect) return 0;
    const relY = menuAnchorRect.y - panelLayout.y;
    const relBottom = menuAnchorRect.y2 - panelLayout.y;
    const below = relBottom + MENU_GAP;
    if (below + MENU_H <= panelLayout.height) return below;
    // Flip above the button, but never push it off the top of the panel.
    return Math.max(relY - MENU_GAP - MENU_H, 4);
  })();

  const menuLeft = (() => {
    if (!menuAnchorRect) return 0;
    // Right-align to the button's right edge (that is where the ellipsis is),
    // then keep the whole menu inside the panel.
    const relX = menuAnchorRect.x - panelLayout.x;
    const max = Math.max(4, panelLayout.width - MENU_W - 4);
    return Math.min(Math.max(relX + menuAnchorRect.w - MENU_W, 4), max);
  })();

  /**
   * The backend is the single source of truth for pinning: only one session
   * can be pinned, so mirroring `data.pinned` across the list is what keeps
   * the list consistent with the server instead of leaving two rows claiming
   * to be pinned.
   */
  const handlePinSession = async (sessionId: number, currentlyPinned: boolean) => {
    closeMenu();
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pinned: !currentlyPinned }),
      });
      if (!res.ok) throw new Error(await describeFailure(res, 'Could not update that chat.'));
      const data = await res.json();
      const serverPinnedId: number | null = data.pinned ? sessionId : null;
      setSessions(prev =>
        sortSessionsPinnedFirst(
          prev.map(s => ({ ...s, pinned: s.id === serverPinnedId })),
        ),
      );
    } catch (err) {
      console.error('Failed to pin session:', err);
      notify('Pin failed', err instanceof Error ? err.message : 'Could not update that chat.');
    }
  };

  const startRenameSession = (sessionId: number, currentTitle: string) => {
    setEditingSessionId(sessionId);
    setEditTitle(currentTitle);
    closeMenu();
  };

  const saveRenameSession = async (sessionId: number) => {
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      notify('Title required', 'A chat needs a name.');
      return;
    }
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (!res.ok) throw new Error(await describeFailure(res, 'Could not rename that chat.'));
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: nextTitle } : s)));
    } catch (err) {
      console.error('Failed to rename session:', err);
      notify('Rename failed', err instanceof Error ? err.message : 'Could not rename that chat.');
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
              if (!token) throw new Error('Please sign in again.');
              const res = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) throw new Error(await describeFailure(res, 'Could not delete that chat.'));
              setSessions(prev => prev.filter(s => s.id !== sessionId));
              if (activeSessionId === sessionId) {
                startNewChat();
              }
              notify('Chat deleted', 'The conversation was removed.');
            } catch (err) {
              console.error('Failed to delete session:', err);
              notify('Delete failed', err instanceof Error ? err.message : 'Could not delete that chat.');
            }
          },
        },
      ],
    );
  };

  // 4. Send Message
  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || inputValue;
    // A turn with only an attachment is valid -- the endpoint accepts it
    // ("explain this"). Requiring text meant picking a document and tapping
    // send did nothing at all.
    if ((!textToSend.trim() && !attachedFile) || isLoading || isTyping) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    resetUserScrolled();

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      text: textToSend.trim(),
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      // Carry the staged filename onto the optimistic copy so the chip shows
      // up immediately; history re-supplies it after a reload.
      fileName: attachedFileName ?? undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // 🌟 Capture the file locally and clear state immediately
    const fileToProcess = attachedFile;
    setAttachedFile(null);
    setAttachedFileName(null);

    // Send the real bytes. This used to build a "[FILE ATTACHED] Name: ..."
    // placeholder string, so a DOCX reached the model as its own filename and
    // the assistant had nothing to actually read. The endpoint takes
    // `{ name, mime, data }` with base64 `data` and does its own extraction.
    let filePayload: { name: string; mime: string; data: string } | null = null;
    if (fileToProcess) {
      try {
        filePayload = {
          name: fileToProcess.name,
          // Documents can report no MIME (Android often says
          // application/octet-stream); the server falls back to the extension,
          // so an empty string is the right "unknown" here.
          mime: fileToProcess.mimeType ?? '',
          data: await readAsBase64(fileToProcess.uri),
        };
      } catch (err) {
        console.error('Attachment read failed:', err);
        notify('Attachment failed', describeFileError(err));
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
          file: filePayload,
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
  const attach = async (kind: 'photo' | 'document') => {
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      if (kind === 'photo') {
        const image = await pickImage();
        if (!image) return;
        setAttachedFile(image);
        setAttachedFileName(image.name);
        return;
      }
      const doc = await pickDocument();
      if (!doc) return;
      setAttachedFile(doc);
      setAttachedFileName(doc.name);
    } catch (err) {
      console.error('File processing error:', err);
      Alert.alert('Unsupported file', describeFileError(err));
    }
  };

  const handleFileUpload = () => {
    Alert.alert('Attach', 'Add something for SAGE to read.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo', onPress: () => attach('photo') },
      { text: 'Document', onPress: () => attach('document') },
    ]);
  };

  const clearAttachment = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAttachedFile(null);
    setAttachedFileName(null);
  };

  return (
    <KeyboardSafeView
      style={styles.container}
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
          <View
            style={styles.modalContent}
            onLayout={(e) => {
              const { x, y, width, height } = e.nativeEvent.layout;
              setPanelLayout({ x, y, width, height });
            }}
          >
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
                const isMenuOpen = menuSessionId === session.id;

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
                        ref={(r) => { menuButtonRefs.current[session.id] = r; }}
                        style={styles.sessionMenuButton}
                        onPress={(e) => { e.stopPropagation(); openMenu(session.id); }}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={22} color={isActive ? "rgba(255,255,255,0.7)" : COLORS.textMuted} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            {/*
              The 3-dots menu is rendered HERE, as a single instance on top of
              the session list, not once per row inside it.

              Rendering it per-row put the dropdown inside a ScrollView item, and
              that could not work: `menuOverlay` was an absolute fill of
              `sessionItemWrapper`, which is only one row tall, so a 3-item
              ~138px dropdown overflowed its own overlay by ~70px; and RN
              `zIndex` cannot lift a nested child above a *later sibling of its
              ancestor*, so every row below the tapped one painted over the
              bottom of the menu. Delete was the bottom item, which is why Pin
              and Rename sometimes worked and Delete did not.

              One menu on top of the list has no such neighbour to fight, and its
              position comes from the tapped button's measured coords.
            */}
            {menuSessionId !== null && menuAnchor && (
              <>
                <TouchableOpacity
                  style={styles.menuBackdrop}
                  onPress={closeMenu}
                  activeOpacity={1}
                  accessibilityLabel="Close menu"
                />
                <View
                  style={[
                    styles.menuDropdown,
                    {
                      top: menuTop,
                      left: menuLeft,
                    },
                  ]}
                >
                  <TouchableOpacity style={styles.menuItem} onPress={() => handlePinSession(menuSessionId, menuAnchor?.pinned || false)} activeOpacity={0.7}>
                    <Ionicons name={menuAnchor?.pinned ? "pin-outline" : "pin"} size={18} color={COLORS.textPrimary} style={styles.menuItemIcon} />
                    <Text style={styles.menuItemText}>{menuAnchor?.pinned ? 'Unpin' : 'Pin'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={() => startRenameSession(menuSessionId, menuAnchor?.title || '')} activeOpacity={0.7}>
                    <Ionicons name="create-outline" size={18} color={COLORS.textPrimary} style={styles.menuItemIcon} />
                    <Text style={styles.menuItemText}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => handleDeleteSession(menuSessionId)} activeOpacity={0.7}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.danger} style={styles.menuItemIcon} />
                    <Text style={[styles.menuItemText, { color: COLORS.danger }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
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
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onLayout={() => {
          // The sidebar modal is often still dismissing when the new thread
          // lays out, so the first scroll attempt lands before the viewport
          // has its final height. Retry once the layout settles.
          if (pendingHistoryScrollRef.current) scrollToBottom(false, true);
        }}
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
              {message.fileName && (
                <View style={styles.msgAttachment}>
                  <Ionicons name="document" size={12} color={COLORS.purpleVibrant} />
                  <Text style={styles.msgAttachmentName} numberOfLines={1}>
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
                      handleSend(action.prompt ?? `Help me with my ${action.label.toLowerCase()}`);
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
              { backgroundColor: sendDisabled ? COLORS.surface : COLORS.purplePrimary }
            ]}
            onPress={() => handleSend()}
            disabled={sendDisabled}
            activeOpacity={0.8}
          >
            <Ionicons
              name="send"
              size={18}
              color={sendDisabled ? COLORS.textMuted : 'white'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
    </KeyboardSafeView>
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
  // Filename chip for an attachment that was sent in this turn. Sits above the
  // body so a reloaded thread still shows which document a question was about
  // -- without it the only trace of the upload is the AI's reply.
  msgAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
    maxWidth: '100%',
  },
  msgAttachmentName: {
    flexShrink: 1,
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.bg,
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
  // The 3-dots menu backdrop. Covers the whole panel so a tap anywhere else
  // dismisses the menu, and sits behind it so it never steals the item taps.
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  menuDropdown: {
    position: 'absolute',
    // Must outrank menuBackdrop (zIndex 20). RN resolves zIndex between
    // siblings, not by document order: a child with zIndex 0 still paints
    // *under* a sibling at zIndex 20. Without this the menu rendered behind the
    // full-panel backdrop, every tap on Pin/Rename/Delete landed on the
    // backdrop instead, and the menu just closed again -- which is exactly the
    // "the 3 dots don't work" symptom.
    zIndex: 21,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
    width: 140,
    // Android stacks on elevation, and the backdrop already sets 20.
    elevation: 21,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuItemIcon: { width: 24 },
  menuItemText: { fontSize: 14, fontFamily: FONTS.medium, fontWeight: '600', color: COLORS.textPrimary },
  menuItemDanger: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4, paddingTop: 16 },
});
