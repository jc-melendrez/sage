import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { createCourse, getMyCourses, CourseRoster } from '@/services/courseService';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function EducatorCoursesScreen() {
  const [courses, setCourses] = useState<CourseRoster[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    try {
      const data = await getMyCourses();
      setCourses(data);
    } catch (err) {
      Alert.alert('Failed to load courses', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCourses();
    }, [loadCourses])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadCourses();
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Course name required', 'Please give your course a name.');
      return;
    }
    setCreating(true);
    try {
      const course = await createCourse({ name: name.trim(), description: description.trim() });
      setModalVisible(false);
      setName('');
      setDescription('');
      setCreatedCode(course.join_code);
      await loadCourses();
    } catch (err) {
      Alert.alert('Failed to create course', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="My Courses"
        subtitle={`${courses.length} course${courses.length === 1 ? '' : 's'}`}
        rightIcon="add"
        onRightPress={() => setModalVisible(true)}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.section}>
          <SectionHeader title="Courses" actionLabel="New" onAction={() => setModalVisible(true)} />

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
            </View>
          ) : courses.length > 0 ? (
            <View style={{ gap: 14 }}>
              {courses.map((course) => (
                <View key={course.id} style={styles.courseCard}>
                  <View style={styles.courseHeader}>
                    <View style={styles.courseIconBg}>
                      <Ionicons name="book" size={20} color={COLORS.purpleVibrant} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.courseName}>{course.name}</Text>
                      <Text style={styles.courseMeta}>
                        {course.student_count} student{course.student_count === 1 ? '' : 's'} · created {formatDate(course.created_at)}
                      </Text>
                    </View>
                  </View>

                  {course.description ? (
                    <Text style={styles.courseDesc} numberOfLines={2}>{course.description}</Text>
                  ) : null}

                  <View style={styles.codeRow}>
                    <View style={styles.codeLabel}>
                      <Ionicons name="key" size={13} color={COLORS.purplePrimary} />
                      <Text style={styles.codeLabelText}>Join code</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.codeChip}
                      activeOpacity={0.8}
                      onPress={() => {
                        setCreatedCode(course.join_code);
                      }}
                    >
                      <Text style={styles.codeChipText}>{course.join_code}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="book-outline"
              title="No courses yet"
              text="Create your first course and share the join code so students can enroll."
            />
          )}
        </View>
      </ScrollView>

      {/* Create course modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Course</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Course name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Algebra I"
              placeholderTextColor={COLORS.textMuted}
              value={name}
              onChangeText={setName}
              autoCorrect={false}
            />

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What is this course about?"
              placeholderTextColor={COLORS.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={[styles.createBtn, creating && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={18} color="white" />
                  <Text style={styles.createBtnText}>Create Course</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Join code reveal modal */}
      <Modal animationType="fade" transparent visible={createdCode !== null} onRequestClose={() => setCreatedCode(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share join code</Text>
              <TouchableOpacity onPress={() => setCreatedCode(null)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.shareText}>
              Students can join this course by entering the code below:
            </Text>
            <View style={styles.codeDisplay}>
              <Text style={styles.codeDisplayText}>{createdCode}</Text>
            </View>
            <TouchableOpacity style={styles.doneBtn} activeOpacity={0.85} onPress={() => setCreatedCode(null)}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  courseCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  courseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  courseIconBg: { width: 40, height: 40, borderRadius: 20, backgroundColor: tint(COLORS.purpleVibrant), justifyContent: 'center', alignItems: 'center' },
  courseName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  courseMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  courseDesc: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textSecondary, lineHeight: 18, marginTop: 10 },

  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  codeLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  codeLabelText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted },
  codeChip: { backgroundColor: tint(COLORS.purplePrimary, 0.12), paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.pill },
  codeChipText: { fontSize: 14, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purplePrimary, letterSpacing: 1.5 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#F9FAFB', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  label: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: 'white', borderRadius: RADIUS.md, padding: 14, fontSize: 15, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.purplePrimary, paddingVertical: 16, borderRadius: RADIUS.md, marginTop: 24 },
  createBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },

  shareText: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 20, marginBottom: 16 },
  codeDisplay: { backgroundColor: COLORS.bgSecondary, borderRadius: RADIUS.md, paddingVertical: 18, alignItems: 'center' },
  codeDisplayText: { fontSize: 34, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.purpleDark, letterSpacing: 4 },
  doneBtn: { backgroundColor: COLORS.purplePrimary, alignItems: 'center', paddingVertical: 14, borderRadius: RADIUS.md, marginTop: 20 },
  doneBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },
});
