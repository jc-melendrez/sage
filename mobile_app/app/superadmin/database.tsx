import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import AdminHeader from '@/components/admin/AdminHeader';
import SearchBar from '@/components/admin/SearchBar';
import { COLORS, FONTS } from '@/constants/adminTheme';
import { superadminService, ManagedUser } from '@/services/adminService';

type Role = 'All' | 'Student' | 'Teacher' | 'Superadmin';

interface DbUser {
  id: number;
  username: string;
  email: string;
  role: Exclude<Role, 'All'>;
  joined: string;
}

type ServiceRole = 'superadmin' | 'educator' | 'student';

const mapRole = (r: ServiceRole | undefined): Exclude<Role, 'All'> => {
  if (r === 'educator') return 'Teacher';
  if (r === 'superadmin') return 'Superadmin';
  return 'Student';
};

const ROLE_FILTERS: Role[] = ['All', 'Student', 'Teacher', 'Superadmin'];

const ROLE_COLORS: Record<Exclude<Role, 'All'>, string> = {
  Student: COLORS.purpleLight,
  Teacher: COLORS.info,
  Superadmin: COLORS.superAdminGlow,
};

export default function SuperAdminDatabase() {
  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role>('All');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (roleParam === 'educator') setRoleFilter('Teacher');
    else if (roleParam === 'superadmin') setRoleFilter('Superadmin');
    else if (roleParam === 'student') setRoleFilter('Student');
    else setRoleFilter('All');
  }, [roleParam]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const serviceRole = roleFilter === 'Teacher' ? 'educator' : roleFilter === 'Superadmin' ? 'superadmin' : roleFilter === 'Student' ? 'student' : undefined;
        const data = await superadminService.listUsers(serviceRole ? { role: serviceRole } : undefined);
        setUsers(data);
      } catch (e: any) {
        setError(e?.message || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [roleFilter]);

  const filtered = useMemo(
    () =>
      users.filter((u: ManagedUser) => {
        const roleMapped = mapRole(u.role as ServiceRole);
        const matchesRole = roleFilter === 'All' || roleMapped === roleFilter;
        const q = query.toLowerCase();
        return matchesRole && (u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
      }),
    [users, query, roleFilter]
  );

  return (
    <View style={styles.container}>
      <AdminHeader title="User Database" subtitle={`${users.length} total records`} variant="superadmin" />

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

        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={COLORS.superAdminGlow} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 10 }}>
            {filtered.map((u: ManagedUser) => {
              const mapped = mapRole(u.role as ServiceRole);
              return (
                <TouchableOpacity
                  key={u.id}
                  style={styles.row}
                  activeOpacity={0.8}
                  onPress={() =>
                    Alert.alert(
                      `#${u.id} - ${u.username}`,
                      `Email: ${u.email}\nRole: ${mapped}\nActive: ${u.is_active ?? 'N/A'}`
                    )
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.username}>{u.username}</Text>
                    <Text style={styles.email}>{u.email}</Text>
                  </View>
                  <View style={[styles.rolePill, { backgroundColor: `${ROLE_COLORS[mapped]}22` }]}>
                    <Text style={[styles.rolePillText, { color: ROLE_COLORS[mapped] }]}>{mapped}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#64748B" />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
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
  errorBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#151B2E',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: { flex: 1, color: '#F1F5F9', fontSize: 13, fontFamily: FONTS.medium },
});
