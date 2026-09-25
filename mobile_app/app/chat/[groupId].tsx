import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator, Alert, Modal, Switch, Image, Keyboard,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import firestore from '@react-native-firebase/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/config/api';
import { getToken, getCurrentUser, getCachedUserId } from '@/services/authService';
import { getFirebaseUid } from '@/services/firebaseAuthService';
import { getChatCache, setChatCache, clearChatCache, setCacheUserId } from '@/services/apiCache';
import { getGroupRoster, updateGroup, leaveGroup, GroupMember, JoinRequestMember, removeGroupMember, handleJoinRequest, Attachment, LocalAttachment, uploadGroupAttachment, getAttachmentLink, safeFileName } from '@/services/chatService';
import { pfpSource } from '@/constants/pfps';
import { palette as COLORS, fontFamily as FONTS } from '@/constants/theme';

interface StudyGroup {
  id: string;
  name: string;
  description: string;
  members_count: number;
  join_code: string;
  created_by: string;
  members?: string[];
  privacy?: string;
}

// Normalized message shape: Firestore docs, REST responses, and optimistic
// echoes all flow through mapMessage().
interface GroupMessage {
  id: string;
  text: string;
  sender_uid: string | null;
  sender_name: string;
  created_at: number | string | null; // ISO string (REST) or ms/µs epoch (Firestore)
  reactions: Record<string, string[]>; // emoji -> list of firebase uids
  attachments: Attachment[];
  local?: boolean; // true while this is an unsent optimistic echo
}

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];

// Server-side limit mirrors the 10 MB upload cap (views.py / firestore_service.py).
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

type RawMessage = Partial<Omit<GroupMessage, 'created_at' | 'reactions' | 'attachments'>> & {
  id: string | number;
  created_at?: GroupMessage['created_at'];
  reactions?: Record<string, string[]> | null;
  attachments?: Attachment[] | null;
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
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function isNewDay(prev: GroupMessage | undefined, cur: GroupMessage['created_at']): boolean {
  if (!prev) return true;
  const prevMs = toTimestamp(prev.created_at);
  const curMs = toTimestamp(cur);
  return prevMs == null || curMs == null || !sameDay(prevMs, curMs);
}

function formatDayLabel(created_at: GroupMessage['created_at']): string | null {
  const ms = toTimestamp(created_at);
  if (ms == null) return null;
  const date = new Date(ms);
  const now = new Date();
  const dayMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayMs(now) - dayMs(date)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Accepts REST GET, REST POST, and Firestore snapshot docs alike.
function mapMessage(raw: RawMessage): GroupMessage {
  return {
    id: String(raw.id),
    text: raw.text ?? '',
    sender_uid: raw.sender_uid ?? null,
    sender_name: raw.sender_name || 'Member',
    created_at: raw.created_at ?? null,
    reactions: raw.reactions ?? {},
    attachments: raw.attachments ?? [],
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

function memberInitials(member?: GroupMember | null, name?: string): string {
  const display = member?.display_name || name || '?';
  const parts = display.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return display.substring(0, 2).toUpperCase();
}

function MemberAvatar({
  member,
  name,
  size = 32,
  style,
}: {
  member?: GroupMember | null;
  name?: string;
  size?: number;
  style?: object;
}) {
  const source = pfpSource(member?.avatar);
  const initials = memberInitials(member, name);
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2 }, style]}>
      {source && member?.avatar ? (
        <Image source={source} style={styles.avatarImage} resizeMode="cover" />
      ) : (
        <View style={[{ width: size, height: size, borderRadius: size / 2 }, styles.initialsCircle]}>
          <Text style={[styles.initialsText, { fontSize: size * 0.38 }]}>{initials}</Text>
        </View>
      )}
    </View>
  );
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GroupChatScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const insets = useSafeAreaInsets();
  // Some Android nav bar devices under-report the bottom inset, so when the
  // system reports zero we fall back to an on-screen navigation bar (~48dp) to
  // stop the input from resting on the back/home/recent buttons.
  const bottomInset = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 48 : 0);

  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, GroupMember>>({});
  const [chatInput, setChatInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [peekMember, setPeekMember] = useState<GroupMember | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reactionTarget, setReactionTarget] = useState<GroupMessage | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPrivacy, setEditPrivacy] = useState<'open' | 'private'>('open');
  const [joinRequests, setJoinRequests] = useState<JoinRequestMember[]>([]);
  const [savingGroup, setSavingGroup] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<LocalAttachment[]>([]);
  const [isAttachOpen, setIsAttachOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState('image');
  const [uploading, setUploading] = useState(false);
  const [resolvedLinks, setResolvedLinks] = useState<Record<string, string>>({});
  const [linkErrors, setLinkErrors] = useState<Record<string, boolean>>({});
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const linkCacheRef = useRef<Record<string, string>>({});

  const scrollViewRef = useRef<ScrollView>(null);
  const chatUnsubscribeRef = useRef<(() => void) | null>(null);
  const [keyboardBottom, setKeyboardBottom] = useState(0);

  // Android's edge-to-edge mode (targetSdk 35+) stops resizing the window for
  // the keyboard, so we track its height ourselves and pad the layout up.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardBottom(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardBottom(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }

        // Messages identify senders by firebase_uid. Prefer the profile's
        // firebase_uid; fall back to the uid cached at Firebase sign-in.
        const uid = user?.firebase_uid || storedUid || null;
        setMyUid(uid);

        const [res] = await Promise.all([
          fetch(`${API_BASE_URL}/users/groups/mine/`, {
            headers: { 'Authorization': `Bearer ${token}` },
          }),
          getGroupRoster(String(groupId), token)
            .then(roster => {
              if (roster.members.length > 0) {
                setMembers(roster.members);
                setMemberMap(Object.fromEntries(roster.members.map(m => [m.firebase_uid, m])));
              }
              setJoinRequests(roster.join_requests || []);
            })
            .catch(() => {}),
        ]);
        if (res.ok) {
          const myGroups: StudyGroup[] = await res.json();
          const found = myGroups.find(g => String(g.id) === String(groupId)) || null;
          if (cancelled) return;
          setGroup(found);
          setEditName(found?.name || '');
          setEditDesc(found?.description || '');
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

    // Seed instantly from the local cache (Messenger-style): paint the last
    // conversation + roster immediately, then hydrate behind the scenes.
    (async () => {
      setCacheUserId(await getCachedUserId());
      const cached = getChatCache(String(groupId));
      if (cached) {
        const cachedMsgs = (cached.messages as GroupMessage[]).filter(m => !m.local);
        if (cachedMsgs.length > 0) {
          setMessages(cachedMsgs);
          scrollToEnd(false);
        }
        if (cached.group) {
          const cachedGroup = cached.group as StudyGroup;
          if (cached.privacy) cachedGroup.privacy = cached.privacy;
          setGroup(cachedGroup);
        }
        const cachedMembers = (cached.members as GroupMember[]) || [];
        if (cachedMembers.length > 0) {
          setMembers(cachedMembers);
          setMemberMap(Object.fromEntries(cachedMembers.map(m => [m.firebase_uid, m])));
        }
        const cachedRequests = (cached.join_requests as JoinRequestMember[]) || [];
        if (cachedRequests.length > 0) setJoinRequests(cachedRequests);
      }
    })();

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
              reactions: data?.reactions,
              attachments: data?.attachments,
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

  // Persist the latest conversation + group metadata + roster so the next
  // visit paints instantly from SQLite. Optimistic echoes are never stored —
  // only confirmed, synced messages.
  useEffect(() => {
    if (messages.length === 0 && !group && members.length === 0) return;
    setChatCache(String(groupId), {
      messages: messages.filter(m => !m.local),
      group: group
        ? {
            id: group.id,
            name: group.name,
            description: group.description,
            join_code: group.join_code,
            members_count: group.members_count,
            privacy: group.privacy,
          }
        : null,
      members,
      join_requests: joinRequests,
      privacy: group?.privacy,
    });
  }, [messages, group, members, joinRequests, groupId]);

  // Attachments live in a private S3 bucket. Firestore messages store the S3
  // object key, so before rendering we mint a short-lived presigned URL per
  // key (server verifies group membership; the links expire in ~30 min).
  useEffect(() => {
    if (!groupId) return;
    const keys = new Set<string>();
    messages.forEach(m => (m.attachments || []).forEach(a => {
      if (a.key && !linkCacheRef.current[a.key]) keys.add(a.key);
    }));
    if (keys.size === 0) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const entries = await Promise.all(
          [...keys].map(async (key) => {
            try {
              const url = await getAttachmentLink(String(groupId), token, key);
              return [key, url] as const;
            } catch (err) {
              console.error(`Failed to resolve attachment link ${key}:`, err);
              return [key, null] as const;
            }
          }),
        );
        const next: Record<string, string> = Object.fromEntries(entries.filter(([, u]) => u != null));
        linkCacheRef.current = { ...linkCacheRef.current, ...next };
        setResolvedLinks(prev => ({ ...prev, ...next }));
        const failed = Object.fromEntries(entries.filter(([, u]) => u == null).map(([k]) => [k, true]));
        if (Object.keys(failed).length > 0) {
          setLinkErrors(prev => ({ ...prev, ...failed }));
        }
      } catch (err) {
        console.error('Failed to resolve attachment links:', err);
      }
    })();
  }, [groupId, messages]);

  const resolveUrl = async (att: Attachment): Promise<string | null> => {
    if (att.url) return att.url;
    if (!att.key) return null;
    const cached = linkCacheRef.current[att.key] || resolvedLinks[att.key];
    if (cached) return cached;
    try {
      const token = await getToken();
      if (!token) return null;
      const url = await getAttachmentLink(String(groupId), token, att.key);
      linkCacheRef.current = { ...linkCacheRef.current, [att.key]: url };
      setResolvedLinks(prev => ({ ...prev, [att.key]: url }));
      return url;
    } catch {
      setLinkErrors(prev => ({ ...prev, [att.key!]: true }));
      return null;
    }
  };

  const retryResolve = async (key: string) => {
    if (!key) return;
    const url = await resolveUrl({ key, name: 'attachment', mime: 'application/octet-stream', size: 0 });
    if (!url) {
      Alert.alert("Can't Load File", 'Check your connection and try again.');
    }
  };

  const handleDownload = async (att: Attachment, saveToLibrary: boolean) => {
    const url = await resolveUrl(att);
    if (!url) {
      Alert.alert("Can't Load File", 'Check your connection and try again.');
      return;
    }
    const uid = att.key || att.url || 'file';
    setDownloadingKey(uid);
    try {
      const localUri = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${safeFileName(att.name)}`);
      if (saveToLibrary) {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) {
          Alert.alert('Permission Needed', 'Please allow photo library access to save images.');
          return;
        }
        await MediaLibrary.saveToLibraryAsync(localUri.uri);
        Alert.alert('Saved To Photos', `${att.name} was saved to your photo library.`);
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(localUri.uri, { dialogTitle: att.name });
        } else {
          Alert.alert('Not Supported', 'Sharing is not available on this device.');
        }
      }
    } catch (err) {
      console.error('Download failed:', err);
      Alert.alert('Download Failed', 'Could not download this file. Try again.');
    } finally {
      setDownloadingKey(null);
    }
  };

  const addPendingAttachments = (items: LocalAttachment[]) => {
    const oversized = items.filter(i => i.size > MAX_ATTACHMENT_SIZE);
    if (oversized.length > 0) {
      Alert.alert('File Too Large', `${oversized.length} file(s) skipped — files must be 10 MB or smaller.`);
    }
    const valid = items.filter(i => i.size <= MAX_ATTACHMENT_SIZE);
    if (valid.length === 0) return;
    const room = MAX_ATTACHMENTS - pendingAttachments.length;
    if (room <= 0) {
      Alert.alert('Limit Reached', `You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const accepted = valid.slice(0, room);
    setPendingAttachments(prev => [...prev, ...accepted]);
    if (valid.length > room) {
      Alert.alert('Limit Reached', `Only ${room} more file(s) could be attached this message.`);
    }
  };

  const attachFromLibrary = async () => {
    setIsAttachOpen(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Needed', 'Allow photo library access to attach images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    addPendingAttachments(result.assets.map(asset => ({
      uri: asset.uri,
      name: asset.fileName || `photo-${Date.now()}.jpg`,
      mime: asset.mimeType || (asset.fileName?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'),
      size: asset.fileSize || 0,
    })));
  };

  const takePhoto = async () => {
    setIsAttachOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Needed', 'Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    addPendingAttachments(result.assets.map(asset => ({
      uri: asset.uri,
      name: asset.fileName || `photo-${Date.now()}.jpg`,
      mime: asset.mimeType || 'image/jpeg',
      size: asset.fileSize || 0,
    })));
  };

  const attachDocument = async () => {
    setIsAttachOpen(false);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled || !result.assets) return;
    addPendingAttachments(result.assets.map(doc => ({
      uri: doc.uri,
      name: doc.name || 'file',
      mime: doc.mimeType || 'application/octet-stream',
      size: doc.size || 0,
    })));
  };

  const removePendingAttachment = (uri: string) => {
    setPendingAttachments(prev => prev.filter(a => a.uri !== uri));
  };

  const sendChatMessage = async () => {
    const textToSend = chatInput.trim();
    const pending = pendingAttachments;
    if (!textToSend && pending.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUploading(true);
    setChatInput('');

    const tempMsg: GroupMessage = {
      id: `local-${Date.now()}`,
      text: textToSend,
      sender_uid: myUid,
      sender_name: currentUser?.first_name || 'Me',
      created_at: Date.now(),
      reactions: {},
      // Local file:// URIs preview the echo exactly like the uploaded URLs.
      attachments: pending.map(a => ({ url: a.uri, name: a.name, mime: a.mime, size: a.size })),
      local: true,
    };
    setMessages(prev => [...prev, tempMsg]);
    scrollToEnd(true);

    try {
      const token = await getToken();
      if (!token) return;

      const uploaded: Attachment[] = [];
      for (const att of pending) {
        uploaded.push(await uploadGroupAttachment(String(groupId), token, att));
      }
      setPendingAttachments([]);

      const res = await fetch(`${API_BASE_URL}/users/groups/${groupId}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text: textToSend, attachments: uploaded }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to send message');
      }
      const realMsg = mapMessage(await res.json());
      // Replace the echo with the server copy; dedupes against the
      // Firestore snapshot that lands moments later.
      setMessages(prev => prev.map(m => (m.id === tempMsg.id ? realMsg : m)));
    } catch (err) {
      console.error('Failed to send message:', err);
      Alert.alert('Send Failed', err instanceof Error ? err.message : 'Please try again later.');
      // Restore the attachment picks + text so nothing is lost.
      setPendingAttachments(pending);
      setChatInput(textToSend);
    } finally {
      setUploading(false);
    }
  };

  const toggleReaction = async (msg: GroupMessage, emoji: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReactionTarget(null);
    if (!myUid || msg.local) return;

    // Optimistically flip this emoji's entry for myUid.
    const prevReactions = msg.reactions;
    const nextReactions = { ...prevReactions };
    const uids = nextReactions[emoji] || [];
    nextReactions[emoji] = uids.includes(myUid)
      ? uids.filter(u => u !== myUid)
      : [...uids, myUid];
    if (nextReactions[emoji].length === 0) delete nextReactions[emoji];

    const applyReactions = (r: Record<string, string[]>) =>
      setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, reactions: r } : m)));

    applyReactions(nextReactions);

    try {
      const token = await getToken();
      const res = await fetch(
        `${API_BASE_URL}/users/groups/${groupId}/chat/${msg.id}/reactions/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ emoji }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        // Server map wins (resolves any concurrent toggles).
        applyReactions(data.reactions || {});
      } else {
        applyReactions(prevReactions);
      }
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
      applyReactions(prevReactions);
    }
  };

  const copyToClipboard = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Haptics.selectionAsync();
    Alert.alert('Code Copied!', 'The join code has been copied to your clipboard.');
  };

  const isAdmin = myUid != null && myUid === group?.created_by;
  const currentPrivacy = isAdmin ? editPrivacy : (group?.privacy === 'private' ? 'private' : 'open');

  const openSettings = () => {
    setEditName(group?.name || '');
    setEditDesc(group?.description || '');
    setEditPrivacy(group?.privacy === 'private' ? 'private' : 'open');
    setIsSettingsOpen(true);
  };

  const refreshRoster = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const roster = await getGroupRoster(String(groupId), token);
      setMembers(roster.members);
      setMemberMap(Object.fromEntries(roster.members.map(m => [m.firebase_uid, m])));
      setJoinRequests(roster.join_requests || []);
      setGroup(prev => prev ? { ...prev, privacy: roster.privacy } : prev);
    } catch (err) {
      console.error('Failed to refresh roster:', err);
    }
  }, [groupId]);

  const handleRemoveMember = (member: GroupMember) => {
    const displayName = member.display_name || member.username;
    Alert.alert(
      'Remove Member',
      `Remove ${displayName} from the group? They can rejoin with the invite code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getToken();
              if (!token) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await removeGroupMember(String(groupId), token, member.firebase_uid);
              refreshRoster();
            } catch (err) {
              Alert.alert('Failed', err instanceof Error ? err.message : 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const handleJoinRequestAction = async (req: JoinRequestMember, action: 'approve' | 'reject') => {
    try {
      const token = await getToken();
      if (!token) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await handleJoinRequest(String(groupId), token, req.firebase_uid, action);
      setJoinRequests(prev => prev.filter(r => r.firebase_uid !== req.firebase_uid));
      if (action === 'approve') refreshRoster();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const saveGroupEdit = async () => {
    if (!group || !isAdmin) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('Name Required', 'Please enter a group name.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSavingGroup(true);
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updateGroup(String(group.id), token, {
        name,
        description: editDesc.trim(),
        privacy: editPrivacy,
      });
      setGroup(prev => prev ? { ...prev, ...updated } : prev);
      Alert.alert('Saved', 'Group settings updated.');
    } catch (err) {
      Alert.alert('Update Failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSavingGroup(false);
    }
  };

  const handleLeaveGroup = () => {
    if (!group) return;
    Alert.alert(
      'Leave Group',
      `Leave "${group.name}"? You can rejoin anytime with the invite code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeavingGroup(true);
            try {
              const token = await getToken();
              if (!token) return;
              await leaveGroup(String(group.id), token);
              clearChatCache(String(group.id));
              Alert.alert('Left Group', 'You are no longer a member.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (err) {
              Alert.alert('Failed', err instanceof Error ? err.message : 'Please try again.');
              setLeavingGroup(false);
            }
          },
        },
      ],
    );
  };

  const renderMessage = (msg: GroupMessage, index: number) => {
    const isMe = msg.sender_uid != null && msg.sender_uid === myUid;
    const prev = messages[index - 1];
    const next = messages[index + 1];
    const senderMember = msg.sender_uid ? memberMap[msg.sender_uid] : undefined;
    const reactionEntries = Object.entries(msg.reactions || {}).filter(([, uids]) => uids.length > 0);
    const isGroupStart = !isMe && (!prev || prev.sender_uid !== msg.sender_uid);
    const isGroupEnd = !next || next.sender_uid !== msg.sender_uid;
    const showDayDivider = isNewDay(prev, msg.created_at);
    const dayLabel = formatDayLabel(msg.created_at);

    const renderPills = () =>
      reactionEntries.length > 0 && (
        <View style={[styles.reactionRow, isMe && { justifyContent: 'flex-end' }]}>
          {reactionEntries.map(([emoji, uids]) => {
            const mine = myUid != null && uids.includes(myUid);
            return (
              <TouchableOpacity
                key={emoji}
                style={[styles.reactionPill, mine && styles.reactionPillMine]}
                onPress={() => toggleReaction(msg, emoji)}
                accessibilityLabel={`${emoji} reaction, ${uids.length} ${uids.length === 1 ? 'person' : 'people'}. Tap to toggle.`}
              >
                <Text style={styles.reactionPillEmoji}>{emoji}</Text>
                <Text style={[styles.reactionPillCount, mine && { color: COLORS.purpleVibrant }]}>{uids.length}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );

const renderAttachments = () => {
  if (!msg.attachments || msg.attachments.length === 0) return null;
  return (
    <View style={styles.attachmentList}>
      {msg.attachments.map((att, i) => {
        // Quiz embed attachment
        if (att.type === 'quiz_embed' && att.quiz_id) {
          return (
            <TouchableOpacity
              key={`quiz-${att.quiz_id}`}
              style={styles.quizEmbedCard}
              onPress={() => router.push(`/course/quiz/${att.quiz_id}`)}
              activeOpacity={0.85}
              accessibilityLabel={`Open quiz ${att.title}`}
            >
              <View style={styles.quizEmbedHeader}>
                <Ionicons name="document-text-outline" size={24} color={COLORS.purplePrimary} />
                <Text style={styles.quizEmbedTitle}>{att.title || 'Quiz'}</Text>
              </View>
              <View style={styles.quizEmbedMeta}>
                <Text style={styles.quizEmbedMetaText}>
                  {att.question_count} questions · {att.quiz_type}
                </Text>
              </View>
              <View style={styles.quizEmbedAction}>
                <Text style={styles.quizEmbedActionText}>Take Quiz</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.purplePrimary} />
              </View>
            </TouchableOpacity>
          );
        }

        // Uploaded attachments carry an S3 `key` that needs resolving to a
        // short-lived presigned URL; the optimistic echo carries a local uri.
        const uri = att.key ? resolvedLinks[att.key] : att.url;
        const sourceKey = att.key || att.url || `att-${i}`;
        const failed = att.key ? linkErrors[att.key] : false;
        const downloading = downloadingKey === (att.key || att.url || 'file');
        return isImageMime(att.mime) ? (
          <TouchableOpacity
            key={sourceKey}
            style={styles.attachmentImageWrap}
            onPress={() => {
              if (uri) {
                setLightboxUrl(uri);
                setLightboxName(att.name);
              } else if (failed && att.key) {
                retryResolve(att.key);
              }
            }}
            activeOpacity={0.85}
            accessibilityLabel={failed && !uri ? `Reload attached image ${att.name}` : `View attached image ${att.name}`}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.attachmentImage} resizeMode="cover" />
            ) : failed ? (
              <View style={[styles.attachmentImageWrap, styles.attachmentLoading]}>
                <Ionicons name="refresh" size={20} color={COLORS.purpleVibrant} />
                <Text style={styles.attachmentRetry}>Retry</Text>
              </View>
            ) : (
              <View style={[styles.attachmentImageWrap, styles.attachmentLoading]}>
                <ActivityIndicator size="small" color={COLORS.purpleVibrant} />
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            key={sourceKey}
            style={[styles.attachmentDoc, isMe && { backgroundColor: COLORS.purplePrimary, borderColor: 'rgba(255,255,255,0.2)' }]}
            onPress={() => handleDownload(att, false)}
            activeOpacity={0.7}
            disabled={downloading}
            accessibilityLabel={`Download document ${att.name}`}
          >
            {downloading ? (
              <ActivityIndicator size="small" color={isMe ? 'white' : COLORS.purpleVibrant} />
            ) : (
              <Ionicons name="document-text-outline" size={19} color={isMe ? 'white' : COLORS.purpleVibrant} />
            )}
            <Text style={[styles.attachmentDocName, isMe && { color: 'white' }]} numberOfLines={1}>{att.name}</Text>
            <Text style={[styles.attachmentDocSize, isMe && { color: 'rgba(255,255,255,0.7)' }]}>{formatBytes(att.size)}</Text>
            {!downloading && (
              <Ionicons name="download-outline" size={16} color={isMe ? 'rgba(255,255,255,0.85)' : COLORS.textMuted} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

    return (
      <Fragment key={msg.id}>
        {showDayDivider && dayLabel && (
          <View style={styles.dayDivider}>
            <View style={styles.dayDividerLine} />
            <Text style={styles.dayDividerText}>{dayLabel}</Text>
            <View style={styles.dayDividerLine} />
          </View>
        )}
        <View style={[styles.messageWrapper, isGroupEnd ? null : styles.messageWrapperTight, isMe ? styles.messageMe : styles.messageOther]}>
          {!isMe && (
            <View style={styles.avatarColumn}>
              {isGroupStart && <MemberAvatar member={senderMember} name={msg.sender_name} size={34} />}
            </View>
          )}
          <View style={styles.messageColumn}>
            {isGroupStart && <Text style={styles.senderName}>{msg.sender_name}</Text>}
            <TouchableOpacity
              activeOpacity={0.9}
              onLongPress={() => setReactionTarget(msg)}
              delayLongPress={300}
              accessibilityLabel={`Message from ${isMe ? 'you' : msg.sender_name}. Long press to react.`}
            >
              <View
                style={[
                  styles.messageBubble,
                  isMe ? styles.bubbleMe : styles.bubbleOther,
                  (msg.attachments?.length ?? 0) > 0 ? styles.bubbleMedia : null,
                ]}
              >
                {renderAttachments()}
                {msg.text ? (
                  <Text style={[styles.messageText, isMe ? { color: 'white' } : { color: COLORS.textDark }]}>{msg.text}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
            {renderPills()}
            {isGroupEnd && (
              <Text style={[styles.messageTime, isMe && styles.timeMe]}>
                {msg.local ? 'Sending…' : formatTime(msg.created_at)}
              </Text>
            )}
          </View>
        </View>
      </Fragment>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, Platform.OS === 'android' && { paddingBottom: keyboardBottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      contentContainerStyle={{ flex: 1 }}
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
          <Text style={styles.chatHeaderSubtitle}>
            {loading ? 'Connecting…' : members.length > 0 ? `${members.length} members` : '— members'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setIsMembersOpen(true)} style={styles.headerIconBtn} accessibilityLabel="Group members">
            <Ionicons name="people" size={22} color="white" />
          </TouchableOpacity>
          <TouchableOpacity onPress={openSettings} style={styles.headerIconBtn} accessibilityLabel="Group settings">
            <Ionicons name="settings-outline" size={22} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        onContentSizeChange={() => scrollToEnd(false)}
      >
        {loading && messages.length === 0 ? (
          <View style={styles.chatState}>
            <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.chatState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubbles-outline" size={34} color={COLORS.purpleVibrant} />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>Say hi to your study group</Text>
          </View>
        ) : (
          messages.map(renderMessage)
        )}
      </ScrollView>

      <View style={styles.inputShell}>
        {pendingAttachments.length > 0 && (
          <View style={styles.pendingStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
              {pendingAttachments.map((att, i) => (
                <View key={`${att.uri}-${i}`} style={styles.pendingItem}>
                  {isImageMime(att.mime) ? (
                    <Image source={{ uri: att.uri }} style={styles.pendingImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.pendingDoc}>
                      <Ionicons name="document-text-outline" size={18} color={COLORS.purpleVibrant} />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.pendingRemove}
                    onPress={() => removePendingAttachment(att.uri)}
                    accessibilityLabel={`Remove ${att.name}`}
                  >
                    <Ionicons name="close" size={12} color="white" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
        <View style={[styles.inputContainer, { paddingBottom: 12 + bottomInset }]}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setIsAttachOpen(true)}
            disabled={uploading}
            accessibilityLabel="Attach a file"
          >
            <Ionicons name="add" size={24} color={COLORS.purplePrimary} />
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
            style={[styles.sendButton, (!chatInput.trim() && pendingAttachments.length === 0) && { opacity: 0.5, backgroundColor: COLORS.textMuted }]}
            onPress={sendChatMessage}
            disabled={!chatInput.trim() && pendingAttachments.length === 0}
            accessibilityLabel="Send message"
          >
            {uploading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="send" size={16} color="white" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Group Settings Modal */}
      <Modal visible={isSettingsOpen} animationType="slide" transparent={true} onRequestClose={() => setIsSettingsOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '75%' }]}>
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

              {isAdmin && (
                <View style={styles.settingsSection}>
                  <Text style={styles.settingsSectionTitle}>Edit Group</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Group name"
                    placeholderTextColor={COLORS.textMuted}
                    maxLength={100}
                  />
                  <TextInput
                    style={[styles.editInput, styles.editDescInput]}
                    value={editDesc}
                    onChangeText={setEditDesc}
                    placeholder="Description (optional)"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                    maxLength={500}
                  />
                  <TouchableOpacity
                    style={[styles.saveBtn, savingGroup && { opacity: 0.6 }]}
                    onPress={saveGroupEdit}
                    disabled={savingGroup}
                    activeOpacity={0.8}
                  >
                    {savingGroup ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text style={styles.saveBtnText}>Save Changes</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.settingsOptionsBlock}>
                <TouchableOpacity
                  style={styles.settingsOptionRow}
                  onPress={() => { setIsSettingsOpen(false); setIsMembersOpen(true); }}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsOptionIcon}><Ionicons name="people-outline" size={20} color={COLORS.textDark} /></View>
                  <Text style={styles.settingsOptionText}>Members</Text>
                  <Text style={styles.settingsOptionValue}>{members.length}</Text>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Invite Members</Text>
                <Text style={styles.settingsDesc}>
                  Share this secret code with classmates. {currentPrivacy === 'private' ? 'Joining requires your approval.' : 'Anyone with the code can join instantly.'}
                </Text>
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
                  <View style={styles.settingsOptionIcon}>
                    <Ionicons name={currentPrivacy === 'private' ? 'lock-closed-outline' : 'lock-open-outline'} size={20} color={COLORS.textDark} />
                  </View>
                  <Text style={styles.settingsOptionText}>Private Group</Text>
                  <Text style={styles.settingsOptionValue}>{currentPrivacy === 'private' ? 'Approval required' : 'Anyone with code'}</Text>
                  {isAdmin ? (
                    <Switch
                      value={editPrivacy === 'private'}
                      onValueChange={(v) => setEditPrivacy(v ? 'private' : 'open')}
                      trackColor={{ false: '#D1D5DB', true: COLORS.purpleVibrant }}
                    />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                  )}
                </View>
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

              <TouchableOpacity
                style={[styles.leaveBtn, leavingGroup && { opacity: 0.6 }]}
                onPress={handleLeaveGroup}
                disabled={leavingGroup}
                activeOpacity={0.8}
              >
                {leavingGroup ? (
                  <ActivityIndicator size="small" color={COLORS.danger} />
                ) : (
                  <>
                    <Ionicons name="exit-outline" size={18} color={COLORS.danger} />
                    <Text style={styles.leaveBtnText}>Leave Group</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Members Modal */}
      <Modal visible={isMembersOpen} animationType="slide" transparent={true} onRequestClose={() => setIsMembersOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { minHeight: '55%', maxHeight: '75%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Members ({members.length})</Text>
              <TouchableOpacity onPress={() => setIsMembersOpen(false)}>
                <Ionicons name="close" size={24} color={COLORS.textDark} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {isAdmin && joinRequests.length > 0 && (
                <View style={styles.pendingBlock}>
                  <Text style={styles.pendingTitle}>Pending Requests ({joinRequests.length})</Text>
                  {joinRequests.map(req => (
                    <View key={req.firebase_uid} style={styles.requestRow}>
                      <MemberAvatar name={req.display_name} size={40} />
                      <View style={styles.memberInfo}>
                        <Text style={styles.memberName} numberOfLines={1}>{req.display_name}</Text>
                        <Text style={styles.memberMeta}>Wants to join the group</Text>
                      </View>
                      <TouchableOpacity style={styles.requestApproveBtn} onPress={() => handleJoinRequestAction(req, 'approve')} accessibilityLabel={`Approve ${req.display_name}`}>
                        <Ionicons name="checkmark" size={18} color="white" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.requestRejectBtn} onPress={() => handleJoinRequestAction(req, 'reject')} accessibilityLabel={`Reject ${req.display_name}`}>
                        <Ionicons name="close" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              {members.length === 0 ? (
                <Text style={styles.emptyText}>No members yet. Share the invite code to add some.</Text>
              ) : (
                members.map(member => (
                  <TouchableOpacity
                    key={member.firebase_uid}
                    style={styles.memberRow}
                    onPress={() => setPeekMember(member)}
                    activeOpacity={0.7}
                  >
                    <MemberAvatar member={member} size={44} />
                    <View style={styles.memberInfo}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName} numberOfLines={1}>{member.display_name}</Text>
                        {member.is_you && <Text style={styles.youBadge}>You</Text>}
                        {member.is_admin && <Text style={styles.adminBadgeSmall}>Admin</Text>}
                      </View>
                      <Text style={styles.memberMeta}>Level {member.level} · {member.role === 'superadmin' ? 'Superadmin' : member.role === 'educator' ? 'Educator' : 'Student'}</Text>
                    </View>
                    {isAdmin && !member.is_admin && !member.is_you && (
                      <TouchableOpacity style={styles.removeMemberBtn} onPress={() => handleRemoveMember(member)} accessibilityLabel={`Remove ${member.display_name}`}>
                        <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                      </TouchableOpacity>
                    )}
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Member Profile Peek Modal */}
      <Modal visible={peekMember != null} animationType="fade" transparent={true} onRequestClose={() => setPeekMember(null)}>
        <TouchableOpacity style={styles.peekOverlay} activeOpacity={1} onPress={() => setPeekMember(null)}>
          <View style={styles.peekCard}>
            <MemberAvatar member={peekMember} size={84} />
            <Text style={styles.peekName}>{peekMember?.display_name}</Text>
            <View style={styles.peekBadges}>
              {peekMember?.is_you && <Text style={styles.youBadge}>You</Text>}
              {peekMember?.is_admin && <Text style={styles.adminBadge}>Admin</Text>}
            </View>
            <Text style={styles.peekMeta}>@{peekMember?.username}</Text>
            <Text style={styles.peekMeta}>Level {peekMember?.level}</Text>
            <Text style={styles.peekMeta}>
              {peekMember?.role === 'superadmin' ? 'Superadmin' : peekMember?.role === 'educator' ? 'Educator' : 'Student'}
            </Text>
            <TouchableOpacity style={styles.peekCloseBtn} onPress={() => setPeekMember(null)} activeOpacity={0.8}>
              <Text style={styles.peekCloseText}>Close</Text>
            </TouchableOpacity>
            {isAdmin && peekMember && !peekMember.is_admin && !peekMember.is_you && (
              <TouchableOpacity
                style={styles.peekRemoveBtn}
                onPress={() => { const m = peekMember; setPeekMember(null); handleRemoveMember(m); }}
                activeOpacity={0.8}
              >
                <Ionicons name="remove-circle-outline" size={16} color={COLORS.danger} />
                <Text style={styles.peekRemoveText}>Remove from Group</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reaction Picker */}
      <Modal
        visible={reactionTarget != null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setReactionTarget(null)}
      >
        <TouchableOpacity
          style={styles.reactionOverlay}
          activeOpacity={1}
          onPress={() => setReactionTarget(null)}
        >
          <TouchableOpacity style={styles.reactionSheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.reactionSheetHandle} />
            <Text style={styles.reactionSheetTitle}>
              React to {reactionTarget ? (reactionTarget.sender_uid === myUid ? 'your message' : `${reactionTarget.sender_name || 'this message'}'s message`) : 'message'}
            </Text>
            <View style={styles.reactionSheetRow}>
              {ALLOWED_REACTIONS.map(emoji => {
                const mine = reactionTarget?.reactions?.[emoji]?.includes(myUid ?? '');
                return (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionOption, mine && styles.reactionOptionMine]}
                    onPress={() => reactionTarget && toggleReaction(reactionTarget, emoji)}
                    accessibilityLabel={`React with ${emoji}`}
                  >
                    <Text style={styles.reactionOptionEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                );
              })}
</View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Attach Sheet */}
      <Modal visible={isAttachOpen} animationType="slide" transparent={true} onRequestClose={() => setIsAttachOpen(false)}>
        <TouchableOpacity style={styles.reactionOverlay} activeOpacity={1} onPress={() => setIsAttachOpen(false)}>
          <TouchableOpacity style={styles.reactionSheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.reactionSheetHandle} />
            <Text style={styles.reactionSheetTitle}>Attach a file</Text>
            <View style={styles.attachSheetRow}>
              <TouchableOpacity style={styles.attachOption} onPress={attachFromLibrary} accessibilityLabel="Photos">
                <View style={[styles.attachOptionIcon, { backgroundColor: '#10B981' }]}>
                  <Ionicons name="image-outline" size={22} color="white" />
                </View>
                <Text style={styles.attachOptionText}>Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachOption} onPress={takePhoto} accessibilityLabel="Camera">
                <View style={[styles.attachOptionIcon, { backgroundColor: COLORS.purpleVibrant }]}>
                  <Ionicons name="camera-outline" size={22} color="white" />
                </View>
                <Text style={styles.attachOptionText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachOption} onPress={attachDocument} accessibilityLabel="File">
                <View style={[styles.attachOptionIcon, { backgroundColor: '#3B82F6' }]}>
                  <Ionicons name="document-text-outline" size={22} color="white" />
                </View>
                <Text style={styles.attachOptionText}>File</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Image Lightbox */}
      <Modal visible={lightboxUrl != null} animationType="fade" transparent={true} onRequestClose={() => setLightboxUrl(null)}>
        <TouchableOpacity style={styles.lightbox} activeOpacity={1} onPress={() => setLightboxUrl(null)}>
          {lightboxUrl != null && (
            <Image source={{ uri: lightboxUrl }} style={styles.lightboxImage} resizeMode="contain" />
          )}
          <TouchableOpacity
            style={styles.lightboxDownload}
            activeOpacity={0.8}
            onPress={(e) => {
              e.stopPropagation();
              if (lightboxUrl != null) {
                handleDownload({ url: lightboxUrl, name: lightboxName, mime: 'image/jpeg', size: 0 }, true);
              }
            }}
            accessibilityLabel="Save image to photo library"
          >
            {downloadingKey === 'lightbox' ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="download-outline" size={26} color="white" />
            )}
          </TouchableOpacity>
          <View style={styles.lightboxClose}>
            <Ionicons name="close" size={28} color="white" />
          </View>
        </TouchableOpacity>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconBtn: { padding: 4 },
  chatArea: { flex: 1, backgroundColor: COLORS.bg },

  messageWrapper: { marginBottom: 16, maxWidth: '82%', flexDirection: 'row' },
  messageWrapperTight: { marginBottom: 2 },
  messageMe: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  messageOther: { alignSelf: 'flex-start', justifyContent: 'flex-start' },
  avatarColumn: { width: 40, alignItems: 'center', marginTop: 2 },
  messageColumn: { minWidth: 0, flexShrink: 1 },
  senderName: { fontSize: 11, color: COLORS.textMuted, fontFamily: FONTS.medium, marginBottom: 4, marginLeft: 6 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 999 },
  initialsCircle: { backgroundColor: COLORS.purpleVibrant, justifyContent: 'center', alignItems: 'center' },
  initialsText: { color: 'white', fontFamily: FONTS.bold },
  messageBubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleMe: { backgroundColor: COLORS.purplePrimary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  bubbleMedia: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(76, 29, 149, 0.15)', borderRadius: 12, paddingHorizontal: 0, paddingVertical: 0 },
  messageText: { fontSize: 15, lineHeight: 22, fontFamily: FONTS.regular },
  messageTime: { fontSize: 10, color: COLORS.textMuted, marginTop: 4, fontFamily: FONTS.medium },
  timeMe: { alignSelf: 'flex-end' },

  dayDivider: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginVertical: 12, maxWidth: '85%' },
  dayDividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dayDividerText: { fontSize: 10, color: COLORS.textMuted, fontFamily: FONTS.medium, marginHorizontal: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  chatState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 90 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.bgSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textDark },
  emptySubtitle: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },

  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  reactionPillMine: { borderColor: COLORS.purpleVibrant, backgroundColor: 'rgba(139, 92, 246, 0.08)' },
  reactionPillEmoji: { fontSize: 12 },
  reactionPillCount: { fontSize: 11, color: COLORS.textMuted, marginLeft: 3, fontFamily: FONTS.medium },

  reactionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  peekOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  reactionSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center' },
  reactionSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.borderStrong, marginVertical: 12 },
  reactionSheetTitle: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center', marginBottom: 14 },
  reactionSheetRow: { flexDirection: 'row', gap: 8 },
  reactionOption: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  reactionOptionMine: { backgroundColor: 'rgba(139, 92, 246, 0.15)' },
  reactionOptionEmoji: { fontSize: 26 },

  inputShell: { backgroundColor: COLORS.surface },
  attachButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 2 },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  textInputWrapper: { flex: 1, backgroundColor: COLORS.bg, borderRadius: 20, paddingHorizontal: 16, maxHeight: 100, borderWidth: 1, borderColor: COLORS.border },
  textInput: { fontSize: 15, color: COLORS.textDark, fontFamily: FONTS.regular, paddingVertical: 8 },
  sendButton: { backgroundColor: COLORS.purplePrimary, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 8, marginBottom: 2, shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },

  pendingStrip: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  pendingItem: { width: 48, height: 48, position: 'relative' },
  pendingImage: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  pendingDoc: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  pendingRemove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.textDark, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.surface },

  attachmentList: { gap: 6, marginBottom: 4 },
  attachmentImageWrap: { alignSelf: 'flex-start', width: 220 },
  attachmentImage: { width: '100%', height: 170, borderRadius: 12 },
  attachmentLoading: { height: 170, borderRadius: 12, backgroundColor: 'rgba(139, 92, 246, 0.08)', alignItems: 'center', justifyContent: 'center' },
  attachmentRetry: { marginTop: 6, fontSize: 12, fontFamily: FONTS.medium, color: COLORS.purpleVibrant },
  attachmentDoc: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent', borderWidth: 0, borderColor: 'rgba(76, 29, 149, 0.15)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, maxWidth: 260 },
  attachmentDocName: { flexShrink: 1, flexGrow: 1, fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textDark },
  attachmentDocSize: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted },

  quizEmbedCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    maxWidth: 280,
    minWidth: 220,
  },
  quizEmbedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  quizEmbedTitle: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.textDark,
    flex: 1,
  },
  quizEmbedMeta: {
    marginBottom: 8,
  },
  quizEmbedMetaText: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
  },
  quizEmbedAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  quizEmbedActionText: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.purplePrimary,
  },

  attachSheetRow: { flexDirection: 'row', gap: 22 },
  attachOption: { alignItems: 'center', gap: 8 },
  attachOptionIcon: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  attachOptionText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textDark },

  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxImage: { width: '100%', height: '100%' },
  lightboxClose: { position: 'absolute', top: 52, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  lightboxDownload: { position: 'absolute', top: 52, left: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textDark },

  bigAvatar: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginBottom: 10, backgroundColor: COLORS.purpleVibrant, shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  bigAvatarText: { color: 'white', fontSize: 22, fontFamily: FONTS.bold },
  settingsGroupName: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textDark },
  settingsGroupDesc: { fontSize: 14, color: COLORS.textMuted, marginTop: 6, textAlign: 'center', paddingHorizontal: 20, fontFamily: FONTS.regular },
  adminBadge: { backgroundColor: 'rgba(239, 68, 68, 0.1)', color: COLORS.danger, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, fontSize: 12, fontFamily: FONTS.bold, marginTop: 12 },
  settingsSection: { backgroundColor: COLORS.bg, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border, marginTop: 14 },
  settingsSectionTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.textDark, marginBottom: 6 },
  settingsDesc: { fontSize: 13, color: COLORS.textMuted, marginBottom: 16, fontFamily: FONTS.regular },
  codeBox: { flexDirection: 'row', backgroundColor: COLORS.textDark, borderRadius: 12, padding: 6, alignItems: 'center' },
  codeText: { flex: 1, color: 'white', fontSize: 18, letterSpacing: 4, textAlign: 'center', fontFamily: FONTS.bold },
  copyBtn: { backgroundColor: COLORS.purplePrimary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  settingsOptionsBlock: { marginTop: 14, backgroundColor: COLORS.bg, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16 },
  settingsOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  settingsOptionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  settingsOptionText: { flex: 1, fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textDark },
  settingsOptionValue: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textDark, marginRight: 6 },

  editInput: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textDark, marginBottom: 10 },
  editDescInput: { minHeight: 72, textAlignVertical: 'top' },
  saveBtn: { backgroundColor: COLORS.purplePrimary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: 'white', fontSize: 14, fontFamily: FONTS.bold },

  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 12 },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  memberName: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.textDark },
  memberMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  youBadge: { backgroundColor: 'rgba(34, 211, 238, 0.15)', color: '#0E7490', fontSize: 10, fontFamily: FONTS.bold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  adminBadgeSmall: { backgroundColor: 'rgba(139, 92, 246, 0.12)', color: COLORS.purpleDark, fontSize: 10, fontFamily: FONTS.bold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  emptyText: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.medium, textAlign: 'center', paddingVertical: 20 },

  pendingBlock: { marginBottom: 16, backgroundColor: COLORS.bg, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16, paddingBottom: 8 },
  pendingTitle: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, paddingVertical: 12 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12 },
  requestApproveBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center' },
  requestRejectBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(239, 68, 68, 0.12)', justifyContent: 'center', alignItems: 'center' },
  removeMemberBtn: { padding: 4 },
  peekRemoveBtn: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.06)' },
  peekRemoveText: { color: COLORS.danger, fontSize: 14, fontFamily: FONTS.bold },

  leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.06)', minHeight: 48 },
  leaveBtnText: { color: COLORS.danger, fontSize: 15, fontFamily: FONTS.bold },

  peekCard: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 28, alignItems: 'center', width: '80%', borderWidth: 1, borderColor: COLORS.border, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
  peekName: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textDark, marginTop: 12, textAlign: 'center' },
  peekBadges: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center' },
  peekMeta: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 4 },
  peekCloseBtn: { marginTop: 20, backgroundColor: COLORS.purplePrimary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 32 },
  peekCloseText: { color: 'white', fontSize: 14, fontFamily: FONTS.bold },
});
