import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: string;
  date: string;
}

interface ApprovalRequest {
  id: number;
  title: string;
  requester: string;
  type: string;
}

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  { id: 1, title: 'Midterm Schedule Released', body: 'Midterm exams will run from Oct 20–24. Check your course pages for room assignments.', audience: 'All Students', date: 'Jul 10' },
  { id: 2, title: 'New Study Group Feature', body: 'Students can now create study groups directly from the Activities tab.', audience: 'All Users', date: 'Jul 6' },
];

const INITIAL_APPROVALS: ApprovalRequest[] = [
  { id: 1, title: 'New course: "Cloud Computing Basics"', requester: 'Prof. Sarah Lim', type: 'Course Creation' },
  { id: 2, title: 'Extend quiz deadline for BSIT-2B', requester: 'Prof. Liza Fernandez', type: 'Deadline Extension' },
];

export default function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState(INITIAL_ANNOUNCEMENTS);
  const [approvals, setApprovals] = useState(INITIAL_APPROVALS);
  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');

  const postAnnouncement = () => {
    if (!newTitle.trim() || !newBody.trim()) {
      Alert.alert('Missing info', 'Please fill in both a title and message.');
      return;
    }
    setAnnouncements((prev) => [
      { id: Date.now(), title: newTitle, body: newBody, audience: 'All Students', date: 'Just now' },
      ...prev,
    ]);
    setNewTitle('');
    setNewBody('');
    setModalVisible(false);
  };

  const resolveApproval = (id: number, approve: boolean) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    Alert.alert(approve ? 'Approved' : 'Declined', approve ? 'The request has been approved.' : 'The request has been declined.');
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Announcements" subtitle="Post updates & manage approvals" rightIcon="add" onRightPress={() => setModalVisible(true)} />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Pending Approvals</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{approvals.length}</Text>
          </View>
        </View>

        {approvals.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-outline" size={26} color={COLORS.success} />
            <Text style={styles.emptyText}>All caught up — no pending requests.</Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {approvals.map((a) => (
              <View key={a.id} style={styles.card}>
                <Text style={styles.approvalType}>{a.type}</Text>
                <Text style={styles.approvalTitle}>{a.title}</Text>
                <Text style={styles.approvalRequester}>Requested by {a.requester}</Text>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => resolveApproval(a.id, true)}>
                    <Ionicons name="checkmark" size={15} color="#fff" />
                    <Text style={styles.approveText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => resolveApproval(a.id, false)}>
                    <Ionicons name="close" size={15} color={COLORS.danger} />
                    <Text style={styles.rejectText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, { marginTop: 28, marginBottom: 14 }]}>Recent Announcements</Text>
        <View style={{ gap: 12 }}>
          {announcements.map((a) => (
            <View key={a.id} style={styles.card}>
              <View style={styles.announcementTop}>
                <Text style={styles.announcementTitle}>{a.title}</Text>
                <Text style={styles.announcementDate}>{a.date}</Text>
              </View>
              <Text style={styles.announcementBody}>{a.body}</Text>
              <View style={styles.audiencePill}>
                <Ionicons name="people-outline" size={12} color={COLORS.purpleDark} />
                <Text style={styles.audienceText}>{a.audience}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Announcement</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Title"
              placeholderTextColor={COLORS.textMuted}
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Write your announcement..."
              placeholderTextColor={COLORS.textMuted}
              value={newBody}
              onChangeText={setNewBody}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity style={styles.postBtn} onPress={postAnnouncement}>
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={styles.postBtnText}>Post to All Students</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.textPrimary },
  countPill: { backgroundColor: COLORS.warning, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  countPillText: { color: '#fff', fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700' },
  card: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  approvalType: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleDark, textTransform: 'uppercase', letterSpacing: 0.5 },
  approvalTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginTop: 6 },
  approvalRequester: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  approveBtn: { backgroundColor: COLORS.success },
  approveText: { color: '#fff', fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700' },
  rejectBtn: { backgroundColor: 'rgba(239,68,68,0.1)' },
  rejectText: { color: COLORS.danger, fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30, gap: 10, backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border },
  emptyText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textSecondary },
  announcementTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  announcementTitle: { flex: 1, fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  announcementDate: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted },
  announcementBody: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 8, lineHeight: 19 },
  audiencePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(124,58,237,0.08)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start', marginTop: 12 },
  audienceText: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleDark },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,10,30,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.textPrimary },
  input: {
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purpleDark,
    paddingVertical: 14,
    borderRadius: 14,
  },
  postBtnText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },
});
