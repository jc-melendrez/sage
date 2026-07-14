import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import SearchBar from '@/components/admin/SearchBar';
import StatusPill from '@/components/admin/StatusPill';
import { COLORS, FONTS } from '@/constants/adminTheme';

type Role = 'Student' | 'Teacher';

interface PersonRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'inactive' | 'suspended';
  meta: string;
}

const MOCK_PEOPLE: PersonRow[] = [
  { id: 1, name: 'Mikaela Santos', email: 'mikaela.santos@sage.edu', role: 'Student', status: 'active', meta: 'BSCS-3A · Lv. 12' },
  { id: 2, name: 'Josh Villareal', email: 'josh.villareal@sage.edu', role: 'Student', status: 'active', meta: 'BSCS-3A · Lv. 9' },
  { id: 3, name: 'Anna Bautista', email: 'anna.bautista@sage.edu', role: 'Student', status: 'inactive', meta: 'BSIT-2B · Lv. 5' },
  { id: 4, name: 'Prof. Ramon Cruz', email: 'r.cruz@sage.edu', role: 'Teacher', status: 'active', meta: '4 courses · 210 students' },
  { id: 5, name: 'Prof. Liza Fernandez', email: 'l.fernandez@sage.edu', role: 'Teacher', status: 'active', meta: '3 courses · 156 students' },
  { id: 6, name: 'Carlo Dizon', email: 'carlo.dizon@sage.edu', role: 'Student', status: 'suspended', meta: 'BSIT-1A · Lv. 2' },
  { id: 7, name: 'Prof. Sarah Lim', email: 's.lim@sage.edu', role: 'Teacher', status: 'active', meta: '2 courses · 98 students' },
];

export default function AdminUsers() {
  const [tab, setTab] = useState<Role>('Student');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState(MOCK_PEOPLE);

  const filtered = useMemo(
    () =>
      people.filter(
        (p) =>
          p.role === tab &&
          (p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.email.toLowerCase().includes(query.toLowerCase()))
      ),
    [people, tab, query]
  );

  const toggleStatus = (id: number) => {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: p.status === 'active' ? 'suspended' : 'active' } : p
      )
    );
  };

  const confirmToggle = (person: PersonRow) => {
    const action = person.status === 'active' ? 'suspend' : 'reactivate';
    Alert.alert(
      `${action === 'suspend' ? 'Suspend' : 'Reactivate'} account?`,
      `This will ${action} ${person.name}'s account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: () => toggleStatus(person.id) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Users & Teachers" subtitle={`${people.length} accounts total`} rightIcon="person-add-outline" onRightPress={() => Alert.alert('Add Account', 'Form to invite a new student or teacher would open here.')} />

      <View style={styles.content}>
        <View style={styles.tabs}>
          {(['Student', 'Teacher'] as Role[]).map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.tab, tab === r && styles.tabActive]}
              onPress={() => setTab(r)}
            >
              <Text style={[styles.tabText, tab === r && styles.tabTextActive]}>{r}s</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ marginTop: 14 }}>
          <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${tab.toLowerCase()}s...`} />
        </View>

        <ScrollView style={{ marginTop: 16 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={28} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>No {tab.toLowerCase()}s match your search.</Text>
            </View>
          ) : (
            filtered.map((person) => (
              <View key={person.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {person.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{person.name}</Text>
                    <Text style={styles.email}>{person.email}</Text>
                  </View>
                  <StatusPill status={person.status} />
                </View>
                <Text style={styles.meta}>{person.meta}</Text>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('Edit', `Edit form for ${person.name} would open here.`)}>
                    <Ionicons name="create-outline" size={15} color={COLORS.purpleDark} />
                    <Text style={styles.actionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: person.status === 'active' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)' }]}
                    onPress={() => confirmToggle(person)}
                  >
                    <Ionicons
                      name={person.status === 'active' ? 'ban-outline' : 'checkmark-circle-outline'}
                      size={15}
                      color={person.status === 'active' ? COLORS.danger : COLORS.success}
                    />
                    <Text style={[styles.actionText, { color: person.status === 'active' ? COLORS.danger : COLORS.success }]}>
                      {person.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
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
  emptyText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted },
});
