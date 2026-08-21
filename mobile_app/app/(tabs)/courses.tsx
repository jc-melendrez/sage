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
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { getEnrolledCourses, joinCourseByCode, CourseSummary } from '@/services/courseService';

const { width } = Dimensions.get('window');

// 🎨 NEW PALETTE: Cosmic / Tech Academy
const THEME = {
  bgDark: '#0f172a',      // Slate 900
  bgCard: '#1e293b',      // Slate 800
  primary: '#6366f1',     // Indigo 500
  accent: '#22d3ee',      // Cyan 400
  success: '#10b981',     // Emerald 500
  locked: '#475569',      // Slate 600
  textMain: '#f8fafc',    // Slate 50
  textMuted: '#94a3b8',   // Slate 400
  glass: 'rgba(30, 41, 59, 0.7)',
  border: 'rgba(148, 163, 184, 0.1)',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function StudentCoursesScreen() {
  const router = useRouter();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');

  const loadCourses = useCallback(async () => {
    try {
      setLoading(true); // Ensure loading is true while fetching
      console.log("🚀 Fetching enrolled courses...");
      
      // 1. Restore the API call
      const data = await getEnrolledCourses();
      
      console.log("✅ API Response:", data); // <--- DEBUG LOG
      
      // 2. Set the courses state
      // Ensure data is an array, if API returns something else, default to []
      const safeData = Array.isArray(data) ? data : [];
      setCourses(safeData);
    } catch (err: any) {
      console.error("❌ Error loading courses:", err);
      Alert.alert('Failed to load courses', err instanceof Error ? err.message : 'Something went wrong.');
      setCourses([]); // Ensure empty on error
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
    } catch (err: any) {
      Alert.alert('Could not join', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setJoining(false);
    }
  };

  // --- Render Helpers ---

  const renderCourses = () => {
    if (courses.length === 0) return null;

    return (
      <View style={styles.courseList}>
        {courses.map((course) => (
          <TouchableOpacity
            key={course.id}
            style={styles.courseCard}
            activeOpacity={0.8}
            onPress={() => router.push(`/course/${course.id}` as any)}
          >
            <LinearGradient
              colors={[THEME.primary, '#4f46e5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.courseCardGradient}
            >
              <View style={styles.courseCardHeader}>
                <Ionicons name="book" size={20} color="white" />
                <Text style={styles.courseCardName} numberOfLines={2}>{course.name}</Text>
              </View>
              {course.description && (
                <Text style={styles.courseCardDesc} numberOfLines={2}>{course.description}</Text>
              )}
              <View style={styles.courseCardFooter}>
                <Ionicons name="people-outline" size={14} color="rgba(255,255,255,0.7)" />
                <Text style={styles.courseCardMeta}>{course.student_count} students</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name="arrow-forward-circle" size={28} color="rgba(255,255,255,0.8)" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', backgroundColor: THEME.bgDark }]}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  // Main View with Path
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.bgDark} translucent={false} />
      
      {/* Header */}
      <LinearGradient colors={[THEME.bgDark, '#1e1b4b']} style={styles.header}>
        <View style={styles.headerTop}>
            <View>
                <Text style={styles.headerSub}>Current Course</Text>
                <Text style={styles.headerTitle}>{courses[0]?.name || 'Learning Path'}</Text>
            </View>
            <TouchableOpacity style={styles.menuBtn} onPress={() => setJoinVisible(true)}>
                <Ionicons name="add" size={24} color={THEME.accent} />
            </TouchableOpacity>
        </View>
        
        {/* Progress Bar */}
        <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
                <LinearGradient 
                    colors={[THEME.accent, THEME.primary]} 
                    style={[styles.progressBarFill, { width: `${courses.length > 0 ? Math.min(100, (1 / courses.length) * 100) : 0}%` }]} 
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                />
            </View>
            <Text style={styles.progressText}>{courses.length > 0 ? `${courses.length} Enrolled` : 'No courses yet'}</Text>
        </View>
      </LinearGradient>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {courses.length === 0 && (
          <View style={styles.previewBanner}>
            <View style={styles.previewBannerIcon}>
              <Ionicons name="planet-outline" size={22} color={THEME.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewBannerTitle}>No enrolled courses yet</Text>
              <Text style={styles.previewBannerText}>
                Showing a preview path. Join a class with a code to unlock your real learning path.
              </Text>
            </View>
            <TouchableOpacity style={styles.previewJoinBtn} onPress={() => setJoinVisible(true)}>
              <Text style={styles.previewJoinText}>Join</Text>
            </TouchableOpacity>
          </View>
        )}
        {renderCourses()}
      </ScrollView>

      {/* Floating Action Button for Joining more */}
      <TouchableOpacity style={styles.fab} onPress={() => setJoinVisible(true)}>
        <Ionicons name="add" size={24} color={THEME.bgDark} />
      </TouchableOpacity>

      {/* Join Modal */}
      <Modal animationType="slide" transparent visible={joinVisible} onRequestClose={() => setJoinVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Join Class</Text>
                <TextInput
                    style={styles.codeInput}
                    placeholder="ENTER CODE"
                    placeholderTextColor={THEME.textMuted}
                    value={code}
                    onChangeText={(t) => setCode(t.toUpperCase())}
                    autoCapitalize="characters"
                    autoFocus
                />
                <TouchableOpacity style={styles.modalBtn} onPress={handleJoin} disabled={joining}>
                    {joining ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Launch</Text>}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bgDark },
  
  // Header
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 30,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerSub: {
    color: THEME.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    color: THEME.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },

  // Path / Nodes
  content: {
    flex: 1,
    paddingTop: 40,
  },
  pathContainer: {
    paddingHorizontal: 20,
    position: 'relative',
  },
  nodeRow: {
    minHeight: 140,
    justifyContent: 'center',
    position: 'relative',
  },
  connectorLine: {
    position: 'absolute',
    top: -40,
    bottom: 40,
    width: 2,
    borderStyle: 'dashed',
    opacity: 0.5,
    zIndex: 0,
  },
  nodeWrapper: {
    width: '50%',
    alignItems: 'center',
    zIndex: 1,
  },
  nodeHexagon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  nodeActive: {
    width: 90,
    height: 90,
    borderRadius: 28,
    shadowColor: THEME.primary,
    shadowOpacity: 0.6,
    shadowRadius: 15,
  },
  nodeLocked: {
    opacity: 0.6,
    borderWidth: 1,
    borderColor: THEME.locked,
  },
  nodeGlow: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: THEME.primary,
    opacity: 0.2,
    zIndex: -1,
  },
  nodeLabel: {
    marginTop: 12,
    color: THEME.textMain,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  checkBadge: {
    position: 'absolute',
    bottom: -5,
    right: -5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: THEME.success,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: THEME.bgDark,
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },

  // Preview Banner (shown when no enrolled courses)
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.bgCard,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    gap: 12,
  },
  previewBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(34, 211, 238, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewBannerTitle: {
    color: THEME.textMain,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  previewBannerText: {
    color: THEME.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  previewJoinBtn: {
    backgroundColor: THEME.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  previewJoinText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  joinBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  joinBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: THEME.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: THEME.bgCard,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 30,
    paddingBottom: 50,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  codeInput: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
    padding: 20,
    fontSize: 24,
    fontWeight: '800',
    color: THEME.accent,
    textAlign: 'center',
    letterSpacing: 4,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 20,
  },
  modalBtn: {
    backgroundColor: THEME.primary,
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Course cards
  courseList: {
    paddingHorizontal: 20,
    gap: 14,
  },
  courseCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  courseCardGradient: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  courseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  courseCardName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
  },
  courseCardDesc: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  courseCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  courseCardMeta: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
});