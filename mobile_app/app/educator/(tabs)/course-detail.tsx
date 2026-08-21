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
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState, Pill } from '@/components/educator/EducatorPrimitives';
import { getCoursePath, createTopic, createNode, generateTopic, GenerateTopicResponse } from '@/services/courseService';
import { CoursePathTopic, LearningNode, NODE_TYPE_CONFIG } from '@/types/learning';

type GeneratedNode = GenerateTopicResponse['nodes'][number];

export default function CourseDetailScreen() {
  const router = useRouter();
  const { courseId, courseName } = useLocalSearchParams<{ courseId: string; courseName: string }>();
  const cid = Number(courseId);

  const [topics, setTopics] = useState<CoursePathTopic[]>([]);
  const [loading, setLoading] = useState(true);

  // Add topic modal
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // AI generation modal
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiFile, setAiFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState('beginner');
  const [aiNodeCount, setAiNodeCount] = useState('4');
  const [generating, setGenerating] = useState(false);

  // AI preview
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState<GenerateTopicResponse | null>(null);
  const [savingPreview, setSavingPreview] = useState(false);

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

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        setAiFile(result.assets[0]);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick file.');
    }
  };

  const handleGenerate = async () => {
    if (!aiFile) {
      Alert.alert('File required', 'Please select a file to generate from.');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateTopic(cid, {
        uri: aiFile.uri,
        name: aiFile.name,
        mimeType: aiFile.mimeType,
      }, {
        instructions: aiInstructions || undefined,
        difficulty: aiDifficulty,
        node_count: Number(aiNodeCount) || 4,
      });
      setAiModalVisible(false);
      setAiFile(null);
      setAiInstructions('');
      setPreviewData(result);
      setPreviewVisible(true);
    } catch (err) {
      Alert.alert('Generation failed', err instanceof Error ? err.message : 'AI could not generate content.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSavePreview = async () => {
    if (!previewData) return;
    setSavingPreview(true);
    try {
      const topic = await createTopic(cid, {
        title: previewData.title,
        description: previewData.description,
        order: topics.length,
      });
      for (let i = 0; i < previewData.nodes.length; i++) {
        const n = previewData.nodes[i];
        await createNode(topic.id, {
          node_type: n.node_type,
          title: n.title,
          description: n.description,
          content_json: n.content_json,
          order: i,
          xp_reward: n.xp_reward,
          required_score: n.required_score,
          estimated_minutes: n.estimated_minutes,
        });
      }
      setPreviewVisible(false);
      setPreviewData(null);
      await loadTopics();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Could not save generated content.');
    } finally {
      setSavingPreview(false);
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

        {/* AI Generate button */}
        {!loading && (
          <TouchableOpacity
            style={styles.aiBtn}
            activeOpacity={0.85}
            onPress={() => setAiModalVisible(true)}
          >
            <Ionicons name="sparkles" size={18} color={COLORS.purplePrimary} />
            <Text style={styles.aiBtnText}>Generate Topic with AI</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Add topic modal */}
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

      {/* AI generation modal */}
      <Modal animationType="slide" transparent visible={aiModalVisible} onRequestClose={() => !generating && setAiModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate with AI</Text>
              <TouchableOpacity onPress={() => setAiModalVisible(false)} activeOpacity={0.7} disabled={generating}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Study material *</Text>
            <TouchableOpacity style={styles.fileBtn} activeOpacity={0.8} onPress={handlePickFile} disabled={generating}>
              <Ionicons name={aiFile ? 'document' : 'cloud-upload'} size={20} color={aiFile ? COLORS.success : COLORS.purpleVibrant} />
              <Text style={[styles.fileBtnText, aiFile && { color: COLORS.success }]}>
                {aiFile ? aiFile.name : 'Pick a file (PDF, DOCX, TXT)'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.label}>Additional instructions</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Focus on loops and conditionals"
              placeholderTextColor={COLORS.textMuted}
              value={aiInstructions}
              onChangeText={setAiInstructions}
              editable={!generating}
            />

            <View style={styles.settingsRow}>
              <View style={styles.settingsField}>
                <Text style={styles.label}>Difficulty</Text>
                {['beginner', 'intermediate', 'advanced'].map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.diffChip, aiDifficulty === d && styles.diffChipActive]}
                    activeOpacity={0.8}
                    onPress={() => setAiDifficulty(d)}
                    disabled={generating}
                  >
                    <Text style={[styles.diffText, aiDifficulty === d && styles.diffTextActive]}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.settingsField}>
                <Text style={styles.label}>Nodes</Text>
                <TextInput
                  style={styles.input}
                  placeholder="4"
                  placeholderTextColor={COLORS.textMuted}
                  value={aiNodeCount}
                  onChangeText={setAiNodeCount}
                  keyboardType="numeric"
                  editable={!generating}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.createBtn, (!aiFile || generating) && { opacity: 0.5 }]}
              activeOpacity={0.85}
              onPress={handleGenerate}
              disabled={!aiFile || generating}
            >
              {generating ? (
                <>
                  <ActivityIndicator color="white" />
                  <Text style={styles.createBtnText}>Generating...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="white" />
                  <Text style={styles.createBtnText}>Generate</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI preview modal */}
      <Modal animationType="slide" transparent visible={previewVisible} onRequestClose={() => !savingPreview && setPreviewVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Review Generated Topic</Text>
              <TouchableOpacity onPress={() => setPreviewVisible(false)} activeOpacity={0.7} disabled={savingPreview}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {previewData && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.previewTitle}>{previewData.title}</Text>
                {previewData.description ? (
                  <Text style={styles.previewDesc}>{previewData.description}</Text>
                ) : null}

                <Text style={[styles.label, { marginTop: 16 }]}>
                  {previewData.nodes.length} node{previewData.nodes.length === 1 ? '' : 's'} generated
                </Text>

                {previewData.nodes.map((node: GeneratedNode, i: number) => {
                  const cfg = NODE_TYPE_CONFIG[node.node_type] || NODE_TYPE_CONFIG.learn;
                  return (
                    <View key={i} style={styles.previewNode}>
                      <View style={[styles.previewNodeBadge, { backgroundColor: tint(cfg.color) }]}>
                        <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.previewNodeTitle}>{node.title}</Text>
                        <Text style={styles.previewNodeMeta}>
                          {cfg.label} · {node.xp_reward} XP · {node.estimated_minutes}min
                        </Text>
                      </View>
                    </View>
                  );
                })}

                <TouchableOpacity
                  style={[styles.createBtn, savingPreview && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  onPress={handleSavePreview}
                  disabled={savingPreview}
                >
                  {savingPreview ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="white" />
                      <Text style={styles.createBtnText}>Save Topic & Nodes</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
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

  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.purplePrimary,
    borderStyle: 'dashed',
    backgroundColor: tint(COLORS.purplePrimary, 0.06),
  },
  aiBtnText: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purplePrimary },

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

  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fileBtnText: { fontSize: 14, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textMuted, flex: 1 },

  settingsRow: { flexDirection: 'row', gap: 16 },
  settingsField: { flex: 1 },

  diffChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'white',
    marginBottom: 6,
  },
  diffChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  diffText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, textAlign: 'center' },
  diffTextActive: { color: 'white' },

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

  previewTitle: { fontSize: 18, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.textPrimary },
  previewDesc: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 18, marginTop: 4 },

  previewNode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  previewNodeBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewNodeTitle: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  previewNodeMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
});
