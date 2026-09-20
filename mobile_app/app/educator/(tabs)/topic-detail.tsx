import React, { useCallback, useState } from 'react';
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState } from '@/components/educator/EducatorPrimitives';
import { getCoursePath, updateTopic, deleteTopic } from '@/services/courseService';
import { LearningNode, NODE_TYPE_CONFIG } from '@/types/learning';

export default function TopicDetailScreen() {
  const router = useRouter();
  const { topicId, topicName, courseId } = useLocalSearchParams<{ topicId: string; topicName: string; courseId: string }>();
  const tid = Number(topicId);

  const [nodes, setNodes] = useState<LearningNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [topicTitle, setTopicTitle] = useState(topicName || 'Topic');
  const [topicDescription, setTopicDescription] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!courseId) { setLoading(false); return; }
        try {
          const data = await getCoursePath(Number(courseId));
          if (!active) return;
          const topic = data.find((t) => t.id === tid);
          setNodes(topic?.nodes || []);
          if (topic?.title) setTopicTitle(topic.title);
          if (topic?.description !== undefined) setTopicDescription(topic.description);
        } catch {
          if (active) Alert.alert('Failed to load nodes');
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [courseId, tid])
  );

  const openNode = (node: LearningNode) => {
    router.push({
      pathname: '/educator/(tabs)/add-node',
      params: { topicId: tid, order: node.order, nodeId: node.id },
    });
  };

  const openEditModal = () => {
    setEditTitle(topicTitle);
    setEditDescription(topicDescription);
    setEditOpen(true);
  };

  const handleSaveTopic = async () => {
    if (!editTitle.trim()) {
      Alert.alert('Title required', 'Give the topic a name.');
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await updateTopic(tid, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setTopicTitle(updated.title);
      setTopicDescription(updated.description);
      setEditOpen(false);
    } catch (err) {
      Alert.alert('Failed to save topic', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteTopic = () => {
    Alert.alert('Delete topic?', `"${topicTitle}" and all ${nodes.length} node${nodes.length === 1 ? '' : 's'} inside it will be removed from the course.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteTopic(tid);
            router.back();
          } catch (err) {
            Alert.alert('Failed to delete topic', err instanceof Error ? err.message : 'Something went wrong.');
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={topicTitle}
        subtitle={`${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
        showBack
        rightIcon="add"
        onRightPress={() => router.push({
          pathname: '/educator/(tabs)/add-node',
          params: { topicId: tid, order: nodes.length },
        })}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Topic settings */}
        <View style={styles.topicCard}>
          {topicDescription ? (
            <Text style={styles.topicDesc}>{topicDescription}</Text>
          ) : (
            <Text style={styles.topicDescMuted}>No description yet.</Text>
          )}
          <View style={styles.topicActions}>
            <TouchableOpacity style={styles.topicActionBtn} activeOpacity={0.8} onPress={openEditModal}>
              <Ionicons name="pencil" size={15} color={COLORS.purplePrimary} />
              <Text style={styles.topicActionText}>Edit Topic</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.topicActionBtn, styles.topicActionDanger]}
              activeOpacity={0.8}
              onPress={handleDeleteTopic}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={COLORS.danger} />
              ) : (
                <>
                  <Ionicons name="trash" size={15} color={COLORS.danger} />
                  <Text style={[styles.topicActionText, { color: COLORS.danger }]}>Delete Topic</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <SectionHeader title="Nodes" actionLabel="Add" onAction={() => router.push({
          pathname: '/educator/(tabs)/add-node',
          params: { topicId: tid, order: nodes.length },
        })} />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
          </View>
        ) : nodes.length > 0 ? (
          <View style={{ gap: 12 }}>
            {nodes.map((node, i) => {
              const cfg = NODE_TYPE_CONFIG[node.node_type] || NODE_TYPE_CONFIG.learn;
              return (
                <TouchableOpacity
                  key={node.id}
                  style={styles.nodeCard}
                  activeOpacity={0.8}
                  onPress={() => openNode(node)}
                >
                  <View style={[styles.nodeTypeBadge, { backgroundColor: tint(cfg.color) }]}>
                    <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nodeTitle}>{node.title}</Text>
                    <Text style={styles.nodeMeta}>
                      {cfg.label} · {node.xp_reward} XP · {node.estimated_minutes}min
                      {node.required_score > 0 ? ` · ${node.required_score}% pass` : ''}
                    </Text>
                  </View>
                  <View style={styles.orderBadge}>
                    <Text style={styles.nodeMeta}>{i + 1}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <EmptyState
            icon="cube-outline"
            title="No nodes yet"
            text="Add your first learning node — a lesson, practice quiz, or mastery check."
          />
        )}
      </ScrollView>

      {/* Edit topic modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Topic</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Waves"
              placeholderTextColor={COLORS.textMuted}
              value={editTitle}
              onChangeText={setEditTitle}
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What does this topic cover?"
              placeholderTextColor={COLORS.textMuted}
              value={editDescription}
              onChangeText={setEditDescription}
              multiline
            />

            <TouchableOpacity
              style={[styles.modalSaveBtn, savingEdit && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleSaveTopic}
              disabled={savingEdit}
            >
              {savingEdit ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color="white" />
                  <Text style={styles.modalSaveText}>Save Topic</Text>
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
    padding: 14,
    marginBottom: 20,
  },
  topicDesc: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textPrimary, lineHeight: 20 },
  topicDescMuted: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, fontStyle: 'italic' },
  topicActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  topicActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.purplePrimary,
    backgroundColor: tint(COLORS.purplePrimary, 0.08),
  },
  topicActionDanger: { borderColor: COLORS.danger, backgroundColor: tint(COLORS.danger, 0.08) },
  topicActionText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  nodeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nodeTypeBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  nodeMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },

  orderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(20, 10, 40, 0.45)', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.textPrimary },
  fieldLabel: {
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginTop: 18,
  },
  modalSaveText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 15 },
});