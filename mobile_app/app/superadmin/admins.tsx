import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface AdminRow {
  id: number;
  name: string;
  email: string;
  role: 'Dean' | 'Program Chair';
  school: string;
}

const MOCK_ADMINS: AdminRow[] = [
  { id: 1, name: 'Dr. Elena Marquez', email: 'e.marquez@sage.edu', role: 'Dean', school: 'College of Computer Studies' },
  { id: 2, name: 'Prof. Miguel Torres', email: 'm.torres@sage.edu', role: 'Program Chair', school: 'BS Computer Science' },
  { id: 3, name: 'Prof. Karen Uy', email: 'k.uy@sage.edu', role: 'Program Chair', school: 'BS Information Technology' },
  { id: 4, name: 'Dr. Paolo Reyes', email: 'p.reyes@sage.edu', role: 'Dean', school: 'College of Engineering' },
];

export default function SuperAdminAdmins() {
  const [admins, setAdmins] = useState(MOCK_ADMINS);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [school, setSchool] = useState('');

  const removeAdmin = (admin: AdminRow) => {
    Alert.alert('Revoke admin access?', `${admin.name} will lose Dean/Program Chair privileges.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => setAdmins((prev) => prev.filter((a) => a.id !== admin.id)) },
    ]);
  };

  const addAdmin = () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert('Missing info', 'Please provide at least a name and email.');
      return;
    }
    setAdmins((prev) => [
      { id: Date.now(), name, email, role: 'Program Chair', school: school || 'Unassigned' },
      ...prev,
    ]);
    setName('');
    setEmail('');
    setSchool('');
    setModalVisible(false);
  };

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Admins & Schools"
        subtitle={`${admins.length} admin accounts`}
        variant="superadmin"
        rightIcon="add"
        onRightPress={() => setModalVisible(true)}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
        {admins.map((admin) => (
          <View key={admin.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{admin.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{admin.name}</Text>
                <Text style={styles.email}>{admin.email}</Text>
              </View>
              <View style={[styles.rolePill, { backgroundColor: admin.role === 'Dean' ? 'rgba(34,211,238,0.15)' : 'rgba(167,139,250,0.15)' }]}>
                <Text style={[styles.rolePillText, { color: admin.role === 'Dean' ? COLORS.superAdminGlow : COLORS.purpleLight }]}>{admin.role}</Text>
              </View>
            </View>
            <View style={styles.schoolRow}>
              <Ionicons name="school-outline" size={14} color="#94A3B8" />
              <Text style={styles.schoolText}>{admin.school}</Text>
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('Edit admin', `Edit form for ${admin.name} would open here.`)}>
                <Ionicons name="create-outline" size={15} color={COLORS.superAdminGlow} />
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.revokeBtn]} onPress={() => removeAdmin(admin)}>
                <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                <Text style={[styles.actionText, { color: COLORS.danger }]}>Revoke</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Admin</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <TextInput style={styles.input} placeholder="Full name" placeholderTextColor="#64748B" value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#64748B" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <TextInput style={styles.input} placeholder="School / Program" placeholderTextColor="#64748B" value={school} onChangeText={setSchool} />
            <TouchableOpacity style={styles.submitBtn} onPress={addAdmin}>
              <Ionicons name="person-add" size={16} color="#0B1020" />
              <Text style={styles.submitBtnText}>Grant Admin Access</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  card: { backgroundColor: '#151B2E', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(34,211,238,0.12)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.superAdminGlow, fontSize: 14 },
  name: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: '#F1F5F9' },
  email: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8', marginTop: 1 },
  rolePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  rolePillText: { fontSize: 10, fontFamily: FONTS.bold, fontWeight: '700' },
  schoolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  schoolText: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(34,211,238,0.1)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  revokeBtn: { backgroundColor: 'rgba(239,68,68,0.1)' },
  actionText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.superAdminGlow },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#151B2E', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, borderTopWidth: 1, borderColor: 'rgba(34,211,238,0.2)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800', color: '#F1F5F9' },
  input: {
    backgroundColor: '#0B1020',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: '#F1F5F9',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.superAdminGlow,
    paddingVertical: 14,
    borderRadius: 14,
  },
  submitBtnText: { color: '#0B1020', fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },
});
