import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { CreateQuickActions } from '@/components/educator/CreateQuickActions';
import { getCurrentUser } from '@/services/authService';
import { getMyCourses, CourseSummary } from '@/services/courseService';
import { getActivities, ClassActivity, ActivityKind } from '@/services/activityService';

const ACTIVITY_META: Record<ActivityKind, { icon: any; color: string }> = {
  quiz: { icon: 'help-circle', color: COLORS.purpleVibrant },
  lesson: { icon: 'book', color: COLORS.accent },
  game: { icon: 'game-controller', color: COLORS.success },
  task: { icon: 'document-text', color: COLORS.warning },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dueLabel(iso: string | null): string {
  if (!iso) return '';
  return `Due ${new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'T';
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function EducatorDashboardScreen() {
  const router = useRouter();

  const [teacherName, setTeacherName] = useState('Teacher');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [activities, setActivities] = useState<ClassActivity[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const loadTeacher = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
        setTeacherName(name || 'Teacher');
      }
    } catch {
      /* keep default greeting name */
    }
  }, []);

  const loadCourses = useCallback(async () => {
    try {
      setCourses(await getMyCourses());
    } catch {
      /* class preview stays empty; dedicated Classes tab shows the error state */
    } finally {
      setLoadingClasses(false);
    }
  }, []);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await getActivities());
    } catch {
      /* activity sections stay empty */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTeacher();
      loadCourses();
      loadActivities();
    }, [loadTeacher, loadCourses, loadActivities])
  );

  const activeActivities = activities
    .filter((a) => a.status === 'published')
    .slice(0, 4);

  const recentActivity = [...activities]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const openCourse = (course: CourseSummary) =>
    router.push({
      pathname: '/educator/(tabs)/course-detail',
      params: { courseId: course.id, courseName: course.name },
    });

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={greeting()}
        subtitle={`${teacherName}`}
        avatar={initialsOf(teacherName)}
        onAvatarPress={() => router.navigate('/educator/profile')}
        showNotifications
        onNotificationsPress={() => router.push('/educator/announcements' as any)}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 1 — Quick actions */}
        <View style={styles.section}>
          <SectionHeader title="Quick Actions" />
          <CreateQuickActions />
        </View>

        {/* 2 — My Classes */}
        <View style={styles.section}>
          <SectionHeader title="My Classes" actionLabel="See all" onAction={() => router.navigate('/educator/courses')} />

          {loadingClasses ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={COLORS.purpleVibrant} />
            </View>
          ) : courses.length === 0 ? (
            <EmptyState
              icon="school-outline"
              title="No classes yet"
              text='Create a course and share its join code so students can enroll.'
            />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 4 }}
            >
              {courses.map((c) => (
                <TouchableOpacity key={c.id} style={styles.classCard} activeOpacity={0.85} onPress={() => openCourse(c)}>
                  <View style={[styles.classIconBg, { backgroundColor: tint(COLORS.purpleVibrant) }]}>
                    <Ionicons name="people" size={18} color={COLORS.purpleVibrant} />
                  </View>
                  <Text style={styles.className} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.classMeta}>
                    {c.student_count} student{c.student_count === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* 3 — Active Activities */}
        {activeActivities.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Active Activities" actionLabel="See all" onAction={() => router.navigate('/educator/assignments')} />

            {activeActivities.map((a) => {
              const meta = ACTIVITY_META[a.kind] || ACTIVITY_META.quiz;
              return (
                <View key={a.id} style={styles.assignmentCard}>
                  <View style={styles.assignmentTop}>
                    <View style={[styles.activityIconBg, { backgroundColor: tint(meta.color) }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assignmentTitle}>{a.title}</Text>
                      <Text style={styles.assignmentMeta}>
                        {a.course_name}
                        {dueLabel(a.due_date) ? ` · ${dueLabel(a.due_date)}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* 4 — Recent Activity */}
        {recentActivity.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Recent Activity" actionLabel="See all" onAction={() => router.navigate('/educator/assignments')} />
            <View style={styles.activityCard}>
              {recentActivity.map((item, idx) => {
                const meta = ACTIVITY_META[item.kind] || ACTIVITY_META.quiz;
                return (
                  <View key={item.id} style={[styles.activityRow, idx > 0 && styles.activityBorderTop]}>
                    <View style={[styles.activityIconBg, { backgroundColor: tint(meta.color) }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityText} numberOfLines={2}>{item.title}</Text>
                      <Text style={styles.activitySub}>{item.course_name}</Text>
                    </View>
                    <Text style={styles.activityTime}>{relativeTime(item.created_at)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  scrollContent: { paddingBottom: 44 },
  section: { marginBottom: 26 },
  loadingBox: { paddingVertical: 32, alignItems: 'center' },

  /* Class preview card */
  classCard: {
    width: 150,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginRight: 12,
  },
  classIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  className: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  classMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },

  /* Assignment preview card */
  assignmentCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
  },
  assignmentTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  assignmentTitle: { fontSize: 14.5, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  assignmentMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  assignmentPercent: { fontSize: 15, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purpleDeep },
  assignmentSub: { fontSize: 11.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted, marginTop: 8 },

  /* Activity feed */
  activityCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
  },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  activityBorderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  activityIconBg: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  activityText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, lineHeight: 18 },
  activitySub: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  activityTime: { fontSize: 11, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted },
});