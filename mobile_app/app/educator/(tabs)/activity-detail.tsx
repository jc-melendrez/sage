import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { DueDateField } from '@/components/educator/DueDateField';
import { Pill } from '@/components/educator/EducatorPrimitives';
import {
  ClassActivity,
  UploadFile,
  deleteActivity,
  deleteActivityAttachment,
  getActivity,
  getTaskAttachment,
  updateActivity,
} from '@/services/activityService';
import { describeDue } from '@/services/dueDate';
import { formatBytes, pickDocuments, shareBase64File } from '@/services/fileShare';

const KIND_META: Record<ClassActivity['kind'], { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  task: { label: 'Assignment', icon: 'document-text' },
  quiz: { label: 'Quiz', icon: 'help-circle' },
  lesson: { label: 'Lesson', icon: 'book' },
  game: { label: 'Live Game', icon: 'game-controller' },
};

/**
 * View + edit a single activity: the educator's equivalent of a Teams
 * assignment page. Shows what students see (instructions, deadline, points,
 * materials) and lets the educator change any of it, publish it, or remove
 * it.
 */
export default function ActivityDetailScreen() {
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const router = useRouter();
  const id = Number(activityId);

  const [activity, setActivity] = useState<ClassActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openingFile, setOpeningFile] = useState<number | null>(null);

  // Draft edits; only written back to the server on Save.
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [points, setPoints] = useState('100');
  const [due, setDue] = useState<Date | null>(null);
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [newMaterials, setNewMaterials] = useState<UploadFile[]>([]);

  const hydrate = useCallback((data: ClassActivity) => {
    setActivity(data);
    setTitle(data.title);
    setInstructions(data.note ?? '');
    setPoints(String(data.max_points ?? 100));
    setDue(data.due_date ? new Date(data.due_date) : null);
    setAllowMultiple(data.allow_multiple_files ?? true);
    setNewMaterials([]);
  }, []);

  const load = useCallback(async () => {
    try {
      hydrate(await getActivity(id));
    } catch (e) {
      Alert.alert('Not found', e instanceof Error ? e.message : 'Could not load this activity.');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, hydrate, router]);

  useEffect(() => {
    load();
  }, [load]);

  // Compare instants, not strings: the API sends microseconds while
  // `toISOString()` truncates to milliseconds, so a raw string compare would
  // report an untouched deadline as edited.
  const sameDue = (a: Date | null, b: string | null): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const stored = new Date(b).getTime();
    return Number.isNaN(stored) ? false : stored === a.getTime();
  };

  const isDirty =
    !!activity &&
    (title !== activity.title ||
      instructions !== (activity.note ?? '') ||
      points !== String(activity.max_points ?? 100) ||
      !sameDue(due, activity.due_date) ||
      allowMultiple !== activity.allow_multiple_files ||
      newMaterials.length > 0);

  const handleSave = async () => {
    if (!activity) return;
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the assignment a title.');
      return;
    }
    const parsedPoints = parseInt(points, 10);
    if (Number.isNaN(parsedPoints) || parsedPoints < 1) {
      Alert.alert('Check points', 'Points must be a whole number of at least 1.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateActivity(id, {
        title: title.trim(),
        note: instructions,
        max_points: parsedPoints,
        due_date: due ? due.toISOString() : null,
        allow_multiple_files: allowMultiple,
        attachments: newMaterials.length ? newMaterials : undefined,
      });
      hydrate(updated);
      Alert.alert('Saved', 'Your changes are live for this assignment.');
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = () => {
    if (!activity) return;
    const next = activity.status === 'published' ? 'draft' : 'published';
    setSaving(true);
    updateActivity(id, { status: next })
      .then(hydrate)
      .catch((e) =>
        Alert.alert('Update failed', e instanceof Error ? e.message : 'Something went wrong.')
      )
      .finally(() => setSaving(false));
  };

  const handleDelete = () => {
    if (!activity) return;
    Alert.alert('Delete assignment?', `"${activity.title}" and all of its submissions will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          deleteActivity(id)
            .then(() => router.back())
            .catch((e) =>
              Alert.alert('Delete failed', e instanceof Error ? e.message : 'Something went wrong.')
            )
            .finally(() => setSaving(false));
        },
      },
    ]);
  };

  const handleRemoveMaterial = (attachmentId: number) => {
    Alert.alert('Remove material?', 'Students will no longer be able to open it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          deleteActivityAttachment(id, attachmentId)
            .then(() => load())
            .catch((e) =>
              Alert.alert('Remove failed', e instanceof Error ? e.message : 'Something went wrong.')
            )
            .finally(() => setSaving(false));
        },
      },
    ]);
  };

  const handleOpenMaterial = async (attachmentId: number) => {
    setOpeningFile(attachmentId);
    try {
      const attachment = await getTaskAttachment(id, attachmentId);
      await shareBase64File(attachment.file_data, attachment.file_name, attachment.file_mime);
    } finally {
      setOpeningFile(null);
    }
  };

  const handleAddMaterials = async () => {
    const picked = await pickDocuments({ multiple: true });
    if (picked.length) setNewMaterials((prev) => [...prev, ...picked]);
  };

  const handleViewSubmissions = () => {
    if (!activity) return;
    router.push({
      pathname: '/educator/(tabs)/task-submissions',
      params: {
        taskId: String(activity.id),
        taskTitle: activity.title,
        courseName: activity.course_name,
        maxPoints: String(activity.max_points),
      },
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }

  if (!activity) return null;

  const meta = KIND_META[activity.kind] ?? KIND_META.task;
  const dueInfo = describeDue(activity.due_date);
  const isTask = activity.kind === 'task';
  const savedMaterials = activity.attachments ?? [];

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={meta.label}
        subtitle={`${activity.course_name} · ${activity.status === 'published' ? 'Visible to students' : 'Draft — hidden from students'}`}
        showBack
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.statusRow}>
            <Pill
              label={activity.status === 'published' ? 'Published' : 'Draft'}
              color={activity.status === 'published' ? COLORS.success : COLORS.warning}
              icon={activity.status === 'published' ? 'checkmark-circle' : 'eye-off'}
            />
            <TouchableOpacity onPress={handleToggleStatus} disabled={saving} style={styles.statusToggle}>
              <Text style={styles.statusToggleText}>
                {activity.status === 'published' ? 'Unpublish' : 'Publish'}
              </Text>
            </TouchableOpacity>
          </View>

          {isTask && (
            <TouchableOpacity style={styles.submissionsBtn} activeOpacity={0.9} onPress={handleViewSubmissions}>
              <Ionicons name="people" size={18} color="white" />
              <Text style={styles.submissionsBtnText}>
                {activity.submission_count ?? 0} submitted
                {activity.graded_count ? ` · ${activity.graded_count} graded` : ''}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="white" />
            </TouchableOpacity>
          )}

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Assignment title"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={[styles.fieldLabel, styles.spaced]}>Instructions</Text>
            <TextInput
              style={styles.instructionsInput}
              value={instructions}
              onChangeText={setInstructions}
              placeholder="What should students do? Include any steps, examples, or a rubric."
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
            />

            <View style={styles.metaRow}>
              <View style={styles.metaCol}>
                <Text style={styles.fieldLabel}>Points</Text>
                <TextInput
                  style={styles.pointsInput}
                  value={points}
                  onChangeText={setPoints}
                  keyboardType="number-pad"
                  placeholder="100"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
              <View style={styles.metaCol}>
                <Text style={styles.fieldLabel}>Deadline</Text>
                <View style={styles.dueReadout}>
                  <Ionicons
                    name="time-outline"
                    size={15}
                    color={dueInfo.isOverdue ? COLORS.danger : COLORS.purpleVibrant}
                  />
                  <Text
                    style={[
                      styles.dueReadoutText,
                      dueInfo.isOverdue && { color: COLORS.danger },
                    ]}
                  >
                    {dueInfo.label}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.spaced} />
            <DueDateField value={due} onChange={setDue} />
          </View>

          {isTask && (
            <View style={styles.card}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Allow multiple files</Text>
                  <Text style={styles.switchHint}>
                    Students can attach a report, a spreadsheet, and anything else to one
                    turn-in.
                  </Text>
                </View>
                <Switch
                  value={allowMultiple}
                  onValueChange={setAllowMultiple}
                  trackColor={{ true: COLORS.purplePrimary, false: COLORS.border }}
                  thumbColor="white"
                />
              </View>
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Materials</Text>
              <Text style={styles.sectionCount}>{savedMaterials.length + newMaterials.length}</Text>
            </View>
            <Text style={styles.sectionHint}>
              Files students can download alongside the instructions.
            </Text>

            {savedMaterials.length === 0 && newMaterials.length === 0 && (
              <Text style={styles.emptyText}>No materials attached yet.</Text>
            )}

            {savedMaterials.map((att) => (
              <View key={`saved-${att.id}`} style={styles.fileRow}>
                <View style={styles.fileIcon}>
                  <Ionicons name="document-text" size={17} color={COLORS.purpleVibrant} />
                </View>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => handleOpenMaterial(att.id)}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {att.file_name}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {formatBytes(att.file_size)}
                    {openingFile === att.id ? ' · opening…' : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveMaterial(att.id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))}

            {newMaterials.map((file, index) => (
              <View key={`new-${file.uri}`} style={[styles.fileRow, styles.fileRowPending]}>
                <View style={[styles.fileIcon, { backgroundColor: tint(COLORS.success, 0.14) }]}>
                  <Ionicons name="document-text" size={17} color={COLORS.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={styles.fileMeta}>Not uploaded yet</Text>
                </View>
                <TouchableOpacity onPress={() => setNewMaterials((p) => p.filter((_, i) => i !== index))} hitSlop={8}>
                  <Ionicons name="close" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity style={styles.addFileBtn} activeOpacity={0.85} onPress={handleAddMaterials}>
              <Ionicons name="attach" size={17} color={COLORS.purpleVibrant} />
              <Text style={styles.addFileText}>Attach a file</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (!isDirty || saving) && { opacity: 0.5 }]}
            activeOpacity={0.9}
            onPress={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="white" />
                <Text style={styles.saveBtnText}>Save changes</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.85} onPress={handleDelete} disabled={saving}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
            <Text style={styles.deleteBtnText}>Delete this {meta.label.toLowerCase()}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 48, gap: 14 },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusToggle: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  statusToggleText: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.purpleDeep },

  submissionsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.md, padding: 14,
  },
  submissionsBtnText: { flex: 1, color: 'white', fontSize: 14, fontFamily: FONTS.bold },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  spaced: { marginTop: 6 },

  titleInput: {
    fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textPrimary,
    backgroundColor: 'white', borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 11,
  },
  instructionsInput: {
    fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textPrimary, lineHeight: 20,
    backgroundColor: 'white', borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: COLORS.border, padding: 12, minHeight: 130,
  },
  pointsInput: {
    fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary,
    backgroundColor: 'white', borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 11, marginTop: 6,
  },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  metaCol: { flex: 1 },
  dueReadout: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: 'white', borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 12,
  },
  dueReadoutText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.textPrimary, flex: 1 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  switchHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 17, marginTop: 3 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.extraBold, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.5 },
  sectionCount: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.purpleVibrant, backgroundColor: tint(COLORS.purpleVibrant, 0.14), paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.pill },
  sectionHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginBottom: 4 },
  emptyText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, fontStyle: 'italic', paddingVertical: 6 },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'white', borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: COLORS.border, padding: 12,
  },
  fileRowPending: { borderColor: COLORS.success, borderStyle: 'dashed' },
  fileIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: tint(COLORS.purpleVibrant, 0.12), alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  fileMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },

  addFileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: RADIUS.sm, borderWidth: 1, borderStyle: 'dashed',
    borderColor: COLORS.purpleVibrant, paddingVertical: 12,
  },
  addFileText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.md, paddingVertical: 15,
  },
  saveBtnText: { color: 'white', fontSize: 15, fontFamily: FONTS.bold },

  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  deleteBtnText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.danger },
});
