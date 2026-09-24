import { useEffect, useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getCourseActivities, ClassActivity } from '@/services/activityService';
import { getMySubmission, submitTask, TaskSubmissionFull } from '@/services/taskService';

const COLORS = {
  bg: '#FFFFFF',
  surface: '#F5F3FA',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  purpleGhost: '#DDD6FE',
  success: '#10B981',
  warning: '#F59E0B',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — matches the backend cap.

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskSubmitScreen() {
  const { taskId, courseId } = useLocalSearchParams<{ taskId: string; courseId: string }>();
  const router = useRouter();
  const tid = Number(taskId);

  const [task, setTask] = useState<ClassActivity | null>(null);
  const [submission, setSubmission] = useState<TaskSubmissionFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [opening, setOpening] = useState(false);

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
    } catch (e: any) {
      setError(e?.message || 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [tid, courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_FILE_SIZE) {
        Alert.alert('File too large', 'Max attachment size is 10 MB.');
        return;
      }
      setPicked(asset);
    } catch {
      Alert.alert('Error', 'Failed to pick file.');
    }
  };

  const handleSubmit = async () => {
    if (!picked) {
      Alert.alert('No file', 'Attach a file to submit.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await submitTask(tid, {
        uri: picked.uri,
        name: picked.name,
        mimeType: picked.mimeType,
      });
      setSubmission(created);
      setPicked(null);
      Alert.alert(
        submission ? 'Submission replaced' : 'Submitted',
        `"${created.file_name}" was uploaded for ${task?.title ?? 'this task'}.`,
      );
    } catch (err) {
      Alert.alert('Submit failed', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenFile = async (data: string, fileName: string, mime: string) => {
    setOpening(true);
    try {
      const uri = `${FileSystem.cacheDirectory}${fileName}`;
      const base64Body = data.includes('base64,') ? data.split('base64,')[1] : data;
      await FileSystem.writeAsStringAsync(uri, base64Body, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: mime });
      } else {
        Alert.alert('Cannot open file', 'File sharing is not available on this device.');
      }
    } catch {
      Alert.alert('Open failed', 'Could not open the file.');
    } finally {
      setOpening(false);
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
        <Text style={styles.errorText}>{error || 'Task not found.'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[COLORS.purpleDeep, COLORS.purpleDark]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Task</Text>
        <View style={{ width: 32 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.taskTitle}>{task.title}</Text>
          {task.due_date ? (
            <Text style={styles.taskMeta}>
              Due {new Date(task.due_date).toLocaleDateString()}
            </Text>
          ) : (
            <Text style={styles.taskMeta}>No due date</Text>
          )}
          {task.note ? (
            <Text style={styles.taskNote}>{task.note}</Text>
          ) : (
            <Text style={styles.taskNoteMuted}>No instructions provided.</Text>
          )}
        </View>

        <View style={[styles.card, { marginTop: 14 }]}>
          <Text style={styles.sectionLabel}>Your submission</Text>

          {submission ? (
            <View style={styles.submittedRow}>
              <View style={styles.submittedIcon}>
                <Ionicons name="checkmark" size={18} color="white" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.submittedTitle}>Submitted</Text>
                <Text style={styles.submittedMeta}>
                  {submission.file_name} · {formatBytes(submission.file_size)}
                </Text>
                <Text style={styles.submittedMeta}>
                  {new Date(submission.submitted_at).toLocaleString()}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.taskNoteMuted}>Not submitted yet. Attach a file below to complete this task.</Text>
          )}

          <TouchableOpacity style={styles.fileBtn} activeOpacity={0.8} onPress={handlePick} disabled={submitting}>
            <Ionicons name={picked ? 'document' : 'cloud-upload'} size={20} color={picked ? COLORS.success : COLORS.purpleVibrant} />
            <Text style={[styles.fileBtnText, picked && { color: COLORS.success }]}>
              {picked
                ? `${picked.name}${picked.size ? ` · ${formatBytes(picked.size)}` : ''}`
                : submission ? 'Replace file (pick a new one)' : 'Attach a file (PDF, DOCX, images, ...)'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitBtn, (!picked || submitting) && { opacity: 0.6 }]}
            activeOpacity={0.85}
            onPress={handleSubmit}
            disabled={!picked || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="send" size={16} color="white" />
                <Text style={styles.submitBtnText}>{submission ? 'Replace Submission' : 'Submit Task'}</Text>
              </>
            )}
          </TouchableOpacity>

          {submission && (
            <TouchableOpacity
              style={styles.openBtn}
              activeOpacity={0.8}
              onPress={() => handleOpenFile(submission.file_data, submission.file_name, submission.file_mime)}
              disabled={opening}
            >
              {opening ? (
                <ActivityIndicator color={COLORS.purpleVibrant} />
              ) : (
                <>
                  <Ionicons name="share-outline" size={16} color={COLORS.purpleVibrant} />
                  <Text style={styles.openBtnText}>Open submitted file</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
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
  content: { padding: 20, paddingBottom: 40 },
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
  taskTitle: { fontSize: 18, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  taskMeta: { fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant, marginTop: 4 },
  taskNote: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 19, marginTop: 12 },
  taskNoteMuted: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, lineHeight: 19, marginTop: 12 },
  sectionLabel: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 12 },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  submittedIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submittedTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  submittedMeta: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 2 },
  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 14,
  },
  fileBtnText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, flex: 1 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purpleVibrant,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 14,
  },
  submitBtnText: { color: 'white', fontFamily: FONTS.bold, fontSize: 14, fontWeight: '700' },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.purpleGhost,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 10,
  },
  openBtnText: { color: COLORS.purpleVibrant, fontFamily: FONTS.semiBold, fontSize: 13, fontWeight: '600' },
});