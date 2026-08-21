import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AdminHeader from '@/components/admin/AdminHeader';
import StatCard from '@/components/admin/StatCard';
import { COLORS, FONTS } from '@/constants/adminTheme';
import { superadminService, PlatformAnalytics } from '@/services/adminService';
import { useAuth } from '@/hooks/useAuth';

const QUICK_LINKS: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  route: string;
}[] = [
  {
    icon: 'business-outline',
    title: 'Admins & Schools',
    desc: 'Register schools & assign initial admins',
    route: '/superadmin/admins',
  },
  {
    icon: 'flag-outline',
    title: 'Feature Flags & Config',
    desc: 'Toggle features, app settings & env values',
    route: '/superadmin/config',
  },
  {
    icon: 'person-add-outline',
    title: 'Create Superadmin',
    desc: 'Provision a new superadmin / platform user',
    route: '/superadmin/create',
  },
  {
    icon: 'server-outline',
    title: 'User Database',
    desc: 'Full read access across all roles',
    route: '/superadmin/database',
  },
  {
    icon: 'pulse-outline',
    title: 'System Health & Logs',
    desc: 'Service status, uptime & error logs',
    route: '/superadmin/system',
  },
];

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { logout } = useAuth();
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAnalytics(await superadminService.analytics());
    } catch (e: any) {
      setError(e?.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Super Admin"
        subtitle="Developer Console"
        variant="superadmin"
        showBack={false}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>System Overview</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={COLORS.superAdminGlow} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={20} color={COLORS.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadAnalytics}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : analytics ? (
          <View style={styles.statsGrid}>
            <StatCard icon="business" label="Schools" value={String(analytics.total_schools)} color={COLORS.superAdminGlow} />
            <StatCard icon="shield-checkmark" label="Admins" value={String(analytics.users_by_role?.admin ?? 0)} color={COLORS.superAdminGlow} />
            <StatCard icon="people" label="Total Users" value={String(analytics.total_users)} color={COLORS.superAdminGlow} />
            <StatCard icon="checkmark-circle" label="Active Users" value={String(analytics.active_users)} color={COLORS.success} />
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Console</Text>
        <View style={styles.linksList}>
          {QUICK_LINKS.map((link) => (
            <TouchableOpacity
              key={link.route}
              style={styles.linkCard}
              activeOpacity={0.8}
              onPress={() => router.push(link.route as any)}
            >
              <View style={styles.linkIconBg}>
                <Ionicons name={link.icon} size={22} color={COLORS.superAdminGlow} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkTitle}>{link.title}</Text>
                <Text style={styles.linkDesc}>{link.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#E2E8F0',
    marginBottom: 14,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  linksList: { gap: 12 },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#151B2E',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
  },
  linkIconBg: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.1)',
  },
  linkTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: '#F1F5F9' },
  linkDesc: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8', marginTop: 2 },
  errorBox: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  errorText: { fontSize: 13, fontFamily: FONTS.medium, color: '#94A3B8', textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.superAdminGlow, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  retryText: { color: '#0B1020', fontFamily: FONTS.semiBold, fontSize: 12 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 28,
  },
  logoutText: { color: COLORS.danger, fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },
});
