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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState, Pill } from '@/components/educator/EducatorPrimitives';
import { getCoursePath, createTopic } from '@/services/courseService';
import { CoursePathTopic, LearningNode, NODE_TYPE_CONFIG } from '@/types/learning';

export default function CourseDetailScreen() {
  const router = useRouter();
  const { courseId, courseName } = useLocalSearchParams<{ courseId: string; courseName: string }>();
  const cid = Number(courseId);

  const [topics, setTopics] = useState<CoursePathTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const loadTopics = useCallback(async () => {
    try {
      const data = await getCoursePath(cid);
      setTopics(data);
    } catch {
      Alert.alert('Failed to load topics');
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useFocusEffect(useCallback(() => { loadTopics(); }, [loadTopics]));

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please give your topic a name.');
      return;
    }
    setCreating(true);
    try {
      await createTopic(cid, {
        title: title.trim(),
        description: description.trim(),
        order: topics.length,
      });
      setModalVisible(false);
      setTitle('');
      setDescription('');
      await loadTopics();
    } catch (err) {
      Alert.alert('Failed to create topic', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  };

  const totalNodes = topics.reduce((sum, t) => sum + t.nodes.length, 0);

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={courseName || 'Course'}
        subtitle={`${topics.length} topic${topics.length === 1 ? '' : 's'} · ${totalNodes} node${totalNodes === 1 ? '' : 's'}`}
        showBack
        rightIcon="add"
        onRightPress={() => setModalVisible(true)}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <SectionHeader title="Topics" actionLabel="Add" onAction={() => setModalVisible(true)} />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
          </View>
        ) : topics.length > 0 ? (
          <View style={{ gap: 14 }}>
            {topics.map((topic) => (
              <TouchableOpacity
                key={topic.id}
                activeOpacity={0.7}
                style={styles.topicCard}
                onPress={() => router.push({
                  pathname: '/educator/(tabs)/topic-detail',
                  params: { topicId: topic.id, topicName: topic.title, courseId: cid },
                })}
              >
                <View style={styles.topicHeader}>
                  <View style={styles.topicIconBg}>
                    <Ionicons name="layers" size={20} color={COLORS.purpleVibrant} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topicName}>{topic.title}</Text>
                    {topic.description ? (
                      <Text style={styles.topicDesc} numberOfLines={1}>{topic.description}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </View>

                {topic.nodes.length > 0 ? (
                  <View style={styles.nodeRow}>
                    {topic.nodes.map((node: LearningNode) => {
                      const cfg = NODE_TYPE_CONFIG[node.node_type] || NODE_TYPE_CONFIG.learn;
                      return (
                        <Pill
                          key={node.id}
                          label={cfg.label}
                          color={cfg.color}
                          icon={cfg.icon as any}
                        />
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.noNodes}>No nodes yet — tap to add content</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="layers-outline"
            title="No topics yet"
            text="Create your first topic to start adding lessons and quizzes."
          />
        )}
      </ScrollView>

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Topic</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Topic title</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Variables & Data Types"
              placeholderTextColor={COLORS.textMuted}
              value={title}
              onChangeText={setTitle}
              autoCorrect={false}
            />

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What will students learn in this topic?"
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
                  <Text style={styles.createBtnText}>Create Topic</Text>
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
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  topicCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  topicHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topicIconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(COLORS.purpleVibrant),
    justifyContent: 'center',
    alignItems: 'center',
  },
  topicName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  topicDesc: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },

  nodeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  noNodes: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 10, fontStyle: 'italic' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  label: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    marginTop: 24,
  },
  createBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },
});
