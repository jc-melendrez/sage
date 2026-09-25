import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { EmptyState } from '@/components/educator/EducatorPrimitives';
import {
  getTaskSubmissions,
  getTaskSubmissionFile,
  gradeTaskSubmission,
  TaskSubmission,
  TaskSubmissionFull,
} from '@/services/taskService';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getScoreColor(score: number | null | undefined, maxPoints: number): string {
  if (score === null || score === undefined) return COLORS.textMuted;
  const pct = (score / maxPoints) * 100;
  if (pct >= 70) return COLORS.success;
  if (pct >= 50) return COLORS.warning;
  return COLORS.danger;
}

export default function TaskSubmissionsScreen() {
  const { taskId, taskTitle, courseName } = useLocalSearchParams<{ taskId: string; taskTitle?: string; courseName?: string }>();
  const tid = Number(taskId);

  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<number | null>(null);

  // Grading modal state
  const [gradingSub, setGradingSub] = useState<TaskSubmission | null>(null);
  const [gradingFull, setGradingFull] = useState<TaskSubmissionFull | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [grading, setGrading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTaskSubmissions(tid);
      setSubmissions(data);
    } catch {
      setSubmissions([]);
      Alert.alert('Failed to load submissions', 'Could not fetch submissions for this task.');
    } finally {
      setLoading(false);
    }
  }, [tid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openSubmissionForGrading = async (sub: TaskSubmission) => {
    try {
      const full: TaskSubmissionFull = await getTaskSubmissionFile(tid, sub.id);
      setGradingSub(sub);
      setGradingFull(full);
      setScoreInput(full.score !== null && full.score !== undefined ? String(full.score) : '');
      setFeedbackInput(full.feedback || '');
    } catch {
      Alert.alert('Failed to load submission', 'Could not fetch submission details.');
    }
  };

  const openFile = async (sub: TaskSubmission, full: TaskSubmissionFull) => {
    setOpeningId(sub.id);
    try {
      const uri = `${FileSystem.cacheDirectory}${sub.file_name}`;
      const base64Body = full.file_data.includes('base64,') ? full.file_data.split('base64,')[1] : full.file_data;
      await FileSystem.writeAsStringAsync(uri, base64Body, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: sub.file_mime });
      } else {
        Alert.alert('Cannot open file', 'File sharing is not available on this device.');
      }
    } catch {
      Alert.alert('Open failed', 'Could not open the submission file.');
    } finally {
      setOpeningId(null);
    }
  };

  const handleSaveGrade = async () => {
    if (gradingSub === null || gradingFull === null) return;
    const score = parseInt(scoreInput, 10);
    if (isNaN(score)) {
      Alert.alert('Invalid score', 'Please enter a valid number.');
      return;
    }
    const maxPoints = gradingFull.max_points || 100;
    if (score < 0 || score > maxPoints) {
      Alert.alert('Invalid score', `Score must be between 0 and ${maxPoints}.`);
      return;
    }
    setGrading(true);
    try {
      await gradeTaskSubmission(tid, gradingSub.id, { score, feedback: feedbackInput.trim() });
      setGradingSub(null);
      setGradingFull(null);
      setScoreInput('');
      setFeedbackInput('');
      load();
      Alert.alert('Grade saved', 'The submission has been graded.');
    } catch (err) {
      Alert.alert('Failed to save grade', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setGrading(false);
    }
  };

  const closeGradingModal = () => {
    setGradingSub(null);
    setGradingFull(null);
    setScoreInput('');
    setFeedbackInput('');
  };

  const maxPoints = gradingFull?.max_points || 100;

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Submissions"
        subtitle={taskTitle || `Submissions for task #${tid}`}
        showBack
      />

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
        </View>
      ) : submissions.length === 0 ? (
        <EmptyState
          icon="cloud-upload-outline"
          title="No submissions yet"
          text={`Students in ${courseName || 'this class'} have not submitted anything for this task.`}
        />
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.summary}>
            {submissions.length} submission{submissions.length === 1 ? '' : 's'} received
          </Text>
          <View style={{ gap: 12 }}>
            {submissions.map((sub) => {
              const score = sub.score ?? null;
              const scoreColor = getScoreColor(score, sub.max_points || 100);
              return (
                <View key={sub.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {sub.student_name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentName}>{sub.student_name}</Text>
                      <Text style={styles.submittedAt}>
                        Submitted {new Date(sub.submitted_at).toLocaleString()}
                      </Text>
                    </View>
                    {score !== null && score !== undefined && (
                      <View style={styles.scoreBadge}>
                        <Text style={[styles.scoreBadgeText, { color: scoreColor }]}>
                          {score} / {sub.max_points || 100}
                        </Text>
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    style={styles.fileRow}
                    activeOpacity={0.75}
                    onPress={() => openSubmissionForGrading(sub)}
                    disabled={openingId === sub.id}
                  >
                    <View style={[styles.fileIcon, { backgroundColor: tint(COLORS.accent) }]}>
                      <Ionicons name="document" size={16} color={COLORS.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>{sub.file_name}</Text>
                      <Text style={styles.fileMeta}>{formatBytes(sub.file_size)}</Text>
                    </View>
                    {openingId === sub.id ? (
                      <ActivityIndicator size="small" color={COLORS.purpleVibrant} />
                    ) : (
                      <Ionicons name="eye-outline" size={18} color={COLORS.purpleVibrant} />
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Grading Modal */}
      {gradingSub && gradingFull && (
        <Modal
          animationType="slide"
          transparent
          visible={true}
          onRequestClose={closeGradingModal}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalOverlay}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Grade Submission</Text>
                <TouchableOpacity onPress={closeGradingModal} activeOpacity={0.7}>
                  <Ionicons name="close" size={24} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>

              <View style={styles.studentInfo}>
                <View style={styles.avatarLarge}>
                  <Text style={styles.avatarLargeText}>
                    {gradingSub.student_name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.studentNameLarge}>{gradingSub.student_name}</Text>
                <Text style={styles.submittedAtLarge}>
                  Submitted {new Date(gradingSub.submitted_at).toLocaleString()}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.fileRowModal}
                activeOpacity={0.75}
                onPress={() => openFile(gradingSub, gradingFull)}
                disabled={openingId === gradingSub.id}
              >
                <View style={[styles.fileIcon, { backgroundColor: tint(COLORS.accent) }]}>
                  <Ionicons name="document" size={16} color={COLORS.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{gradingSub.file_name}</Text>
                  <Text style={styles.fileMeta}>{formatBytes(gradingSub.file_size)}</Text>
                </View>
                {openingId === gradingSub.id ? (
                  <ActivityIndicator size="small" color={COLORS.purpleVibrant} />
                ) : (
                  <Ionicons name="share-outline" size={18} color={COLORS.purpleVibrant} />
                )}
              </TouchableOpacity>

              <View style={styles.gradeForm}>
                <Text style={styles.fieldLabel}>Score</Text>
                <View style={styles.scoreInputRow}>
                  <TextInput
                    style={styles.scoreInput}
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    value={scoreInput}
                    onChangeText={setScoreInput}
                    keyboardType="numeric"
                    editable={!grading}
                  />
                  <Text style={styles.scoreMaxText}> / {maxPoints}</Text>
                </View>

                <Text style={styles.fieldLabel}>Feedback (optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Add feedback for the student..."
                  placeholderTextColor={COLORS.textMuted}
                  value={feedbackInput}
                  onChangeText={setFeedbackInput}
                  multiline
                  numberOfLines={4}
                  editable={!grading}
                />

                <TouchableOpacity
                  style={[styles.saveBtn, grading && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  onPress={handleSaveGrade}
                  disabled={grading}
                >
                  {grading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="white" />
                      <Text style={styles.saveBtnText}>Save Grade</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  loadingState: { paddingVertical: 60, alignItems: 'center' },
  summary: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginBottom: 16 },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(COLORS.purpleVibrant),
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleVibrant },
  studentName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  submittedAt: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 2 },
  scoreBadge: {
    backgroundColor: 'rgba(76, 29, 149, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  scoreBadgeText: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fileRowModal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fileIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  fileMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },

  studentInfo: { alignItems: 'center', marginBottom: 16 },
  avatarLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: tint(COLORS.purpleVibrant),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarLargeText: { fontSize: 24, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleVibrant },
  studentNameLarge: { fontSize: 18, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  submittedAtLarge: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 2 },

  gradeForm: { marginTop: 8 },
  fieldLabel: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 16 },
  scoreInputRow: { flexDirection: 'row', alignItems: 'center' },
  scoreInput: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    fontSize: 24,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: 'center',
  },
  scoreMaxText: { fontSize: 24, fontFamily: FONTS.bold, color: COLORS.textSecondary, marginLeft: 8 },
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontFamily: FONTS.regular,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    marginTop: 24,
  },
  saveBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },
});