/**
 * Shared "about this quiz" sheet.
 *
 * Deliberately NOT a <Modal>. Android silently drops a second Modal stacked on
 * top of another, which is what made the quiz action menus dead. This renders
 * as an absolute overlay inside whatever tree the host screen already has.
 *
 * The reward line is hidden for quizzes the caller wrote themselves — the
 * backend pays 0 XP for those, so advertising "25 XP" would be a lie.
 */

import React from 'react';
import { View, Text, Pressable, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Only the fields the sheet actually renders. Both the activities list and the
 * course page satisfy this, so neither has to reshape its quiz object.
 */
export interface QuizInfo {
  id: number;
  title: string;
  quiz_type?: string;
  questions?: unknown[];
  available_until?: string | null;
  attempt_count?: number;
  is_owner?: boolean;
}

const COLORS = {
  purpleVibrant: '#8B5CF6',
  warning: '#F59E0B',
  success: '#10B981',
  danger: '#EF4444',
  textPrimary: '#3A107A',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Props {
  /** null hides the sheet. */
  quiz: QuizInfo | null;
  /** Attempts already made — drives the Start vs Retake label. */
  attempted?: boolean;
  starting?: boolean;
  onClose: () => void;
  onStart: () => void;
}

function deadlineLabel(iso: string): { text: string; expired: boolean } {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return { text: 'No deadline', expired: false };
  const expired = at <= Date.now();
  return {
    text: `${expired ? 'Closed' : 'Closes'} ${new Date(iso).toLocaleString()}`,
    expired,
  };
}

export default function QuizInfoModal({ quiz, attempted, starting, onClose, onStart }: Props) {
  if (!quiz) return null;

  const questionCount = quiz.questions?.length ?? 0;
  const selfAuthored = !!quiz.is_owner;
  // Retakes are unlimited, so an attempted quiz is still fully playable.
  const label = attempted ? 'Retake Quiz' : 'Start Quiz';
  const due = quiz.available_until ? deadlineLabel(quiz.available_until) : null;
  const closed = due?.expired ?? false;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />

      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.badgePill}>
              <Ionicons
                name={quiz.quiz_type === 't/f' ? 'checkmark-outline' : 'list-outline'}
                size={14}
                color={COLORS.purpleVibrant}
              />
              <Text style={styles.badgePillText}>{quiz.quiz_type || 'quiz'}</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={COLORS.textMuted} />
            </Pressable>
          </View>

          <Text style={styles.title}>{quiz.title}</Text>

          <View style={styles.metaRow}>
            <Ionicons name="help-circle-outline" size={16} color={COLORS.purpleVibrant} />
            <Text style={styles.metaText}>
              {questionCount} {questionCount === 1 ? 'question' : 'questions'}
            </Text>
          </View>

          {attempted ? (
            <View style={styles.metaRow}>
              <Ionicons name="repeat-outline" size={16} color={COLORS.purpleVibrant} />
              <Text style={styles.metaText}>
                Taken {quiz.attempt_count ?? 1} {quiz.attempt_count === 1 ? 'time' : 'times'} — retakes are unlimited
              </Text>
            </View>
          ) : null}

          {due ? (
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={16} color={due.expired ? COLORS.danger : COLORS.warning} />
              <Text style={[styles.metaText, due.expired ? { color: COLORS.danger } : null]}>{due.text}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.startBtn, closed && styles.startBtnClosed]}
            onPress={onStart}
            disabled={starting || closed}
            activeOpacity={0.8}
          >
            {starting ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Ionicons name={attempted ? 'repeat-outline' : 'play-outline'} size={18} color="white" />
                <Text style={styles.startBtnText}>{closed ? 'Quiz Closed' : label}</Text>
              </>
            )}
          </TouchableOpacity>

          {selfAuthored ? (
            <Text style={styles.footnote}>You wrote this quiz, so it does not award XP.</Text>
          ) : (
            // No amount here: the backend scores XP from the result, so any
            // fixed figure we printed here would be a guess.
            <Text style={styles.footnote}>Earns XP based on your score.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgePillText: { fontFamily: FONTS.semiBold, fontSize: 11, color: COLORS.purpleVibrant },
  closeBtn: { padding: 4 },
  title: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.textPrimary,
    marginTop: 12,
    marginBottom: 14,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  metaText: { flex: 1, fontFamily: FONTS.medium, fontSize: 13, color: COLORS.textMuted },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.success,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 8,
  },
  startBtnClosed: { backgroundColor: COLORS.textMuted },
  startBtnText: { color: '#FFFFFF', fontFamily: FONTS.bold, fontSize: 15 },
  footnote: {
    fontFamily: FONTS.medium,
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },
});
