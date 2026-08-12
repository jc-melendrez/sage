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
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { colors } from '@/constants/theme';
import { getEnrolledCourses, joinCourseByCode, CourseSummary } from '@/services/courseService';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function StudentCoursesScreen() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');

  const loadCourses = useCallback(async () => {
    try {
      const data = await getEnrolledCourses();
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

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert('Enter a code', 'Please enter the join code shared by your educator.');
      return;
    }
    setJoining(true);
    try {
      await joinCourseByCode(trimmed);
      setJoinVisible(false);
      setCode('');
      await loadCourses();
      Alert.alert('Joined!', 'You are now enrolled in this course.');
    } catch (err) {
      Alert.alert('Could not join', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.purple[900]} translucent={false} />
      <LinearGradient
        colors={[colors.purple[900], colors.purple[700]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>My Courses</Text>
          <TouchableOpacity style={styles.headerBtn} activeOpacity={0.8} onPress={() => setJoinVisible(true)}>
            <Ionicons name="enter-outline" size={18} color="white" />
            <Text style={styles.headerBtnText}>Join</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerSub}>{courses.length} enrolled course{courses.length === 1 ? '' : 's'}</Text>
      </LinearGradient>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : courses.length > 0 ? (
          <View style={styles.list}>
            {courses.map((course) => (
              <View key={course.id} style={styles.card}>
                <View style={styles.cardIconBg}>
                  <Ionicons name="school" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{course.name}</Text>
                  <Text style={styles.cardMeta}>
                    {course.educator.display_name} · joined {formatDate(course.created_at)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBox}>
              <Ionicons name="school-outline" size={36} color={colors.purple[400]} />
            </View>
            <Text style={styles.emptyTitle}>No courses yet</Text>
            <Text style={styles.emptyText}>
              Ask your educator for a join code, then tap the Join button above to enroll.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} activeOpacity={0.85} onPress={() => setJoinVisible(true)}>
              <Ionicons name="enter-outline" size={16} color="white" />
              <Text style={styles.emptyBtnText}>Join with code</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal animationType="slide" transparent visible={joinVisible} onRequestClose={() => setJoinVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Join a course</Text>
              <TouchableOpacity onPress={() => setJoinVisible(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Join code</Text>
            <TextInput
              style={styles.codeInput}
              placeholder="e.g. A7X9PQ"
              placeholderTextColor={colors.textMuted}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={10}
            />

            <TouchableOpacity
              style={[styles.joinBtn, joining && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleJoin}
              disabled={joining}
            >
              {joining ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="enter" size={18} color="white" />
                  <Text style={styles.joinBtnText}>Join Course</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  headerTitle: { color: 'white', fontSize: 26, fontFamily: 'Montserrat-Bold', fontWeight: '700', letterSpacing: -0.5 },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
  },
  headerBtnText: { color: 'white', fontSize: 13, fontFamily: 'Montserrat-SemiBold', fontWeight: '600' },
  headerSub: { color: colors.purple[300], fontSize: 14, fontFamily: 'Montserrat-Medium' },

  content: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  list: { gap: 12 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardIconBg: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.purple[50], justifyContent: 'center', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontFamily: 'Montserrat-Bold', fontWeight: '700', color: colors.text, marginBottom: 2 },
  cardMeta: { fontSize: 12, fontFamily: 'Montserrat-Regular', color: colors.textMuted },

  emptyCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 32, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' },
  emptyIconBox: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.purple[50], justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  emptyTitle: { color: colors.purple[700], fontSize: 15, fontFamily: 'Montserrat-Bold', fontWeight: '700', marginBottom: 6 },
  emptyText: { color: colors.purple[400], fontSize: 13, fontFamily: 'Montserrat-Regular', textAlign: 'center', lineHeight: 19, marginBottom: 16 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9999 },
  emptyBtnText: { color: 'white', fontSize: 13, fontFamily: 'Montserrat-Bold', fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.background, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: 'Montserrat-Bold', fontWeight: '700', color: colors.text },
  label: { fontSize: 13, fontFamily: 'Montserrat-SemiBold', fontWeight: '600', color: colors.textMuted, marginBottom: 8 },
  codeInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 24,
    fontFamily: 'Montserrat-Black',
    fontWeight: '900',
    letterSpacing: 6,
    textAlign: 'center',
    color: colors.purple[700],
    borderWidth: 1,
    borderColor: colors.border,
  },
  joinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 12, marginTop: 24 },
  joinBtnText: { color: 'white', fontFamily: 'Montserrat-Bold', fontWeight: '700', fontSize: 15 },
});
