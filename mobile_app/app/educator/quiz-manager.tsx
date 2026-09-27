import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getQuizzes, type Quiz } from '@/services/quizService';
import { getMyCourses } from '@/services/courseService';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import { QuizDetailModal } from '@/components/educator/QuizDetailModal';
import { QuizOverflowButton, QuizOverflowMenu } from '@/components/educator/QuizOverflowMenu';
import { QuizEditorSheet } from '@/components/educator/QuizEditorSheet';
import { QuizGeneratorSheet } from '@/components/educator/QuizGeneratorSheet';

interface CourseOption {
  id: number;
  name: string;
}

export default function QuizManagerScreen() {
  const params = useLocalSearchParams<{ course?: string; generate?: string; edit?: string }>();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Class scoping
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<number | null>(
    params.course ? Number(params.course) : null,
  );

  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [infoModalQuiz, setInfoModalQuiz] = useState<Quiz | null>(null);
  const [menuQuiz, setMenuQuiz] = useState<Quiz | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

  const loadQuizzes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getQuizzes(selectedCourse ?? undefined);
      setQuizzes(data);
    } catch (error) {
      console.error('Failed to load quizzes:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCourse]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getMyCourses();
        if (!mounted) return;
        setCourses(data.map((c) => ({ id: c.id, name: c.name })));
      } catch {
        // non-fatal — chips just won't render
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (params.generate === '1') setGenerating(true);
  }, [params.generate]);

  useEffect(() => {
    loadQuizzes();
  }, [loadQuizzes]);

  const openEditor = useCallback((quiz: Quiz) => {
    setEditingQuiz(quiz);
  }, []);

  // Deep link: /educator/quiz-manager?edit=<quizId> opens that quiz's
  // editor as soon as the list has loaded.
  const requestedEditId = params.edit ? Number(params.edit) : null;
  const autoEditHandled = useRef(false);
  useEffect(() => {
    if (autoEditHandled.current) return;
    if (requestedEditId == null || Number.isNaN(requestedEditId)) return;
    const match = quizzes.find((q) => q.id === requestedEditId);
    if (!match) return;
    autoEditHandled.current = true;
    openEditor(match);
  }, [openEditor, requestedEditId, quizzes]);

  // --- 3-dots menu ---
  const openMenu = (quiz: Quiz, anchor: { x: number; y: number }) => {
    if (menuQuiz?.id === quiz.id) {
      setMenuQuiz(null);
      setMenuAnchor(null);
      return;
    }
    setMenuQuiz(quiz);
    setMenuAnchor(anchor);
  };

  const closeMenu = useCallback(() => {
    setMenuQuiz(null);
    setMenuAnchor(null);
  }, []);


  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Quiz & Content"
        subtitle={selectedCourse && courses.length > 0
          ? `${quizzes.length} quizzes · ${courses.find((c) => c.id === selectedCourse)?.name ?? ''}`
          : `${quizzes.length} quizzes · all classes`}
        rightIcon={generating ? 'close' : 'add'}
        onRightPress={() => setGenerating(!generating)}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Class filter */}
        {courses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.filterLabel}>Class</Text>
            <View style={styles.chipRow}>
              <FilterChip
                label="All"
                active={selectedCourse === null}
                onPress={() => setSelectedCourse(null)}
              />
              {courses.map((course) => (
                <FilterChip
                  key={course.id}
                  label={course.name}
                  active={selectedCourse === course.id}
                  onPress={() => setSelectedCourse(course.id)}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <SectionHeader title="Quizzes" />
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
            </View>
          ) : quizzes.length > 0 ? (
            <View style={{ gap: 12 }}>
              {quizzes.map((q) => (
                <View key={q.id} style={styles.quizCard}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => setInfoModalQuiz(q)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.quizCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.quizCardTitle}>{q.title}</Text>
                        <Text style={styles.quizCardMeta}>
                          {q.questions?.length || 0} questions · {q.quiz_type}
                        </Text>
                        {q.available_until ? (
                          <Text style={[styles.quizCardMeta, { color: COLORS.warning }]}>
                            Closes {new Date(q.available_until).toLocaleString()}
                          </Text>
                        ) : null}
                        {q.course != null && (
                          <Text style={styles.quizCardMeta}>
                            {courses.find((c) => c.id === q.course)?.name ?? `Class #${q.course}`}
                          </Text>
                        )}
                      </View>
                      <QuizOverflowButton quiz={q} onOpen={openMenu} />
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="document-text-outline" title="No quizzes yet" text="Tap + to create your first AI-generated quiz." />
          )}
        </View>
      </ScrollView>

      <QuizGeneratorSheet
        visible={generating}
        allowCourseSelection
        initialCourseId={selectedCourse}
        onClose={() => setGenerating(false)}
        onGenerated={loadQuizzes}
      />

      <QuizDetailModal
        quiz={infoModalQuiz}
        onClose={() => setInfoModalQuiz(null)}
        onEdit={(quiz) => {
          setInfoModalQuiz(null);
          openEditor(quiz);
        }}
        onChanged={loadQuizzes}
      />

      <QuizOverflowMenu
        quiz={menuQuiz}
        anchor={menuAnchor}
        onClose={closeMenu}
        onPreview={(quiz) => setInfoModalQuiz(quiz)}
        onEdit={openEditor}
        onChanged={loadQuizzes}
      />

      <QuizEditorSheet
        quiz={editingQuiz}
        onClose={() => setEditingQuiz(null)}
        onSaved={loadQuizzes}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  filterLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  loadingState: { paddingVertical: 40, alignItems: 'center' },

  quizCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  quizCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  quizCardTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  quizCardMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
});
