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
  color: string;
  badge?: string;
}[] = [
  {
    icon: 'people-outline',
    title: 'Users & Teachers',
    desc: 'Manage student & educator accounts',
    route: '/admin/users',
    color: COLORS.purpleVibrant,
  },
  {
    icon: 'library-outline',
    title: 'Course Oversight',
    desc: 'Review courses & lesson content',
    route: '/admin/courses',
    color: COLORS.info,
    badge: '3 pending',
  },
  {
    icon: 'bar-chart-outline',
    title: 'Analytics & Reports',
    desc: 'Engagement, performance & trends',
    route: '/admin/analytics',
    color: COLORS.success,
  },
  {
    icon: 'megaphone-outline',
    title: 'Announcements',
    desc: 'Post updates & approve requests',
    route: '/admin/announcements',
    color: COLORS.warning,
    badge: '2 new',
  },
];

export default function AdminDashboard() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Admin Dashboard"
        subtitle="Dean / Program Chair Console"
        showBack={false}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsGrid}>
          <StatCard icon="people" label="Total Students" value="1,284" color={COLORS.purpleVibrant} trend="+4.2% this month" trendUp />
          <StatCard icon="school" label="Educators" value="46" color={COLORS.info} trend="+2 new" trendUp />
          <StatCard icon="library" label="Active Courses" value="58" color={COLORS.success} />
          <StatCard icon="time" label="Pending Reviews" value="3" color={COLORS.warning} />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Manage</Text>
        <View style={styles.linksList}>
          {QUICK_LINKS.map((link) => (
            <TouchableOpacity
              key={link.route}
              style={styles.linkCard}
              activeOpacity={0.8}
              onPress={() => router.push(link.route as any)}
            >
              <View style={[styles.linkIconBg, { backgroundColor: `${link.color}22` }]}>
                <Ionicons name={link.icon} size={22} color={link.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.linkTitleRow}>
                  <Text style={styles.linkTitle}>{link.title}</Text>
                  {link.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{link.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.linkDesc}>{link.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.purpleDark} />
          <Text style={styles.noteText}>
            This console currently shows sample data. Your team can connect it to live backend
            endpoints when ready.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  linksList: { gap: 12 },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  linkIconBg: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  linkTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  linkDesc: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 2 },
  badge: { backgroundColor: 'rgba(124,58,237,0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.purpleDark },
  noteCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderRadius: 16,
    padding: 14,
    marginTop: 24,
    alignItems: 'flex-start',
  },
  noteText: { flex: 1, fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, lineHeight: 18 },
});
