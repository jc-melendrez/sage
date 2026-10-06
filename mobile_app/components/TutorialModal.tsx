import React, { useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  purpleVibrant: '#8B5CF6',
  textPrimary: '#3A107A',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
  surface: '#FFFFFF',
};

const TABS = [
  { key: 'course', label: 'Join Course', icon: 'book-outline' as const },
  { key: 'quiz', label: 'Generate Quiz', icon: 'rocket-outline' as const },
  { key: 'group', label: 'Join Group', icon: 'people-outline' as const },
  { key: 'game', label: 'Play a Game', icon: 'game-controller-outline' as const },
  { key: 'practice', label: 'Practice Quizzes', icon: 'school-outline' as const },
];

const STEPS: Record<string, { title: string; body: string }[]> = {
  course: [
    { title: 'Join a course', body: 'Use the course code from your educator to join their class.' },
    { title: 'See your class', body: 'Track progress and access quizzes assigned to you.' },
  ],
  quiz: [
    { title: 'Upload material', body: 'Paste text or upload a file to generate questions with AI.' },
    { title: 'Pick quiz type', body: 'Choose MCQ, True/False, Identification, or Fill-in-the-Blank.' },
    { title: 'Save and share', body: 'Save your quiz to use in class or for practice.' },
  ],
  group: [
    { title: 'Join a group', body: 'Enter the group code to connect with classmates.' },
    { title: 'Chat and learn', body: 'Share resources and work together in real time.' },
  ],
  game: [
    { title: 'Host or join', body: 'Create a game room or join with a room code.' },
    { title: 'Play together', body: 'Answer questions in classic or team mode to compete.' },
  ],
  practice: [
    { title: 'Find a quiz', body: 'Browse quizzes by course or topic to practice anytime.' },
    { title: 'Review mistakes', body: 'Check explanations after each question to learn faster.' },
  ],
};

export default function TutorialModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('course');
  const [page, setPage] = useState(0);
  const steps = STEPS[tab] || [];
  const hasNext = page < steps.length - 1;
  const hasPrev = page > 0;

  const goNext = () => {
    if (hasNext) setPage(p => p + 1);
    else onClose();
  };
  const goPrev = () => setPage(p => Math.max(0, p - 1));
  const switchTab = (k: string) => {
    setTab(k);
    setPage(0);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Quick Tutorial</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close tutorial" hitSlop={8}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, tab === t.key && styles.tabActive]}
                onPress={() => switchTab(t.key)}
              >
                <Ionicons name={t.icon} size={16} color={tab === t.key ? '#FFF' : COLORS.textPrimary} />
                <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.content}>
            {steps[page] && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{steps[page].title}</Text>
                <Text style={styles.cardBody}>{steps[page].body}</Text>
              </View>
            )}
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
              ))}
            </View>
          </View>

          <View style={styles.footer}>
            {hasPrev ? (
              <TouchableOpacity style={styles.btnGhost} onPress={goPrev}>
                <Text style={styles.btnGhostText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity style={styles.btnPrimary} onPress={goNext}>
              <Text style={styles.btnPrimaryText}>{hasNext ? 'Next' : 'Done'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 360, backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 20, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontFamily: 'Montserrat-Bold', color: COLORS.textPrimary },
  tabs: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.purpleVibrant, borderColor: COLORS.purpleVibrant },
  tabLabel: { fontSize: 12, fontFamily: 'Montserrat-SemiBold', color: COLORS.textPrimary },
  tabLabelActive: { color: '#FFF' },
  content: { minHeight: 140, gap: 16, justifyContent: 'center' },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(139,92,246,0.05)' },
  cardTitle: { fontSize: 16, fontFamily: 'Montserrat-Bold', color: COLORS.textPrimary, marginBottom: 8 },
  cardBody: { fontSize: 14, fontFamily: 'Montserrat-Medium', color: COLORS.textMuted, lineHeight: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.purpleVibrant, width: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  btnGhost: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { fontFamily: 'Montserrat-SemiBold', color: COLORS.textPrimary },
  btnPrimary: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.purpleVibrant },
  btnPrimaryText: { fontFamily: 'Montserrat-SemiBold', color: '#FFF' },
});
