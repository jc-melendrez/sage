import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AdminHeader from '@/components/admin/AdminHeader';
import StatCard from '@/components/admin/StatCard';
import { COLORS, FONTS } from '@/constants/adminTheme';

const QUICK_LINKS: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  route: string;
}[] = [
  {
    icon: 'business-outline',
    title: 'Admins & Schools',
    desc: 'Manage deans, program chairs & institutions',
    route: '/superadmin/admins',
  },
  {
    icon: 'flag-outline',
    title: 'Feature Flags & Config',
    desc: 'Toggle features, app settings & env values',
    route: '/superadmin/config',
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
        <View style={styles.statsGrid}>
          <StatCard icon="business" label="Schools" value="6" color={COLORS.superAdminGlow} />
          <StatCard icon="shield-checkmark" label="Admin Accounts" value="14" color={COLORS.superAdminGlow} />
          <StatCard icon="people" label="Total Users" value="8,942" color={COLORS.superAdminGlow} trend="+120 today" trendUp />
          <StatCard icon="checkmark-circle" label="API Uptime" value="99.98%" color={COLORS.success} />
        </View>

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

        <View style={styles.noteCard}>
          <Ionicons name="warning-outline" size={18} color={COLORS.superAdminGlow} />
          <Text style={styles.noteText}>
            Developer-level access. Sample data is shown for now — wire these screens to real
            infrastructure endpoints when your backend is ready.
          </Text>
        </View>
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
  noteCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(34,211,238,0.08)',
    borderRadius: 16,
    padding: 14,
    marginTop: 24,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.2)',
  },
  noteText: { flex: 1, fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8', lineHeight: 18 },
});
