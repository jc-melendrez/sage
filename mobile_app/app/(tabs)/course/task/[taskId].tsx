import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getCourseActivities,
  ClassActivity,
  getTaskAttachment,
} from '@/services/activityService';
import {
  deleteMySubmission,
  deleteTaskSubmissionFile,
  getMySubmission,
  getTaskSubmissionFile,
  submitTaskFiles,
  TaskSubmissionFull,
  updateMySubmissionNote,
} from '@/services/taskService';
import { describeDue } from '@/services/dueDate';
import { formatBytes, pickDocuments, shareBase64File } from '@/services/fileShare';

const COLORS = {
  bg: '#FFFFFF',
  surface: '#F5F3FA',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  purpleGhost: '#DDD6FE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#DC2626',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

function getScoreColor(score: number | null | undefined, maxPoints: number): string {
  if (score === null || score === undefined) return COLORS.textMuted;
  const pct = (score / maxPoints) * 100;
  if (pct >= 70) return COLORS.success;
  if (pct >= 50) return COLORS.warning;
  return COLORS.danger;
}

/** "3 files · 2.4 MB" */
function summarizeFiles(files: { file_size: number }[]): string {
  if (files.length === 0) return '';
  const total = files.reduce((sum, f) => sum + (f.file_size || 0), 0);
  const label = files.length === 1 ? '1 file' : `${files.length} files`;
  return `${label} · ${formatBytes(total)}`;
}

/**
 * A student's view of one assignment: the instructions and materials their
 * teacher set, the deadline, and their own turn-in with however many files
 * they need to hand in.
 */
export default function TaskSubmitScreen() {
  const { taskId, courseId } = useLocalSearchParams<{ taskId: string; courseId: string }>();
  const router = useRouter();
  const tid = Number(taskId);

  const [task, setTask] = useState<ClassActivity | null>(null);
  const [submission, setSubmission] = useState<TaskSubmissionFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingFile, setOpeningFile] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [activities, mine] = await Promise.all([
        getCourseActivities(Number(courseId)).catch(() => [] as ClassActivity[]),
        getMySubmission(tid).catch(() => null),
      ]);
      const found = activities.find((a) => a.id === tid) || null;
      setTask(found);
      setSubmission(mine);
      setNote(mine?.description ?? '');
    } catch (e: any) {
      setError(e?.message || 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [tid, courseId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Every pick-and-attach happens in one tap, like Teams' "Attach" button. */
  const handleAttach = async () => {
    if (!task?.allow_multiple_files && submission) {
      Alert.alert('One file only', 'Your teacher only accepts a single file for this assignment.');
      return;
    }
    const picked = await pickDocuments({ multiple: !!task?.allow_multiple_files });
    if (!picked.length) return;

    setBusy(true);
    try {
      const updated = await submitTaskFiles(tid, picked, note.trim() || undefined);
      setSubmission(updated);
      setNote(updated.description ?? '');
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNote = async () => {
    if (!submission) return;
    setBusy(true);
    try {
      setSubmission(await updateMySubmissionNote(tid, note.trim()));
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFile = (fileId: number, fileName: string) => {
    Alert.alert('Remove file?', `"${fileName}" will be removed from your turn-in.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteTaskSubmissionFile(tid, fileId);
            // The server clears the whole turn-in when the last file goes.
            const stillThere = await getMySubmission(tid).catch(() => null);
            setSubmission(stillThere);
            setNote(stillThere?.description ?? '');
          } catch (err) {
            Alert.alert('Could not remove', err instanceof Error ? err.message : 'Something went wrong.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleDiscardTurnIn = () => {
    Alert.alert('Turn in again?', 'Your teacher will see this as a brand new submission.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard & restart',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteMySubmission(tid);
            setSubmission(null);
            setNote('');
          } catch (err) {
            Alert.alert('Could not discard', err instanceof Error ? err.message : 'Something went wrong.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleOpenMaterial = async (attachmentId: number) => {
    setOpeningFile(attachmentId);
    try {
      const attachment = await getTaskAttachment(tid, attachmentId);
      await shareBase64File(attachment.file_data, attachment.file_name, attachment.file_mime);
    } finally {
      setOpeningFile(null);
    }
  };

  const handleOpenOwnFile = async (fileId: number) => {
    setOpeningFile(fileId);
    try {
      const file = await getTaskSubmissionFile(tid, fileId);
      await shareBase64File(file.file_data, file.file_name, file.file_mime);
    } finally {
      setOpeningFile(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleDark} />
      </View>
    );
  }

  if (error || !task) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.errorText}>{error || 'Assignment not found.'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const due = describeDue(task.due_date);
  const hasGrade = submission?.score !== null && submission?.score !== undefined;
  const maxPoints = task.max_points || 100;
  const gradedBy = submission?.graded_by_name;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[COLORS.purpleDeep, COLORS.purpleDark]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Assignment</Text>
        <View style={{ width: 32 }} />
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* --- What the student has to do --- */}
          <View style={styles.card}>
            <Text style={styles.taskTitle}>{task.title}</Text>

            <View style={styles.metaRow}>
              <View
                style={[
                  styles.dueBadge,
                  due.isOverdue && { backgroundColor: 'rgba(220, 38, 38, 0.12)' },
                ]}
              >
                <Ionicons
                  name={due.isOverdue ? 'alert-circle' : 'time-outline'}
                  size={14}
                  color={due.isOverdue ? COLORS.danger : COLORS.purpleVibrant}
                />
                <Text
                  style={[
                    styles.dueBadgeText,
                    due.isOverdue && { color: COLORS.danger },
                  ]}
                >
                  {due.label}
                </Text>
              </View>
              <View style={styles.pointsBadge}>
                <Ionicons name="star-outline" size={14} color={COLORS.warning} />
                <Text style={styles.pointsBadgeText}>{maxPoints} points</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>Instructions</Text>
            {task.note ? (
              <Text style={styles.taskNote}>{task.note}</Text>
            ) : (
              <Text style={styles.taskNoteMuted}>
                Your teacher did not add any instructions for this assignment.
              </Text>
            )}
          </View>

          {/* --- Materials from the teacher --- */}
          {task.attachments && task.attachments.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Materials</Text>
              {task.attachments.map((att) => (
                <TouchableOpacity
                  key={att.id}
                  style={styles.fileRow}
                  activeOpacity={0.8}
                  onPress={() => handleOpenMaterial(att.id)}
                  disabled={openingFile !== null}
                >
                  <View style={styles.fileIcon}>
                    <Ionicons name="document-text" size={17} color={COLORS.purpleVibrant} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {att.file_name}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {formatBytes(att.file_size)}
                      {openingFile === att.id ? ' · opening…' : ''}
                    </Text>
                  </View>
                  <Ionicons name="download-outline" size={17} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* --- Grade, if the teacher has already marked it --- */}
          {hasGrade && (
            <View style={[styles.card, styles.gradeCard]}>
              <Text style={styles.sectionLabel}>Your grade</Text>
              <View style={styles.gradeRow}>
                <Text
                  style={[
                    styles.gradeScore,
                    { color: getScoreColor(submission!.score, maxPoints) },
                  ]}
                >
                  {submission!.score}
                </Text>
                <Text style={styles.gradeOutOf}>/ {maxPoints}</Text>
              </View>
              {submission!.feedback ? (
                <View style={styles.feedbackBox}>
                  <Text style={styles.feedbackLabel}>
                    Feedback{gradedBy ? ` from ${gradedBy}` : ''}
                  </Text>
                  <Text style={styles.feedbackText}>{submission!.feedback}</Text>
                </View>
              ) : (
                <Text style={styles.notGradedText}>No written feedback.</Text>
              )}
            </View>
          )}

          {/* --- The student's turn-in --- */}
          <View style={styles.card}>
            <View style={styles.turnInHead}>
              <Text style={styles.sectionLabel}>Your work</Text>
              {submission && (
                <View
                  style={[
                    styles.statusBadge,
                    submission.is_late
                      ? { backgroundColor: 'rgba(245, 158, 11, 0.15)' }
                      : { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
                  ]}
                >
                  <Ionicons
                    name={submission.is_late ? 'time' : 'checkmark-circle'}
                    size={12}
                    color={submission.is_late ? COLORS.warning : COLORS.success}
                  />
                  <Text
                    style={[
                      styles.statusBadgeText,
                      { color: submission.is_late ? COLORS.warning : COLORS.success },
                    ]}
                  >
                    {submission.is_late ? 'Turned in late' : 'Turned in'}
                  </Text>
                </View>
              )}
            </View>

            {submission && (
              <Text style={styles.submittedMeta}>
                {new Date(submission.submitted_at).toLocaleString()}
              </Text>
            )}

            {submission && submission.files.length > 0 ? (
              submission.files.map((file) => (
                <View key={file.id} style={styles.fileRow}>
                  <TouchableOpacity
                    style={styles.fileMain}
                    activeOpacity={0.8}
                    onPress={() => handleOpenOwnFile(file.id)}
                    disabled={openingFile !== null || busy}
                  >
                    <View style={styles.fileIcon}>
                      <Ionicons name="document-text" size={17} color={COLORS.purpleVibrant} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {file.file_name}
                      </Text>
                      <Text style={styles.fileMeta}>
                        {formatBytes(file.file_size)}
                        {openingFile === file.id ? ' · opening…' : ' · tap to open'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRemoveFile(file.id, file.file_name)}
                    hitSlop={8}
                    disabled={busy}
                  >
                    <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={styles.taskNoteMuted}>
                {submission
                  ? 'Your turn-in has no files left. Add one below.'
                  : 'Nothing turned in yet. Add your work below.'}
              </Text>
            )}

            {submission && (
              <>
                <Text style={styles.noteLabel}>Note to your teacher</Text>
                <TextInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Anything you want your teacher to know? (optional)"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  textAlignVertical="top"
                />
                {note.trim() !== (submission.description ?? '') && (
                  <TouchableOpacity style={styles.saveNoteBtn} onPress={handleSaveNote} disabled={busy}>
                    <Text style={styles.saveNoteText}>Save note</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.fileBtn, busy && { opacity: 0.6 }]}
              activeOpacity={0.8}
              onPress={handleAttach}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.purpleVibrant} />
              ) : (
                <>
                  <Ionicons
                    name="cloud-upload"
                    size={20}
                    color={submission ? COLORS.purpleVibrant : COLORS.success}
                  />
                  <Text style={styles.fileBtnText}>
                    {submission
                      ? task.allow_multiple_files
                        ? 'Add more files'
                        : 'Replace file'
                      : 'Turn in your work'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {submission && (
              <TouchableOpacity style={styles.discardBtn} onPress={handleDiscardTurnIn} disabled={busy}>
                <Text style={styles.discardText}>Discard this turn-in and start over</Text>
              </TouchableOpacity>
            )}

            {submission && (
              <Text style={styles.reassurance}>
                {summarizeFiles(submission.files)} — you can keep adding files until the deadline.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backBtn: { padding: 6, width: 36, alignItems: 'center' },
  headerTitle: { color: 'white', fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  errorText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.purpleDark, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 8 },
  retryText: { color: 'white', fontFamily: FONTS.semiBold, fontSize: 13 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, lineHeight: 26 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  dueBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(139, 92, 246, 0.12)', borderRadius: 9999,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  dueBadgeText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },
  pointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(245, 158, 11, 0.14)', borderRadius: 9999,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  pointsBadgeText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.warning },

  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 16 },
  sectionLabel: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 },
  taskNote: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 21 },
  taskNoteMuted: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, lineHeight: 19, fontStyle: 'italic' },

  gradeCard: { backgroundColor: 'rgba(139, 92, 246, 0.07)', borderColor: 'rgba(139, 92, 246, 0.3)' },
  gradeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 10 },
  gradeScore: { fontSize: 34, fontFamily: FONTS.extraBold, fontWeight: '800' },
  gradeOutOf: { fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  feedbackBox: { backgroundColor: 'white', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  feedbackLabel: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.textPrimary, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 5 },
  feedbackText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 19 },
  notGradedText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, fontStyle: 'italic' },

  turnInHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 9999, paddingHorizontal: 9, paddingVertical: 5 },
  statusBadgeText: { fontSize: 11, fontFamily: FONTS.bold },
  submittedMeta: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: -4, marginBottom: 10 },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'white', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  fileMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  fileIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.purpleGhost, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  fileMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },

  noteLabel: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 8, marginBottom: 6 },
  noteInput: {
    fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textPrimary, lineHeight: 19,
    backgroundColor: 'white', borderRadius: 12, borderWidth: 1,
    borderColor: COLORS.border, padding: 12, minHeight: 70,
  },
  saveNoteBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 9999, backgroundColor: COLORS.purpleGhost },
  saveNoteText: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },

  fileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'white', borderRadius: 12, padding: 15,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.purpleVibrant, marginTop: 14,
  },
  fileBtnText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },

  discardBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  discardText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, textDecorationLine: 'underline' },
  reassurance: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: 10 },
});
