import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, Pill, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import {
  getActivities, createActivity, deleteActivity, updateActivity,
  ClassActivity, ActivityKind,
} from '@/services/activityService';
import { getMyCourses } from '@/services/courseService';
import { getQuizzes, Quiz } from '@/services/quizService';

const ACTIVITY_META: Record<ActivityKind, { label: string; icon: any; color: string }> = {
  quiz: { label: 'Quiz', icon: 'help-circle', color: COLORS.purpleVibrant },
  lesson: { label: 'Lesson', icon: 'book', color: COLORS.accent },
  game: { label: 'Game', icon: 'game-controller', color: COLORS.success },
  task: { label: 'Assignment', icon: 'document-text', color: COLORS.warning },
};

const BUILDER_KINDS: ActivityKind[] = ['quiz', 'task'];

type Filter = 'all' | ActivityStatus;
type ActivityStatus = 'draft' | 'published';
type DueQuick = 'none' | 'today' | '1d' | '1w';

interface CourseOption {
  id: number;
  name: string;
}

export default function ActivitiesScreen() {
  const router = useRouter();
  const [activities, setActivities] = useState<ClassActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  // Builder state
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [bClass, setBClass] = useState<number | null>(null);
  const [bKind, setBKind] = useState<ActivityKind>('quiz');
  const [bTitle, setBTitle] = useState('');
  const [bNote, setBNote] = useState('');
  const [bDue, setBDue] = useState<DueQuick>('none');
  const [bStatus, setBStatus] = useState<ActivityStatus>('draft');
  const [bQuizId, setBQuizId] = useState<number | null>(null);
  const [classQuizzes, setClassQuizzes] = useState<Quiz[]>([]);
  const [saving, setSaving] = useState(false);

  const loadActivities = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getActivities();
      setActivities(data);
    } catch {
      Alert.alert('Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActivities();
      (async () => {
        try {
          const data = await getMyCourses();
          setCourses(data.map((c) => ({ id: c.id, name: c.name })));
        } catch {
          // non-fatal
        }
      })();
    }, [loadActivities]),
  );

  const loadClassQuizzes = async (courseId: number) => {
    try {
      const data = await getQuizzes(courseId);
      setClassQuizzes(data);
    } catch {
      setClassQuizzes([]);
    }
  };

  const selectClass = (courseId: number) => {
    setBClass(courseId);
    setBQuizId(null);
    setClassQuizzes([]);
    loadClassQuizzes(courseId);
  };

  const dueToISO = (): string | null => {
    const now = new Date();
    if (bDue === 'today') return now.toISOString().slice(0, 10);
    if (bDue === '1d') return new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    if (bDue === '1w') return new Date(now.getTime() + 604800000).toISOString().slice(0, 10);
    return null;
  };

  const handleCreate = async () => {
    if (!bClass) {
      Alert.alert('Class required', 'Pick the class this activity belongs to.');
      return;
    }
    if (!bTitle.trim()) {
      Alert.alert('Title required', 'Please name the activity.');
      return;
    }
    setSaving(true);
    try {
      const title = bTitle.trim();
      await createActivity(bClass, {
        kind: bKind,
        title,
        ref_id: bKind === 'quiz' ? bQuizId : null,
        note: bNote.trim(),
        due_date: dueToISO(),
        status: bStatus,
      });
      setCreating(false);
      setBTitle('');
      setBNote('');
      setBDue('none');
      setBQuizId(null);
      setBKind('quiz');
      setBStatus('draft');
      await loadActivities();
    } catch (err) {
      Alert.alert('Failed to create activity', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (activity: ClassActivity) => {
    try {
      await updateActivity(activity.id, { status: activity.status === 'published' ? 'draft' : 'published' });
      await loadActivities();
    } catch {
      Alert.alert('Update failed', 'Could not update the activity.');
    }
  };

  const handleDelete = (activity: ClassActivity) => {
    Alert.alert(
      'Delete activity',
      `"${activity.title}" will be removed from ${activity.course_name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteActivity(activity.id);
              await loadActivities();
            } catch {
              Alert.alert('Delete failed', 'Could not delete the activity.');
            }
          },
        },
      ],
    );
  };

  const filtered =
    filter === 'all' ? activities : activities.filter((a) => a.status === filter);

  const grouped = filtered.reduce<Record<string, ClassActivity[]>>((acc, a) => {
    (acc[a.course_name] = acc[a.course_name] || []).push(a);
    return acc;
  }, {});

  const formatDue = (iso: string | null): string | null => {
    if (!iso) return null;
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <EducatorHeader
          title="Activities"
          subtitle={`${activities.length} across ${courses.length} class${courses.length === 1 ? '' : 'es'}`}
          rightIcon={creating ? 'close' : 'add'}
          onRightPress={() => setCreating(!creating)}
        />

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {creating && (
            <View style={styles.section}>
              <SectionHeader title="New Activity" />
              <View style={styles.builderCard}>
                <Text style={styles.fieldLabel}>Class</Text>
                {courses.length > 0 ? (
                  <View style={styles.chipRow}>
                    {courses.map((course) => (
                      <FilterChip
                        key={course.id}
                        label={course.name}
                        active={bClass === course.id}
                        onPress={() => selectClass(course.id)}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.hintText}>No classes yet — create one in the Classes tab.</Text>
                )}

                <Text style={styles.fieldLabel}>Type</Text>
                <View style={styles.chipRow}>
                  {BUILDER_KINDS.map((kind) => (
                    <FilterChip
                      key={kind}
                      label={ACTIVITY_META[kind].label}
                      active={bKind === kind}
                      onPress={() => setBKind(kind)}
                    />
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Fractions review in class"
                  placeholderTextColor={COLORS.textMuted}
                  value={bTitle}
                  onChangeText={setBTitle}
                />

                <Text style={styles.fieldLabel}>Note (optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Instructions or context for students"
                  placeholderTextColor={COLORS.textMuted}
                  value={bNote}
                  onChangeText={setBNote}
                  multiline
                  numberOfLines={3}
                />

                <Text style={styles.fieldLabel}>Due date</Text>
                <View style={styles.chipRow}>
                  {([
                    ['none', 'No due date'],
                    ['today', 'Today'],
                    ['1d', 'Tomorrow'],
                    ['1w', 'In 1 week'],
                  ] as const).map(([value, label]) => (
                    <FilterChip
                      key={value}
                      label={label}
                      active={bDue === value}
                      onPress={() => setBDue(value as DueQuick)}
                    />
                  ))}
                </View>

                {bKind === 'quiz' && classQuizzes.length > 0 && (
                  <>
                    <Text style={styles.fieldLabel}>Attach quiz</Text>
                    <View style={styles.chipRow}>
                      <FilterChip label="None" active={bQuizId === null} onPress={() => setBQuizId(null)} />
                      {classQuizzes.map((q) => (
                        <FilterChip
                          key={q.id}
                          label={q.title}
                          active={bQuizId === q.id}
                          onPress={() => setBQuizId(q.id)}
                        />
                      ))}
                    </View>
                  </>
                )}

                <Text style={styles.fieldLabel}>Status</Text>
                <View style={styles.chipRow}>
                  <FilterChip label="Draft" active={bStatus === 'draft'} onPress={() => setBStatus('draft')} />
                  <FilterChip label="Published" active={bStatus === 'published'} onPress={() => setBStatus('published')} />
                </View>

                <TouchableOpacity
                  style={[styles.publishBtn, saving && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  onPress={handleCreate}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="add-circle" size={16} color="white" />
                      <Text style={styles.publishText}>Add Activity</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.filterRow}>
              <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
              <FilterChip label="Draft" active={filter === 'draft'} onPress={() => setFilter('draft')} />
              <FilterChip label="Published" active={filter === 'published'} onPress={() => setFilter('published')} />
            </View>

            {loading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              </View>
            ) : filtered.length > 0 ? (
              Object.keys(grouped).map((courseName) => (
                <View key={courseName} style={styles.section}>
                  <SectionHeader title={courseName} />
                  <View style={{ gap: 12 }}>
                    {grouped[courseName].map((a) => {
                      const meta = ACTIVITY_META[a.kind] || ACTIVITY_META.quiz;
                      return (
                        <View key={a.id} style={styles.card}>
                          <View style={styles.cardTop}>
                            <View style={[styles.kindIconBg, { backgroundColor: tint(meta.color) }]}>
                              <Ionicons name={meta.icon} size={18} color={meta.color} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.cardTitle}>{a.title}</Text>
                              <Text style={styles.cardMeta}>
                                {meta.label}
                                {a.due_date ? ` · Due ${formatDue(a.due_date)}` : ''}
                              </Text>
                            </View>
                            <TouchableOpacity onPress={() => handleDelete(a)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
                            </TouchableOpacity>
                          </View>
                          {a.note ? (
                            <Text style={styles.cardNote} numberOfLines={2}>{a.note}</Text>
                          ) : null}
                          <TouchableOpacity
                            style={styles.statusRow}
                            activeOpacity={0.8}
                            onPress={() => handleToggleStatus(a)}
                          >
                            <Pill
                              label={a.status === 'published' ? 'Published' : 'Draft'}
                              color={a.status === 'published' ? COLORS.success : COLORS.warning}
                              icon={a.status === 'published' ? 'eye' : 'eye-off'}
                            />
                            <Text style={styles.statusHint}>
                              {a.status === 'published' ? 'tap to hide' : 'tap to publish'}
                            </Text>
                          </TouchableOpacity>
                          {a.kind === 'task' && (
                            <TouchableOpacity
                              style={styles.submissionsBtn}
                              activeOpacity={0.8}
                              onPress={() => router.push({
                                pathname: '/educator/(tabs)/task-submissions',
                                params: { taskId: a.id, taskTitle: a.title, courseName: a.course_name },
                              })}
                            >
                              <Ionicons name="people-outline" size={15} color={COLORS.purpleVibrant} />
                              <Text style={styles.submissionsBtnText}>
                                View submissions ({a.submission_count ?? 0})
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))
            ) : (
              <EmptyState
                icon="layers-outline"
                title="No activities here"
                text="Try a different filter or create a new activity for your class."
              />
            )}
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hintText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted },
  loadingState: { paddingVertical: 40, alignItems: 'center' },

  builderCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  fieldLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { backgroundColor: 'white', borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 14, marginTop: 20 },
  publishText: { color: 'white', fontSize: 14.5, fontFamily: FONTS.bold, fontWeight: '700' },

  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIconBg: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  cardMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  cardNote: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 17, marginTop: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  statusHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  submissionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: RADIUS.sm,
    backgroundColor: tint(COLORS.purpleVibrant),
  },
  submissionsBtnText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleVibrant },
});