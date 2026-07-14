import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import SearchBar from '@/components/admin/SearchBar';
import { COLORS, FONTS } from '@/constants/adminTheme';

type Role = 'All' | 'Student' | 'Teacher' | 'Admin';

interface DbUser {
  id: number;
  username: string;
  email: string;
  role: Exclude<Role, 'All'>;
  joined: string;
}

const MOCK_USERS: DbUser[] = [
  { id: 1001, username: 'mikaela.santos', email: 'mikaela.santos@sage.edu', role: 'Student', joined: 'Jan 2025' },
  { id: 1002, username: 'josh.villareal', email: 'josh.villareal@sage.edu', role: 'Student', joined: 'Feb 2025' },
  { id: 1003, username: 'r.cruz', email: 'r.cruz@sage.edu', role: 'Teacher', joined: 'Aug 2024' },
  { id: 1004, username: 'e.marquez', email: 'e.marquez@sage.edu', role: 'Admin', joined: 'Jun 2023' },
  { id: 1005, username: 'anna.bautista', email: 'anna.bautista@sage.edu', role: 'Student', joined: 'Mar 2025' },
  { id: 1006, username: 'l.fernandez', email: 'l.fernandez@sage.edu', role: 'Teacher', joined: 'Sep 2024' },
  { id: 1007, username: 'm.torres', email: 'm.torres@sage.edu', role: 'Admin', joined: 'Jul 2023' },
  { id: 1008, username: 'carlo.dizon', email: 'carlo.dizon@sage.edu', role: 'Student', joined: 'Apr 2025' },
];

const ROLE_FILTERS: Role[] = ['All', 'Student', 'Teacher', 'Admin'];

const ROLE_COLORS: Record<Exclude<Role, 'All'>, string> = {
  Student: COLORS.purpleLight,
  Teacher: COLORS.info,
  Admin: COLORS.superAdminGlow,
};

export default function SuperAdminDatabase() {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role>('All');

  const filtered = useMemo(
    () =>
      MOCK_USERS.filter(
        (u) =>
          (roleFilter === 'All' || u.role === roleFilter) &&
          (u.username.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase()))
      ),
    [query, roleFilter]
  );

  return (
    <View style={styles.container}>
      <AdminHeader title="User Database" subtitle={`${MOCK_USERS.length} total records`} variant="superadmin" />

      <View style={styles.content}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search by username or email..." />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {ROLE_FILTERS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.filterChip, roleFilter === r && styles.filterChipActive]}
              onPress={() => setRoleFilter(r)}
            >
              <Text style={[styles.filterChipText, roleFilter === r && styles.filterChipTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 10 }}>
          {filtered.map((u) => (
            <TouchableOpacity
              key={u.id}
              style={styles.row}
              activeOpacity={0.8}
              onPress={() =>
                Alert.alert(
                  `#${u.id} · ${u.username}`,
                  `Email: ${u.email}\nRole: ${u.role}\nJoined: ${u.joined}\n\nFull record inspector would open here.`
                )
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.username}>{u.username}</Text>
                <Text style={styles.email}>{u.email}</Text>
              </View>
              <View style={[styles.rolePill, { backgroundColor: `${ROLE_COLORS[u.role]}22` }]}>
                <Text style={[styles.rolePillText, { color: ROLE_COLORS[u.role] }]}>{u.role}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#64748B" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20, gap: 14 },
  filterRow: { gap: 8, paddingRight: 20 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#151B2E',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
  },
  filterChipActive: { backgroundColor: COLORS.superAdminGlow, borderColor: COLORS.superAdminGlow },
  filterChipText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: '#94A3B8' },
  filterChipTextActive: { color: '#0B1020' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#151B2E',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.12)',
  },
  username: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: '#F1F5F9' },
  email: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8', marginTop: 2 },
  rolePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  rolePillText: { fontSize: 10, fontFamily: FONTS.bold, fontWeight: '700' },
});
