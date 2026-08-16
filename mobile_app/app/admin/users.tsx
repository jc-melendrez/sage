import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import SearchBar from '@/components/admin/SearchBar';
import StatusPill from '@/components/admin/StatusPill';
import { COLORS, FONTS } from '@/constants/adminTheme';
import { getCurrentUser } from '@/services/authService';
import { adminService, ManagedUser, Role } from '@/services/adminService';

type RoleTab = 'student' | 'educator' | 'admin';

const ROLE_LABELS: Record<RoleTab, string> = {
  student: 'Student',
  educator: 'Educator',
  admin: 'Admin',
};

export default function AdminUsers() {
  const [tab, setTab] = useState<RoleTab>('student');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const me = await getCurrentUser();
      const schoolId = me?.school_id;
      if (!schoolId) throw new Error('No school assigned to this account.');
      setUsers(await adminService.listUsers(schoolId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          u.role === tab &&
          (u.username.toLowerCase().includes(query.toLowerCase()) ||
            u.email.toLowerCase().includes(query.toLowerCase()))
      ),
    [users, tab, query]
  );

  const displayName = (u: ManagedUser) =>
    [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;

  const doRoleChange = (u: ManagedUser, role: Role) => {
    Alert.alert('Change role', `Set ${displayName(u)}'s role to ${role}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Change',
        onPress: async () => {
          try {
            const me = await getCurrentUser();
            const updated = await adminService.changeRole(me.school_id, u.id, role);
            setUsers((prev) => prev.map((p) => (p.id === u.id ? updated : p)));
          } catch (e: any) {
            Alert.alert('Failed', e?.message || 'Could not change role.');
          }
        },
      },
    ]);
  };

  const promptRole = (u: ManagedUser) => {
    Alert.alert('Change role', `${displayName(u)}`, [
      { text: 'Student', onPress: () => doRoleChange(u, 'student') },
      { text: 'Educator', onPress: () => doRoleChange(u, 'educator') },
      { text: 'Admin', onPress: () => doRoleChange(u, 'admin') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleStatus = (u: ManagedUser) => {
    const action = u.is_active === false ? 'reactivate' : 'suspend';
    Alert.alert(
      `${action === 'suspend' ? 'Suspend' : 'Reactivate'} account?`,
      `This will ${action} ${displayName(u)}'s account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: async () => {
            try {
              const me = await getCurrentUser();
              const updated = await adminService.updateUser(me.school_id, u.id, {
                is_active: action === 'reactivate',
              });
              setUsers((prev) => prev.map((p) => (p.id === u.id ? updated : p)));
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not update user.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Users & Teachers"
        subtitle={`${users.length} accounts total`}
        rightIcon="person-add-outline"
        onRightPress={() => setAddOpen(true)}
      />

      <View style={styles.content}>
        <View style={styles.tabs}>
          {(Object.keys(ROLE_LABELS) as RoleTab[]).map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.tab, tab === r && styles.tabActive]}
              onPress={() => setTab(r)}
            >
              <Text style={[styles.tabText, tab === r && styles.tabTextActive]}>{ROLE_LABELS[r]}s</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ marginTop: 14 }}>
          <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${ROLE_LABELS[tab].toLowerCase()}s...`} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.purpleDark} />
        ) : error ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={28} color={COLORS.danger} />
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadUsers}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={{ marginTop: 16 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
            {filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={28} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>No {ROLE_LABELS[tab].toLowerCase()}s match your search.</Text>
              </View>
            ) : (
              filtered.map((u) => {
                const isActive = u.is_active !== false;
                return (
                  <View key={u.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {displayName(u).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{displayName(u)}</Text>
                        <Text style={styles.email}>{u.email}</Text>
                      </View>
                      <StatusPill status={isActive ? 'active' : 'inactive'} />
                    </View>
                    <Text style={styles.meta}>Lv. {u.level} · {u.total_points} XP</Text>
                    <View style={styles.actionsRow}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => promptRole(u)}>
                        <Ionicons name="swap-horizontal-outline" size={15} color={COLORS.purpleDark} />
                        <Text style={styles.actionText}>Role: {ROLE_LABELS[u.role as RoleTab]}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: isActive ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)' }]}
                        onPress={() => toggleStatus(u)}
                      >
                        <Ionicons
                          name={isActive ? 'ban-outline' : 'checkmark-circle-outline'}
                          size={15}
                          color={isActive ? COLORS.danger : COLORS.success}
                        />
                        <Text style={[styles.actionText, { color: isActive ? COLORS.danger : COLORS.success }]}>
                          {isActive ? 'Suspend' : 'Reactivate'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
      </View>

      <AddUserModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(newUser) => setUsers((prev) => [...prev, newUser])}
      />
    </View>
  );
}

function AddUserModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (u: ManagedUser) => void;
}) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'student' | 'educator'>('student');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!username || !email) {
      Alert.alert('Missing fields', 'Username and email are required.');
      return;
    }
    try {
      setSubmitting(true);
      const me = await getCurrentUser();
      const created = await adminService.createUser(me.school_id, {
        username,
        email,
        password: password || undefined,
        first_name: firstName,
        last_name: lastName,
        role,
      });
      onCreated(created);
      onClose();
      setUsername(''); setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not create user.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Add User</Text>
          <TextInput style={styles.input} placeholder="Username" placeholderTextColor={COLORS.textMuted} value={username} onChangeText={setUsername} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor={COLORS.textMuted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Password (optional)" placeholderTextColor={COLORS.textMuted} value={password} onChangeText={setPassword} secureTextEntry />
          <TextInput style={styles.input} placeholder="First name" placeholderTextColor={COLORS.textMuted} value={firstName} onChangeText={setFirstName} />
          <TextInput style={styles.input} placeholder="Last name" placeholderTextColor={COLORS.textMuted} value={lastName} onChangeText={setLastName} />
          <View style={styles.tabs}>
            {(['student', 'educator'] as const).map((r) => (
              <TouchableOpacity key={r} style={[styles.tab, role === r && styles.tabActive]} onPress={() => setRole(r)}>
                <Text style={[styles.tabText, role === r && styles.tabTextActive]}>{ROLE_LABELS[r]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.modalActions}>
            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.surface }]} onPress={onClose}>
              <Text style={[styles.modalBtnText, { color: COLORS.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.purpleDark }]} onPress={submit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={[styles.modalBtnText, { color: '#fff' }]}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  tabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 14, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  tabActive: { backgroundColor: COLORS.surface },
  tabText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.purpleDark },
  card: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.purpleGhost, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleDark, fontSize: 14 },
  name: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  email: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 1 },
  meta: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 10 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(124,58,237,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  actionText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleDark },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.purpleDark, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  retryText: { color: '#fff', fontFamily: FONTS.semiBold, fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  modalBtnText: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600' },
});
