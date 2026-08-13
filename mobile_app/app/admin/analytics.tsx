import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import StatCard from '@/components/admin/StatCard';
import { COLORS, FONTS } from '@/constants/adminTheme';

const WEEKLY_ACTIVE = [
  { day: 'Mon', value: 62 },
  { day: 'Tue', value: 78 },
  { day: 'Wed', value: 71 },
  { day: 'Thu', value: 85 },
  { day: 'Fri', value: 93 },
  { day: 'Sat', value: 54 },
  { day: 'Sun', value: 40 },
];

const TOP_COURSES = [
  { name: 'Data Structures & Algorithms', completion: 88 },
  { name: 'Web Development Fundamentals', completion: 81 },
  { name: 'Discrete Mathematics', completion: 74 },
  { name: 'Intro to Machine Learning', completion: 63 },
];

export default function AdminAnalytics() {
  const maxVal = Math.max(...WEEKLY_ACTIVE.map((d) => d.value));

  return (
    <View style={styles.container}>
      <AdminHeader title="Analytics & Reports" subtitle="Program-wide engagement" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.statsGrid}>
          <StatCard icon="pulse" label="Avg Quiz Score" value="82%" color={COLORS.success} trend="+3.1%" trendUp />
          <StatCard icon="flash" label="Completion Rate" value="76%" color={COLORS.purpleVibrant} trend="+1.4%" trendUp />
          <StatCard icon="today" label="Active Today" value="612" color={COLORS.info} />
          <StatCard icon="time" label="Avg Study Time" value="46m" color={COLORS.warning} trend="-5m" />
        </View>

        <Text style={styles.sectionTitle}>Weekly Active Users</Text>
        <View style={styles.chartCard}>
          <View style={styles.barsRow}>
            {WEEKLY_ACTIVE.map((d) => (
              <View key={d.day} style={styles.barCol}>
                <Text style={styles.barValue}>{d.value}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { height: `${(d.value / maxVal) * 100}%` },
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{d.day}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Top Courses by Completion</Text>
        <View style={styles.listCard}>
          {TOP_COURSES.map((c, i) => (
            <View key={c.name} style={[styles.courseRow, i !== 0 && styles.borderTop]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.courseName}>{c.name}</Text>
                <View style={styles.progressBg}>
                  <View style={[styles.progressFill, { width: `${c.completion}%` }]} />
                </View>
              </View>
              <Text style={styles.coursePercent}>{c.completion}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.purpleDark} />
          <Text style={styles.noteText}>Sample data shown — connect to your reporting endpoint to see live numbers.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FONTS.extraBold,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginTop: 26,
    marginBottom: 14,
  },
  chartCard: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  barsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 140 },
  barCol: { alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' },
  barValue: { fontSize: 10, fontFamily: FONTS.semiBold, color: COLORS.textMuted, marginBottom: 4 },
  barTrack: { width: 14, height: 90, borderRadius: 7, backgroundColor: COLORS.purpleGhost, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: COLORS.purpleVibrant, borderRadius: 7 },
  barLabel: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 8 },
  listCard: { backgroundColor: COLORS.surface, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  courseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  courseName: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
  progressBg: { height: 6, backgroundColor: COLORS.purpleGhost, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.purpleVibrant, borderRadius: 3 },
  coursePercent: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
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
