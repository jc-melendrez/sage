import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, Pill, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import {
  getActivities, createActivity, deleteActivity, updateActivity,
  ClassActivity, ActivityKind,
} from '@/services/activityService';
import { getMyCourses } from '@/services/courseService';
import { getQuizzes, Quiz } from '@/services/quizService';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ACTIVITY_META: Record<ActivityKind, { label: string; icon: any; color: string }> = {
  quiz: { label: 'Quiz', icon: 'help-circle', color: COLORS.purpleVibrant },
  lesson: { label: 'Lesson', icon: 'book', color: COLORS.accent },
  game: { label: 'Game', icon: 'game-controller', color: COLORS.success },
  task: { label: 'Assignment', icon: 'document-text', color: COLORS.warning },
};

const BUILDER_KINDS: ActivityKind[] = ['quiz', 'task'];

type Filter = 'all' | ActivityStatus;
type ActivityStatus = 'draft' | 'published';
type DueQuick = 'none' | 'today' | '1d' | '1w' | 'custom';

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
  const [bCustomDue, setBCustomDue] = useState<Date | null>(null);
  const [bStatus, setBStatus] = useState<ActivityStatus>('draft');
  const [bQuizId, setBQuizId] = useState<number | null>(null);
  const [bMaxPoints, setBMaxPoints] = useState('100');
  const [bAttachments, setBAttachments] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [classQuizzes, setClassQuizzes] = useState<Quiz[]>([]);
  const [saving, setSaving] = useState(false);

  // Date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [tempDate, setTempDate] = useState<Date>(new Date());

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

  const formatLocalDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const dueToISO = (): string | null => {
    const now = new Date();
    if (bDue === 'today') return formatLocalDate(now);
    if (bDue === '1d') return formatLocalDate(new Date(now.getTime() + 86400000));
    if (bDue === '1w') return formatLocalDate(new Date(now.getTime() + 604800000));
    if (bDue === 'custom' && bCustomDue) return formatLocalDate(bCustomDue);
    return null;
  };

  const openDatePicker = () => {
    setTempDate(bCustomDue || new Date());
    setDatePickerMode('date');
    setShowDatePicker(true);
  };

  const handleDateChange = ({ nativeEvent }: any) => {
    if (nativeEvent.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }
    const newDate = nativeEvent.timestamp ? new Date(nativeEvent.timestamp) : tempDate;
    setTempDate(newDate);
    if (datePickerMode === 'date') {
      setDatePickerMode('time');
    } else {
      // Time picked - combine date and time
      const combined = new Date(
        tempDate.getFullYear(),
        tempDate.getMonth(),
        tempDate.getDate(),
        newDate.getHours(),
        newDate.getMinutes()
      );
      setBCustomDue(combined);
      setBDue('custom');
      setShowDatePicker(false);
    }
  };

  const clearCustomDue = () => {
    setBCustomDue(null);
    setBDue('none');
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
    // Validate attachments size
    for (const file of bAttachments) {
      if (file.size && file.size > MAX_FILE_SIZE) {
        Alert.alert('File too large', `"${file.name}" exceeds 10 MB limit.`);
        return;
      }
    }

    const maxPoints = bMaxPoints.trim() === '' ? 100 : Math.max(1, parseInt(bMaxPoints, 10) || 100);

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
        max_points: bKind === 'task' ? maxPoints : undefined,
        attachments: bAttachments.length > 0 ? bAttachments : undefined,
      });
      setCreating(false);
      setBTitle('');
      setBNote('');
      setBDue('none');
      setBCustomDue(null);
      setBQuizId(null);
      setBMaxPoints('100');
      setBAttachments([]);
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

  const pickAttachments = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets.length) return;
      const newFiles = result.assets.filter((asset) => {
        if (asset.size && asset.size > MAX_FILE_SIZE) {
          Alert.alert('File too large', `"${asset.name}" exceeds 10 MB limit.`);
          return false;
        }
        return true;
      });
      setBAttachments((prev) => [...prev, ...newFiles]);
    } catch {
      Alert.alert('Error', 'Failed to pick files.');
    }
  };

  const removeAttachment = (index: number) => {
    setBAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

                {bKind === 'task' && (
                  <>
                    <Text style={styles.fieldLabel}>Max Points</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="100"
                      placeholderTextColor={COLORS.textMuted}
                      value={bMaxPoints}
                      onChangeText={(t) => setBMaxPoints(t)}
                      keyboardType="numeric"
                    />
                  </>
                )}

                {bKind === 'task' && (
                  <>
                    <Text style={styles.fieldLabel}>Attachments (optional)</Text>
                    <TouchableOpacity style={styles.fileBtn} activeOpacity={0.8} onPress={pickAttachments}>
                      <Ionicons name={bAttachments.length > 0 ? 'document' : 'cloud-upload'} size={20} color={bAttachments.length > 0 ? COLORS.success : COLORS.purpleVibrant} />
                      <Text style={[styles.fileBtnText, bAttachments.length > 0 && { color: COLORS.success }]}>
                        {bAttachments.length > 0
                          ? `${bAttachments.length} file${bAttachments.length > 1 ? 's' : ''} attached`
                          : 'Add files (PDF, DOCX, images, ...)'}
                      </Text>
                    </TouchableOpacity>
                    {bAttachments.length > 0 && (
                      <View style={styles.attachmentList}>
                        {bAttachments.map((file, idx) => (
                          <View key={idx} style={styles.attachmentItem}>
                            <Ionicons name="document-text" size={16} color={COLORS.purpleVibrant} />
                            <Text style={styles.attachmentName} numberOfLines={1}>{file.name}</Text>
                            <Text style={styles.attachmentSize}>{file.size ? formatBytes(file.size) : 'Unknown size'}</Text>
                            <TouchableOpacity onPress={() => removeAttachment(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Ionicons name="close-circle" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}

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
                    ['custom', 'Custom…'],
                  ] as const).map(([value, label]) => (
                    <FilterChip
                      key={value}
                      label={label}
                      active={bDue === value}
                      onPress={() => value === 'custom' ? openDatePicker() : setBDue(value as DueQuick)}
                    />
                  ))}
                </View>
                {bDue === 'custom' && bCustomDue && (
                  <View style={styles.customDueRow}>
                    <Text style={styles.customDueText}>
                      Due: {new Date(bCustomDue).toLocaleString()}
                    </Text>
                    <TouchableOpacity onPress={clearCustomDue} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}

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
      {showDatePicker && Platform.OS !== 'web' && (
        <DateTimePicker
          testID="datePicker"
          value={tempDate}
          mode={datePickerMode}
          is24Hour={true}
          onChange={handleDateChange}
        />
      )}
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

  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fileBtnText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, flex: 1 },
  attachmentList: { marginTop: 8, gap: 6 },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  attachmentName: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1 },
  attachmentSize: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginRight: 8 },
  customDueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 8,
  },
  customDueText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary },
});