import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Modal, FlatList, BackHandler } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getQuiz, Quiz, startQuizAttempt, getQuizShare } from '@/services/quizService';
import { completeQuiz } from '@/services/gamificationService';
import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/authService';
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
  const [showShareModal, setShowShareModal] = useState(false);
  const [userGroups, setUserGroups] = useState<{ id: string; name: string }[]>([]);

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
      if (showShareModal) {
        setShowShareModal(false);
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [showIntroModal, showShareModal, router]);

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

  const handleShare = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      
      // Fetch user's groups
      const res = await fetch(`${API_BASE_URL}/users/groups/mine/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const groups = await res.json();
        setUserGroups(groups.map((g: any) => ({ id: String(g.id), name: g.name })));
        setShowShareModal(true);
      }
    } catch {
      Alert.alert('Error', 'Failed to load groups');
    }
  }, []);

  const handleShareToGroup = useCallback(async (groupId: string) => {
    try {
      const shareData = await getQuizShare(Number(quizId));
      const token = await getToken();
      if (!token) return;

      await fetch(`${API_BASE_URL}/users/groups/${groupId}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: `📝 Quiz Shared: "${shareData.title}"`,
          attachments: [{
            type: 'quiz_embed',
            quiz_id: shareData.id,
            title: shareData.title,
            question_count: shareData.question_count,
            quiz_type: shareData.quiz_type,
            deep_link: shareData.deep_link,
          }],
        }),
      });
      setShowShareModal(false);
      Alert.alert('Shared!', 'Quiz sent to group chat.');
    } catch (err) {
      Alert.alert('Failed to share', err instanceof Error ? err.message : 'Please try again.');
    }
  }, [quizId]);

  const renderGroupItem = ({ item }: { item: { id: string; name: string } }) => (
    <TouchableOpacity
      style={styles.groupItem}
      onPress={() => handleShareToGroup(item.id)}
      activeOpacity={0.7}
    >
      <View style={styles.groupItemIcon}>
        <Ionicons name="people-outline" size={20} color="#6D28D9" />
      </View>
      <Text style={styles.groupItemName}>{item.name}</Text>
      <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
    </TouchableOpacity>
  );

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
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
              <Ionicons name="share-outline" size={22} color="#6D28D9" />
            </TouchableOpacity>
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

      {/* Share Modal */}
      <Modal
        visible={showShareModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share Quiz</Text>
              <TouchableOpacity onPress={() => setShowShareModal(false)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select a study group to share this quiz with</Text>
            {userGroups.length === 0 ? (
              <View style={styles.emptyGroups}>
                <Ionicons name="people-outline" size={32} color="#9CA3AF" />
                <Text style={styles.emptyGroupsText}>No study groups found</Text>
                <Text style={styles.emptyGroupsSub}>Create or join a group first</Text>
              </View>
            ) : (
              <FlatList
                data={userGroups}
                renderItem={renderGroupItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.groupList}
              />
            )}
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
  shareBtn: {
    padding: 8,
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

  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937' },
  modalSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 20 },
  emptyGroups: { alignItems: 'center', paddingVertical: 40 },
  emptyGroupsText: { fontSize: 16, fontWeight: '600', color: '#374151', marginTop: 12 },
  emptyGroupsSub: { fontSize: 14, color: '#9CA3AF', marginTop: 4 },
  groupList: { gap: 8 },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  groupItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupItemName: { flex: 1, fontSize: 16, fontWeight: '500', color: '#1F2937' },
});