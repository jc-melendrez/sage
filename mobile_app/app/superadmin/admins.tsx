import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import { COLORS, FONTS } from '@/constants/adminTheme';
import { superadminService, School } from '@/services/adminService';

type SchoolModal = { type: 'create' } | { type: 'admin'; school: School } | null;

export default function SuperAdminAdmins() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<SchoolModal>(null);

  const loadSchools = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSchools(await superadminService.listSchools());
    } catch (e: any) {
      setError(e?.message || 'Failed to load schools.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchools();
  }, [loadSchools]);

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Admins & Schools"
        subtitle={`${schools.length} schools registered`}
        variant="superadmin"
        rightIcon="add"
        onRightPress={() => setModal({ type: 'create' })}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 80 }} color={COLORS.superAdminGlow} />
      ) : error ? (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={28} color={COLORS.danger} />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadSchools}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
          {schools.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="business-outline" size={28} color="#94A3B8" />
              <Text style={styles.emptyText}>No schools yet. Tap + to register the first one.</Text>
            </View>
          ) : (
            schools.map((school) => (
              <View key={school.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.avatar}>
                    <Ionicons name="business-outline" size={20} color={COLORS.superAdminGlow} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{school.name}</Text>
                    <Text style={styles.email}>{school.member_count} members</Text>
                  </View>
                  <View style={[styles.rolePill, { backgroundColor: school.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)' }]}>
                    <Text style={[styles.rolePillText, { color: school.is_active ? COLORS.success : '#94A3B8' }]}>
                      {school.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </Text>
                  </View>
                </View>
                {school.address ? (
                  <View style={styles.schoolRow}>
                    <Ionicons name="location-outline" size={14} color="#94A3B8" />
                    <Text style={styles.schoolText}>{school.address}</Text>
                  </View>
                ) : null}
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => setModal({ type: 'admin', school })}>
                    <Ionicons name="person-add-outline" size={15} color={COLORS.superAdminGlow} />
                    <Text style={styles.actionText}>Assign Admin</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {modal?.type === 'create' && (
        <CreateSchoolModal
          onClose={() => setModal(null)}
          onCreated={async () => {
            await loadSchools();
            setModal(null);
          }}
        />
      )}

      {modal?.type === 'admin' && (
        <CreateAdminModal
          school={modal.school}
          onClose={() => setModal(null)}
          onCreated={async () => {
            await loadSchools();
            setModal(null);
          }}
        />
      )}
    </View>
  );
}

function CreateSchoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert('Missing info', 'School name is required.');
      return;
    }
    try {
      setSubmitting(true);
      await superadminService.createSchool({ name, address, contact_email: contactEmail, contact_phone: contactPhone });
      Alert.alert('School created', 'Now assign an initial Admin for this school.');
      onCreated();
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not create school.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Register School</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#94A3B8" />
            </TouchableOpacity>
          </View>
          <TextInput style={styles.input} placeholder="School name" placeholderTextColor="#64748B" value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Address" placeholderTextColor="#64748B" value={address} onChangeText={setAddress} />
          <TextInput style={styles.input} placeholder="Contact email" placeholderTextColor="#64748B" value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Contact phone" placeholderTextColor="#64748B" value={contactPhone} onChangeText={setContactPhone} />
          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#0B1020" /> : <Ionicons name="business" size={16} color="#0B1020" />}
            {!submitting && <Text style={styles.submitBtnText}>Register School</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateAdminModal({ school, onClose, onCreated }: { school: School; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!username.trim() || !email.trim() || !password) {
      Alert.alert('Missing info', 'Username, email and password are required.');
      return;
    }
    try {
      setSubmitting(true);
      await superadminService.createSchoolAdmin(school.id, { username, email, password, first_name: firstName, last_name: lastName });
      Alert.alert('Admin created', `${username} is now Admin of ${school.name}.`);
      onCreated();
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not create admin.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign Admin</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#94A3B8" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>{school.name}</Text>
          <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#64748B" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#64748B" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <View style={styles.passwordRow}>
            <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Password" placeholderTextColor="#64748B" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94A3B8" />
            </TouchableOpacity>
          </View>
          <TextInput style={styles.input} placeholder="First name" placeholderTextColor="#64748B" value={firstName} onChangeText={setFirstName} />
          <TextInput style={styles.input} placeholder="Last name" placeholderTextColor="#64748B" value={lastName} onChangeText={setLastName} />
          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#0B1020" /> : <Ionicons name="shield-checkmark" size={16} color="#0B1020" />}
            {!submitting && <Text style={styles.submitBtnText}>Create Admin</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  card: { backgroundColor: '#151B2E', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(34,211,238,0.12)', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: '#F1F5F9' },
  email: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8', marginTop: 1 },
  rolePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  rolePillText: { fontSize: 10, fontFamily: FONTS.bold, fontWeight: '700' },
  schoolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  schoolText: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(34,211,238,0.1)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  actionText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.superAdminGlow },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 13, fontFamily: FONTS.medium, color: '#94A3B8', textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.superAdminGlow, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  retryText: { color: '#0B1020', fontFamily: FONTS.semiBold, fontSize: 12 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#151B2E', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, borderTopWidth: 1, borderColor: 'rgba(34,211,238,0.2)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800', color: '#F1F5F9' },
  modalSubtitle: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.superAdminGlow, marginBottom: 12 },
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
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  eyeBtn: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1020', borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)' },
});
