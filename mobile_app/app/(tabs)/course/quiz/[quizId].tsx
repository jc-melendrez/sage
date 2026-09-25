import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Modal, BackHandler } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getQuiz, Quiz, startQuizAttempt } from '@/services/quizService';
import { completeQuiz } from '@/services/gamificationService';
import TakeQuiz from '../../../../components/TakeQuiz';

export default function CourseQuizScreen() {
  const router = useRouter();
  const { quizId, courseId } = useLocalSearchParams<{ quizId: string; courseId?: string }>();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [closed, setClosed] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [showIntroModal, setShowIntroModal] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getQuiz(Number(quizId));
        if (!active) return;

        if (data.available_until && new Date(data.available_until).getTime() <= Date.now()) {
          setClosed(`This quiz closed on ${new Date(data.available_until).toLocaleString()}.`);
        } else {
          setQuiz(data);
          // Show intro modal when quiz loads
          setShowIntroModal(true);
        }
      } catch {
        Alert.alert('Failed to load quiz', 'Please try again.');
        if (active) router.back();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [quizId, router]);

  // Handle back button - dismiss intro modal first
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showIntroModal) {
        setShowIntroModal(false);
        router.back();
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [showIntroModal, router]);

  const handleBegin = async () => {
    if (!quiz) return;
    setStarting(true);
    try {
      await startQuizAttempt(quiz.id);
      setShowIntroModal(false);
      setStarted(true);
    } catch (err) {
      Alert.alert(
        'Cannot take quiz',
        err instanceof Error ? err.message : 'This quiz is no longer available.',
      );
      router.back();
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6D28D9" />
      </View>
    );
  }

  if (closed) {
    return (
      <View style={styles.center}>
        <View style={styles.blockedCard}>
          <View style={styles.blockedIconCircle}>
            <Ionicons name="lock-closed-outline" size={40} color="#F59E0B" />
          </View>
          <Text style={styles.blockedTitle}>Quiz Closed</Text>
          <Text style={styles.blockedText}>{closed}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!quiz) return null;

  if (!started) {
    return (
      <View style={styles.center}>
        <View style={styles.blockedCard}>
          <View style={styles.headerRow}>
            <View style={styles.blockedIconCircle}>
              <Ionicons name="document-text-outline" size={40} color="#6D28D9" />
            </View>
          </View>
          <Text style={styles.blockedTitle}>{quiz.title}</Text>
          <Text style={styles.blockedText}>
            {quiz.questions.length} questions
            {quiz.available_until
              ? ` · closes ${new Date(quiz.available_until).toLocaleString()}`
              : ''}
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, starting && { opacity: 0.6 }]}
            onPress={handleBegin}
            disabled={starting}
          >
            {starting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryBtnText}>Begin Quiz</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const questions = quiz.questions.map((q) => ({
    id: q.id,
    question: q.question_text,
    type: (quiz.quiz_type || 'Multiple Choice') as any,
    options: q.options,
    correct_answer: q.correct_answer,
  }));

  return (
    <>
      {started && (
        <TakeQuiz
          quizTitle={quiz.title}
          questions={questions}
          onFinish={async (score) => {
            const result = await completeQuiz(
              score,
              questions.length,
              courseId ? Number(courseId) : undefined,
              quiz.id,
            );
            return { xp: result.xp, badges: result.badges };
          }}
          onClose={() => router.back()}
        />
      )}

      {/* Intro Modal */}
      <Modal
        visible={showIntroModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => { setShowIntroModal(false); router.back(); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.introModalContent}>
            <View style={styles.introModalHeader}>
              <View style={styles.introModalIcon}>
                <Ionicons name="document-text-outline" size={32} color="#6D28D9" />
              </View>
              <Text style={styles.introModalTitle}>{quiz.title}</Text>
              <TouchableOpacity onPress={() => { setShowIntroModal(false); router.back(); }}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.introModalMeta}>
              <View style={styles.introMetaItem}>
                <Ionicons name="help-circle-outline" size={16} color="#6B7280" />
                <Text style={styles.introMetaText}>{quiz.questions.length} questions</Text>
              </View>
              <View style={styles.introMetaItem}>
                <Ionicons name="document-text-outline" size={16} color="#6B7280" />
                <Text style={styles.introMetaText}>{quiz.quiz_type}</Text>
              </View>
              {quiz.available_until && (
                <View style={styles.introMetaItem}>
                  <Ionicons name="time-outline" size={16} color="#F59E0B" />
                  <Text style={styles.introMetaText}>Closes {new Date(quiz.available_until).toLocaleString()}</Text>
                </View>
              )}
              <View style={styles.introMetaItem}>
                <Ionicons name="star-outline" size={16} color="#F59E0B" />
                <Text style={styles.introMetaText}>25 XP reward</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, starting && { opacity: 0.6 }]}
              onPress={handleBegin}
              disabled={starting}
            >
              {starting ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.primaryBtnText}>Take Quiz</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setShowIntroModal(false); router.back(); }}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', padding: 24 },
  blockedCard: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  blockedIcon: { fontSize: 44, marginBottom: 12 },
  blockedIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  blockedTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', textAlign: 'center', marginBottom: 8 },
  blockedText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    backgroundColor: '#6D28D9',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    alignSelf: 'stretch',
    minHeight: 48,
  },
  primaryBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },

  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#6D28D9', fontSize: 16, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  introModalContent: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 360,
  },
  introModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  introModalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  introModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', textAlign: 'center', flex: 1, paddingHorizontal: 12 },

  introModalMeta: { gap: 10, marginBottom: 24 },
  introMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
  },
  introMetaText: { fontSize: 14, color: '#374151' },
});