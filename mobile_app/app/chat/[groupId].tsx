import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator, Alert, Modal, Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import firestore from '@react-native-firebase/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/config/api';
import { getToken, getCurrentUser } from '@/services/authService';
import { getFirebaseUid } from '@/services/firebaseAuthService';
import { palette as COLORS, fontFamily as FONTS } from '@/constants/theme';

interface StudyGroup {
  id: number;
  name: string;
  description: string;
  members_count: number;
  join_code: string;
  created_by: number;
}

// Normalized message shape: Firestore docs, REST responses, and optimistic
// echoes all flow through mapMessage().
interface GroupMessage {
  id: string;
  text: string;
  sender_uid: string | null;
  sender_name: string;
  created_at: number | string | null; // ISO string (REST) or ms/µs epoch (Firestore)
  local?: boolean; // true while this is an unsent optimistic echo
}

type RawMessage = Partial<Omit<GroupMessage, 'created_at'>> & {
  id: string | number;
  created_at?: GroupMessage['created_at'];
};

// Firestore may deliver ms or µs depending on platform; REST delivers ISO strings.
function toTimestamp(created_at: GroupMessage['created_at']): number | null {
  if (created_at == null) return null;
  if (typeof created_at === 'number') {
    return created_at > 1e14 ? created_at / 1000 : created_at;
  }
  const parsed = new Date(created_at).getTime();
  return isNaN(parsed) ? null : parsed;
}

function formatTime(created_at: GroupMessage['created_at']): string {
  const ms = toTimestamp(created_at);
  if (!ms) return '';
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Accepts REST GET, REST POST, and Firestore snapshot docs alike.
function mapMessage(raw: RawMessage): GroupMessage {
  return {
    id: String(raw.id),
    text: raw.text ?? '',
    sender_uid: raw.sender_uid ?? null,
    sender_name: raw.sender_name || 'Member',
    created_at: raw.created_at ?? null,
    local: raw.local,
  };
}

// Merge server messages with any still-unsent optimistic echoes. A local echo
// is dropped as soon as the server copy (same sender + text) shows up.
function mergeMessages(prev: GroupMessage[], incoming: GroupMessage[]): GroupMessage[] {
  const unsyncedLocal = prev.filter(m => m.local).filter(m =>
    !incoming.some(f => f.sender_uid === m.sender_uid && f.text === m.text),
  );
  return [...incoming, ...unsyncedLocal];
}

export default function GroupChatScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const insets = useSafeAreaInsets();

  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(true);

  const scrollViewRef = useRef<ScrollView>(null);
  const chatUnsubscribeRef = useRef<(() => void) | null>(null);

  const scrollToEnd = useCallback((animated = false) => {
    // Let content layout settle instead of relying on fixed timeouts.
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // Load group metadata (from my-groups list) + current user + our Firebase uid
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [user, token, storedUid] = await Promise.all([
          getCurrentUser(), getToken(), getFirebaseUid(),
        ]);
        if (cancelled) return;
        setCurrentUser(user);

        // Messages identify senders by firebase_uid. Prefer the profile's
        // firebase_uid; fall back to the uid cached at Firebase sign-in.
        const uid = user?.firebase_uid || storedUid || null;
        setMyUid(uid);

        const res = await fetch(`${API_BASE_URL}/users/groups/mine/`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const myGroups: StudyGroup[] = await res.json();
          const found = myGroups.find(g => String(g.id) === String(groupId)) || null;
          if (cancelled) return;
          setGroup(found);
          if (!found) {
            Alert.alert('Group Not Found', 'This study group is no longer available.');
            router.back();
          }
        }
      } catch (err) {
        console.error('Failed to load group info:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, router]);

  // Initial messages + Firestore realtime subscription
  useEffect(() => {
    if (!groupId) return;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/chat/`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const initialMsgs: GroupMessage[] = (await res.json()).map(mapMessage);
          setMessages(prev => mergeMessages(prev, initialMsgs));
          scrollToEnd(false);
        }
      } catch (err) {
        console.error('Failed to load initial messages:', err);
      }
    })();

    try {
      const unsub = firestore()
        .collection('studyGroups')
        .doc(String(groupId))
        .collection('messages')
        .orderBy('created_at', 'asc')
        .onSnapshot(snapshot => {
          if (!snapshot) return;
          const firestoreMsgs: GroupMessage[] = snapshot.docs.map(doc => {
            const data = doc.data();
            // v24 SDK returns created_at as a firestore Timestamp object.
            const ts = data?.created_at;
            const createdAt =
              typeof ts?.toMillis === 'function' ? ts.toMillis()
              : typeof ts === 'number' ? ts
              : null;
            return mapMessage({
              id: doc.id,
              text: data?.text,
              sender_uid: data?.sender_uid,
              sender_name: data?.sender_name,
              created_at: createdAt,
            });
          });

          setMessages(prev => mergeMessages(prev, firestoreMsgs));
          scrollToEnd(true);
        }, error => {
          console.error('Firestore Chat Subscription Error:', error);
        });

      chatUnsubscribeRef.current = unsub;
    } catch (err) {
      console.error('Failed to initialize firestore listener:', err);
    }

    return () => {
      if (chatUnsubscribeRef.current) {
        chatUnsubscribeRef.current();
        chatUnsubscribeRef.current = null;
      }
    };
  }, [groupId, scrollToEnd]);

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const textToSend = chatInput.trim();
    setChatInput('');

    const tempMsg: GroupMessage = {
      id: `local-${Date.now()}`,
      text: textToSend,
      sender_uid: myUid,
      sender_name: currentUser?.first_name || 'Me',
      created_at: Date.now(),
      local: true,
    };
    setMessages(prev => [...prev, tempMsg]);
    scrollToEnd(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text: textToSend }),
      });
      if (res.ok) {
        const realMsg = mapMessage(await res.json());
        // Replace the echo with the server copy; dedupes against the
        // Firestore snapshot that lands moments later.
        setMessages(prev => prev.map(m => (m.id === tempMsg.id ? realMsg : m)));
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const copyToClipboard = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Haptics.selectionAsync();
    Alert.alert('Code Copied!', 'The join code has been copied to your clipboard.');
  };

  const isAdmin = currentUser?.id === group?.created_by;

  const renderMessage = (msg: GroupMessage, index: number) => {
    const isMe = msg.sender_uid != null && msg.sender_uid === myUid;
    const prev = messages[index - 1];
    const showSender = !isMe && (!prev || prev.sender_uid !== msg.sender_uid);

    return (
      <View key={msg.id} style={[styles.messageWrapper, isMe ? styles.messageMe : styles.messageOther]}>
        {showSender && <Text style={styles.senderName}>{msg.sender_name}</Text>}
        <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          <Text style={[styles.messageText, isMe ? { color: 'white' } : { color: COLORS.textDark }]}>{msg.text}</Text>
        </View>
        <Text style={styles.messageTime}>{formatTime(msg.created_at)}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} />

      {/* Chat Header */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.chatHeader, { paddingTop: insets.top + 10 }]}
      >
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }} accessibilityLabel="Back to groups">
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.chatHeaderTitleBox}>
          <Text style={styles.chatHeaderTitle} numberOfLines={1}>{group?.name || 'Group Chat'}</Text>
          <Text style={styles.chatHeaderSubtitle}>{group?.members_count ?? '—'} members</Text>
        </View>
        <TouchableOpacity onPress={() => setIsSettingsOpen(true)} style={{ padding: 4 }} accessibilityLabel="Group settings">
          <Ionicons name="settings-outline" size={22} color="white" />
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        onContentSizeChange={() => scrollToEnd(false)}
      >
        {messages.map(renderMessage)}
      </ScrollView>

      {isActionMenuOpen && (
        <View style={styles.actionMenuContainer}>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('Coming Soon', 'File sharing is on the roadmap.')}>
              <View style={[styles.actionIconBox, { backgroundColor: COLORS.purplePrimary }]}><Ionicons name="document-text" size={20} color="white" /></View>
              <Text style={styles.actionBtnText}>File</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('Coming Soon', 'Photo sharing is on the roadmap.')}>
              <View style={[styles.actionIconBox, { backgroundColor: COLORS.success }]}><Ionicons name="image" size={20} color="white" /></View>
              <Text style={styles.actionBtnText}>Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.inputContainer, { paddingBottom: Math.max(12, insets.bottom) }]}>
        <TouchableOpacity onPress={() => setIsActionMenuOpen(!isActionMenuOpen)} style={styles.plusButton} accessibilityLabel="More actions">
          <Ionicons name={isActionMenuOpen ? 'close' : 'add'} size={28} color={COLORS.purpleDeep} />
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
          disabled={!chatInput.trim()}
          accessibilityLabel="Send message"
        >
          <Ionicons name="send" size={16} color="white" />
        </TouchableOpacity>
      </View>

      {/* Group Settings Modal */}
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
                <View style={styles.bigAvatar}>
                  <Text style={styles.bigAvatarText}>{(group?.name || 'G').substring(0, 2).toUpperCase()}</Text>
                </View>
                <Text style={styles.settingsGroupName}>{group?.name}</Text>
                <Text style={styles.settingsGroupDesc}>{group?.description || 'No description provided.'}</Text>
                {isAdmin && <Text style={styles.adminBadge}>Admin</Text>}
              </View>
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Invite Members</Text>
                <Text style={styles.settingsDesc}>Share this secret code with classmates so they can join.</Text>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{group?.join_code}</Text>
                  <TouchableOpacity style={styles.copyBtn} onPress={() => group && copyToClipboard(group.join_code)}>
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
                <TouchableOpacity style={[styles.settingsOptionRow, { borderBottomWidth: 0 }]} onPress={() => group && copyToClipboard(group.join_code)}>
                  <View style={styles.settingsOptionIcon}><Ionicons name="copy-outline" size={20} color={COLORS.textDark} /></View>
                  <Text style={styles.settingsOptionText}>Copy Invite Code</Text>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  loadingContainer: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },

  chatHeader: { paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 4 },
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
  actionIconBox: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  actionBtnText: { fontSize: 11, color: COLORS.textDark, fontFamily: FONTS.medium, textAlign: 'center' },

  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  plusButton: { padding: 6, marginRight: 8, backgroundColor: COLORS.bgSecondary, borderRadius: 20, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  textInputWrapper: { flex: 1, backgroundColor: COLORS.bg, borderRadius: 20, paddingHorizontal: 16, maxHeight: 100, borderWidth: 1, borderColor: COLORS.border },
  textInput: { fontSize: 15, color: COLORS.textDark, fontFamily: FONTS.regular, paddingVertical: 8 },
  sendButton: { backgroundColor: COLORS.purplePrimary, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 8, marginBottom: 2, shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textDark },

  bigAvatar: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 12, backgroundColor: COLORS.purpleVibrant, shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
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
