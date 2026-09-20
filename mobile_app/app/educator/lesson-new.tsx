import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import { getMyCourses, createTopic, createNode, generateTopic, GenerateTopicResponse } from '@/services/courseService';
import { NODE_TYPE_CONFIG } from '@/types/learning';

type GeneratedNode = GenerateTopicResponse['nodes'][number];

interface CourseOption {
  id: number;
  name: string;
}

export default function CreateLessonScreen() {
  const router = useRouter();

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<number | null>(null);

  const [aiFile, setAiFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState('beginner');
  const [aiNodeCount, setAiNodeCount] = useState('4');
  const [generating, setGenerating] = useState(false);

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState<GenerateTopicResponse | null>(null);
  const [savingPreview, setSavingPreview] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          setCoursesLoading(true);
          const data = await getMyCourses();
          setCourses(data.map((c) => ({ id: c.id, name: c.name })));
        } catch {
          Alert.alert('Failed to load classes');
        } finally {
          setCoursesLoading(false);
        }
      })();
    }, []),
  );

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
    if (!selectedCourse) {
      Alert.alert('Class required', 'Pick the class this lesson belongs to.');
      return;
    }
    if (!aiFile) {
      Alert.alert('File required', 'Please select a file to generate from.');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateTopic(selectedCourse, {
        uri: aiFile.uri,
        name: aiFile.name,
        mimeType: aiFile.mimeType,
      }, {
        instructions: aiInstructions || undefined,
        difficulty: aiDifficulty,
        node_count: Number(aiNodeCount) || 4,
      });
      setPreviewData(result);
      setPreviewVisible(true);
    } catch (err) {
      Alert.alert('Generation failed', err instanceof Error ? err.message : 'AI could not generate content.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSavePreview = async () => {
    if (!previewData || !selectedCourse) return;
    setSavingPreview(true);
    try {
      const courseName = courses.find((c) => c.id === selectedCourse)?.name ?? '';
      const topic = await createTopic(selectedCourse, {
        title: previewData.title,
        description: previewData.description,
        order: 1000,
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
      const course = courses.find((c) => c.id === selectedCourse);
      router.replace({
        pathname: '/educator/(tabs)/course-detail',
        params: { courseId: String(selectedCourse), courseName: course?.name ?? courseName },
      });
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Could not save generated content.');
    } finally {
      setSavingPreview(false);
    }
  };

  return (
    <View style={styles.container}>
      <EducatorHeader title="New Lesson" subtitle="Generate a topic with AI" showBack />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {coursesLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
          </View>
        ) : courses.length === 0 ? (
          <EmptyState
            icon="school-outline"
            title="No classes yet"
            text="Create a class first so your lessons have a home."
          />
        ) : (
          <>
            <Text style={styles.label}>Class</Text>
            <View style={styles.chipRow}>
              {courses.map((course) => (
                <FilterChip
                  key={course.id}
                  label={course.name}
                  active={selectedCourse === course.id}
                  onPress={() => setSelectedCourse(course.id)}
                />
              ))}
            </View>

            <Text style={[styles.label, { marginTop: 20 }]}>Study material *</Text>
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
              style={[styles.createBtn, (!selectedCourse || !aiFile || generating) && { opacity: 0.5 }]}
              activeOpacity={0.85}
              onPress={handleGenerate}
              disabled={!selectedCourse || !aiFile || generating}
            >
              {generating ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="white" />
                  <Text style={styles.createBtnText}>Generate Lesson</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* AI preview modal */}
      <Modal animationType="slide" transparent visible={previewVisible} onRequestClose={() => !savingPreview && setPreviewVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Review Generated Lesson</Text>
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
                      <Text style={styles.createBtnText}>Save to Class</Text>
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

  label: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

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

  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

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