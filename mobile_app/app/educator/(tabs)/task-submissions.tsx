import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
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
  TaskSubmission,
  TaskSubmissionFull,
} from '@/services/taskService';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskSubmissionsScreen() {
  const { taskId, taskTitle, courseName } = useLocalSearchParams<{ taskId: string; taskTitle?: string; courseName?: string }>();
  const tid = Number(taskId);

  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<number | null>(null);

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

  const openSubmission = async (sub: TaskSubmission) => {
    setOpeningId(sub.id);
    try {
      const full: TaskSubmissionFull = await getTaskSubmissionFile(tid, sub.id);
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
            {submissions.map((sub) => (
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
                </View>

                <TouchableOpacity
                  style={styles.fileRow}
                  activeOpacity={0.75}
                  onPress={() => openSubmission(sub)}
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
                    <Ionicons name="share-outline" size={18} color={COLORS.purpleVibrant} />
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </ScrollView>
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
  fileIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  fileMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 1 },
});