/**
 * Actions for a quiz card shared in a group chat.
 *
 * A card used to do exactly one thing: route to `/course/quiz/{id}`, which only
 * works if the reader is on the quiz's course. A student who was in the group
 * but not the class got a dead end -- a title they could read and a button
 * that failed. The server now records that a quiz was shared into a group
 * (QuizGroupShare) and serves a portable package to anyone in that group, so
 * the useful outcomes are:
 *
 *   - Preview: read the questions here, no attempt recorded, no XP.
 *   - Add to My Quizzes: import a private copy the reader can actually take.
 *   - Save as file: write the package to disk to pass on or keep.
 *
 * The import is a copy, not a reference, so importing never exposes the source
 * quiz's class or grading -- and the reader's copy is not attached to a course.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import BottomSheet from '@/components/BottomSheet';
import {
  getQuizPackage,
  importQuizPackage,
  type QuizPackage,
} from '@/services/quizService';

const COLORS = {
  bg: '#F4F2FA',
  surface: '#FFFFFF',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  success: '#10B981',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  quizId: number;
  title: string;
  questionCount?: number;
  quizType?: string;
  /** Called after a successful import so the caller can refresh its quiz list. */
  onImported?: (quizId: number) => void;
}

/** Turn a quiz title into a safe, readable filename. */
function safeFileName(title: string): string {
  const base = title
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'quiz'}-sage-quiz.json`;
}

export default function QuizShareSheet({
  visible,
  onClose,
  quizId,
  title,
  questionCount,
  quizType,
  onImported,
}: Props) {
  const [pkg, setPkg] = useState<QuizPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'import' | 'save' | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setShowPreview(false);
    try {
      setPkg(await getQuizPackage(quizId));
    } catch (err: any) {
      setPkg(null);
      setLoadError(err?.message || 'Could not open this quiz.');
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleImport = async () => {
    if (!pkg) return;
    setBusy('import');
    try {
      const created = await importQuizPackage(pkg);
      setBusy(null);
      onClose();
      onImported?.(created.id);
      Alert.alert(
        'Added to My Quizzes',
        `"${created.title}" is now yours to take. It is a private copy, so marks stay separate from the original.`,
      );
    } catch (err: any) {
      setBusy(null);
      Alert.alert('Could not add this quiz', err?.message || 'Please try again.');
    }
  };

  const handleSave = async () => {
    if (!pkg) return;
    setBusy('save');
    try {
      // `expo-file-system/legacy` is what the rest of the app uses; the modern
      // API moved these helpers and the legacy import is already a dependency.
      const dir = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}`;
      if (!dir) throw new Error('No writable location on this device.');
      const uri = `${dir}${safeFileName(title)}`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(pkg, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: title,
          UTI: 'public.json',
        });
      } else {
        Alert.alert('Saved', `The quiz package was saved to ${uri}`);
      }
      setBusy(null);
    } catch (err: any) {
      setBusy(null);
      Alert.alert('Could not save this quiz', err?.message || 'Please try again.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title || 'Shared quiz'}
      subtitle={[
        questionCount != null
          ? `${questionCount} ${questionCount === 1 ? 'question' : 'questions'}`
          : null,
        quizType || null,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purpleVibrant} />
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={32} color={COLORS.danger} />
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : !pkg ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>This quiz is not available.</Text>
        </View>
      ) : showPreview ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.previewList}>
          {pkg.questions.map((q, i) => (
            <View key={`${i}-${q.question_text.slice(0, 12)}`} style={styles.questionCard}>
              <Text style={styles.questionIndex}>Question {i + 1}</Text>
              <Text style={styles.questionText}>{q.question_text}</Text>
              {q.options.map((opt, oi) => (
                <View key={`${i}-${oi}`} style={styles.optionRow}>
                  <View style={styles.optionBullet} />
                  <Text style={styles.optionText}>{opt}</Text>
                </View>
              ))}
            </View>
          ))}
          <Pressable
            onPress={() => setShowPreview(false)}
            style={styles.secondaryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>Back to actions</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleImport}
            disabled={busy !== null}
            accessibilityRole="button"
          >
            {busy === 'import' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={19} color="#fff" />
                <Text style={styles.primaryBtnText}>Add to My Quizzes</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.actionsHint}>
            Takes a private copy you can edit and take on your own. Marks stay separate from the
            original.
          </Text>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setShowPreview(true)}
            accessibilityRole="button"
          >
            <Ionicons name="eye-outline" size={18} color={COLORS.purplePrimary} />
            <Text style={styles.secondaryBtnText}>Preview questions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleSave}
            disabled={busy !== null}
            accessibilityRole="button"
          >
            {busy === 'save' ? (
              <ActivityIndicator color={COLORS.purplePrimary} />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color={COLORS.purplePrimary} />
                <Text style={styles.secondaryBtnText}>Save as file</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  centered: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  errorText: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  actions: { paddingHorizontal: 20, gap: 10, paddingTop: 4 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  actionsHint: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    lineHeight: 16,
    marginBottom: 4,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.purplePrimary,
  },
  previewList: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  questionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  questionIndex: {
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.purpleVibrant,
  },
  questionText: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 4,
    lineHeight: 20,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  optionBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },
  optionText: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});
