import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import StatusPill from '@/components/admin/StatusPill';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface CourseRow {
  id: number;
  title: string;
  teacher: string;
  students: number;
  lessons: number;
  status: 'published' | 'pending' | 'draft';
}

const MOCK_COURSES: CourseRow[] = [
  { id: 1, title: 'Data Structures & Algorithms', teacher: 'Prof. Ramon Cruz', students: 142, lessons: 18, status: 'published' },
  { id: 2, title: 'Intro to Machine Learning', teacher: 'Prof. Sarah Lim', students: 98, lessons: 12, status: 'pending' },
  { id: 3, title: 'Web Development Fundamentals', teacher: 'Prof. Liza Fernandez', students: 156, lessons: 20, status: 'published' },
  { id: 4, title: 'Discrete Mathematics', teacher: 'Prof. Ramon Cruz', students: 74, lessons: 15, status: 'published' },
  { id: 5, title: 'Mobile App Design (Beta)', teacher: 'Prof. Sarah Lim', students: 0, lessons: 6, status: 'draft' },
  { id: 6, title: 'Database Management Systems', teacher: 'Prof. Liza Fernandez', students: 120, lessons: 16, status: 'pending' },
];

export default function AdminCourses() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'published' | 'draft'>('all');
  const [courses, setCourses] = useState(MOCK_COURSES);

  const filtered = filter === 'all' ? courses : courses.filter((c) => c.status === filter);

  const review = (course: CourseRow, approve: boolean) => {
    Alert.alert(
      approve ? 'Approve course?' : 'Send back for revisions?',
      `"${course.title}" by ${course.teacher}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approve ? 'Approve' : 'Send back',
          style: approve ? 'default' : 'destructive',
          onPress: () =>
            setCourses((prev) =>
              prev.map((c) => (c.id === course.id ? { ...c, status: approve ? 'published' : 'draft' } : c))
            ),
        },
      ]
    );
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'published', label: 'Published' },
    { key: 'draft', label: 'Draft' },
  ];

  return (
    <View style={styles.container}>
      <AdminHeader title="Course Oversight" subtitle={`${courses.length} courses across the program`} />

      <View style={styles.content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12, paddingTop: 14 }}>
          {filtered.map((course) => (
            <View key={course.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{course.title}</Text>
                  <Text style={styles.teacher}>{course.teacher}</Text>
                </View>
                <StatusPill status={course.status} />
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Ionicons name="people-outline" size={14} color={COLORS.textMuted} />
                  <Text style={styles.statText}>{course.students} students</Text>
                </View>
                <View style={styles.statItem}>
                  <Ionicons name="book-outline" size={14} color={COLORS.textMuted} />
                  <Text style={styles.statText}>{course.lessons} lessons</Text>
                </View>
              </View>

              {course.status === 'pending' && (
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => review(course, true)}>
                    <Ionicons name="checkmark-circle-outline" size={15} color="#fff" />
                    <Text style={styles.approveText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => review(course, false)}>
                    <Ionicons name="arrow-undo-outline" size={15} color={COLORS.danger} />
                    <Text style={styles.rejectText}>Send back</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  filterRow: { gap: 8, paddingRight: 20 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.purpleDark, borderColor: COLORS.purpleDark },
  filterChipText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary },
  filterChipTextActive: { color: '#fff' },
  card: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  teacher: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 12 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  approveBtn: { backgroundColor: COLORS.success },
  approveText: { color: '#fff', fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700' },
  rejectBtn: { backgroundColor: 'rgba(239,68,68,0.1)' },
  rejectText: { color: COLORS.danger, fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700' },
});
