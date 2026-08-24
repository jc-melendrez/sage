import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { createNode } from '@/services/courseService';
import {
  NodeType,
  LearnContent,
  PracticeContent,
  ConceptBlock,
  ExampleBlock,
  InteractionBlock,
  SummaryBlock,
  QuizQuestion,
} from '@/types/learning';

const NODE_TYPES: { type: NodeType; label: string; icon: string; color: string }[] = [
  { type: 'learn', label: 'Learn', icon: 'book', color: '#7C3AED' },
  { type: 'practice', label: 'Practice', icon: 'brain', color: '#3B82F6' },
  { type: 'mastery', label: 'Mastery', icon: 'trophy', color: '#EAB308' },
];

const BLOCK_TYPES: { type: string; label: string; icon: string }[] = [
  { type: 'concept', label: 'Concept', icon: 'bulb' },
  { type: 'example', label: 'Example', icon: 'flask' },
  { type: 'interaction', label: 'Interaction', icon: 'help-circle' },
  { type: 'summary', label: 'Summary', icon: 'checkmark-circle' },
];

export default function AddNodeScreen() {
  const router = useRouter();
  const { topicId, order } = useLocalSearchParams<{ topicId: string; order: string }>();
  const tid = Number(topicId);
  const nodeOrder = Number(order) || 0;

  const [nodeType, setNodeType] = useState<NodeType>('learn');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [xpReward, setXpReward] = useState('25');
  const [requiredScore, setRequiredScore] = useState('70');
  const [estimatedMinutes, setEstimatedMinutes] = useState('5');
  const [saving, setSaving] = useState(false);

  // Learn blocks
  const [blocks, setBlocks] = useState<any[]>([]);

  // Practice/Mastery questions
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  // Block editor state
  const [expandedBlock, setExpandedBlock] = useState<number | null>(null);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please give your node a name.');
      return;
    }

    let contentJson: LearnContent | PracticeContent;

    if (nodeType === 'learn') {
      if (blocks.length === 0) {
        Alert.alert('No content', 'Add at least one block.');
        return;
      }
      contentJson = { blocks };
    } else {
      if (questions.length === 0) {
        Alert.alert('No questions', 'Add at least one question.');
        return;
      }
      contentJson = { questions };
    }

    setSaving(true);
    try {
      await createNode(tid, {
        node_type: nodeType,
        title: title.trim(),
        description: description.trim(),
        content_json: contentJson,
        order: nodeOrder,
        xp_reward: Number(xpReward) || 25,
        required_score: Number(requiredScore) || 70,
        estimated_minutes: Number(estimatedMinutes) || 5,
      });
      router.back();
    } catch (err) {
      Alert.alert('Failed to create node', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  // --- Block helpers (Learn) ---
  const addBlock = (type: string) => {
    let block: any;
    switch (type) {
      case 'concept':
        block = { type: 'concept', title: '', content: '' } as ConceptBlock;
        break;
      case 'example':
        block = { type: 'example', title: '', content: '', prompt: '' } as ExampleBlock;
        break;
      case 'interaction':
        block = {
          type: 'interaction', question: '', options: ['', '', '', ''],
          correct_index: 0, feedback_correct: 'Correct!', feedback_incorrect: 'Not quite.',
        } as InteractionBlock;
        break;
      case 'summary':
        block = { type: 'summary', points: [''] } as SummaryBlock;
        break;
      default:
        return;
    }
    const newBlocks = [...blocks, block];
    setBlocks(newBlocks);
    setExpandedBlock(newBlocks.length - 1);
  };

  const updateBlock = (index: number, updates: Record<string, any>) => {
    const newBlocks = [...blocks];
    newBlocks[index] = { ...newBlocks[index], ...updates };
    setBlocks(newBlocks);
  };

  const removeBlock = (index: number) => {
    setBlocks(blocks.filter((_, i) => i !== index));
    setExpandedBlock(null);
  };

  // --- Question helpers (Practice/Mastery) ---
  const addQuestion = () => {
    const q: QuizQuestion = { question: '', options: ['', '', '', ''], correct_answer: '', explanation: '' };
    setQuestions([...questions, q]);
  };

  const updateQuestion = (index: number, updates: Record<string, any>) => {
    const newQ = [...questions];
    newQ[index] = { ...newQ[index], ...updates };
    setQuestions(newQ);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  // --- Render: Learn block card ---
  const renderBlockCard = (block: any, index: number) => {
    const isExpanded = expandedBlock === index;
    const bt = BLOCK_TYPES.find((b) => b.type === block.type);

    return (
      <View key={index} style={styles.blockCard}>
        <TouchableOpacity
          style={styles.blockHeader}
          activeOpacity={0.7}
          onPress={() => setExpandedBlock(isExpanded ? null : index)}
        >
          <View style={[styles.blockTypeBadge, { backgroundColor: tint(COLORS.purpleVibrant) }]}>
            <Ionicons name={bt?.icon as any || 'cube'} size={14} color={COLORS.purpleVibrant} />
          </View>
          <Text style={styles.blockLabel}>{bt?.label || block.type}</Text>
          <Text style={styles.blockPreview} numberOfLines={1}>
            {block.type === 'summary'
              ? `${block.points?.length || 0} points`
              : block.type === 'interaction'
                ? block.question || 'New question'
                : block.title || 'Untitled'}
          </Text>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.blockBody}>
            {block.type === 'concept' && (
              <>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. What is a variable?"
                  placeholderTextColor={COLORS.textMuted}
                  value={block.title}
                  onChangeText={(v) => updateBlock(index, { title: v })}
                />
                <Text style={styles.fieldLabel}>Content</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Explain the concept..."
                  placeholderTextColor={COLORS.textMuted}
                  value={block.content}
                  onChangeText={(v) => updateBlock(index, { content: v })}
                  multiline
                />
              </>
            )}

            {block.type === 'example' && (
              <>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Assigning a variable"
                  placeholderTextColor={COLORS.textMuted}
                  value={block.title}
                  onChangeText={(v) => updateBlock(index, { title: v })}
                />
                <Text style={styles.fieldLabel}>Content</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Show the example..."
                  placeholderTextColor={COLORS.textMuted}
                  value={block.content}
                  onChangeText={(v) => updateBlock(index, { content: v })}
                  multiline
                />
                <Text style={styles.fieldLabel}>Prompt (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Try it yourself: ..."
                  placeholderTextColor={COLORS.textMuted}
                  value={block.prompt}
                  onChangeText={(v) => updateBlock(index, { prompt: v })}
                />
              </>
            )}

            {block.type === 'interaction' && (
              <>
                <Text style={styles.fieldLabel}>Question</Text>
                <TextInput
                  style={styles.input}
                  placeholder="What is 2 + 2?"
                  placeholderTextColor={COLORS.textMuted}
                  value={block.question}
                  onChangeText={(v) => updateBlock(index, { question: v })}
                />
                {(block.options as string[]).map((opt, oi) => (
                  <View key={oi} style={styles.optionRow}>
                    <TouchableOpacity
                      style={[styles.correctDot, block.correct_index === oi && styles.correctDotActive]}
                      onPress={() => updateBlock(index, { correct_index: oi })}
                    >
                      {block.correct_index === oi && (
                        <Ionicons name="checkmark" size={10} color="white" />
                      )}
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder={`Option ${oi + 1}`}
                      placeholderTextColor={COLORS.textMuted}
                      value={opt}
                      onChangeText={(v) => {
                        const newOpts = [...block.options];
                        newOpts[oi] = v;
                        updateBlock(index, { options: newOpts });
                      }}
                    />
                  </View>
                ))}
                <Text style={styles.fieldLabel}>Correct feedback</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Correct!"
                  placeholderTextColor={COLORS.textMuted}
                  value={block.feedback_correct}
                  onChangeText={(v) => updateBlock(index, { feedback_correct: v })}
                />
                <Text style={styles.fieldLabel}>Incorrect feedback</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Not quite. Try again!"
                  placeholderTextColor={COLORS.textMuted}
                  value={block.feedback_incorrect}
                  onChangeText={(v) => updateBlock(index, { feedback_incorrect: v })}
                />
              </>
            )}

            {block.type === 'summary' && (
              <>
                <Text style={styles.fieldLabel}>Key points</Text>
                {(block.points as string[]).map((pt, pi) => (
                  <View key={pi} style={styles.optionRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder={`Point ${pi + 1}`}
                      placeholderTextColor={COLORS.textMuted}
                      value={pt}
                      onChangeText={(v) => {
                        const newPts = [...block.points];
                        newPts[pi] = v;
                        updateBlock(index, { points: newPts });
                      }}
                    />
                    {(block.points as string[]).length > 1 && (
                      <TouchableOpacity
                        onPress={() => {
                          const newPts = (block.points as string[]).filter((_: string, i: number) => i !== pi);
                          updateBlock(index, { points: newPts });
                        }}
                      >
                        <Ionicons name="close-circle" size={20} color={COLORS.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.addPointBtn}
                  onPress={() => updateBlock(index, { points: [...(block.points as string[]), ''] })}
                >
                  <Ionicons name="add" size={14} color={COLORS.purplePrimary} />
                  <Text style={styles.addPointText}>Add point</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.deleteBlockBtn} onPress={() => removeBlock(index)}>
              <Ionicons name="trash" size={14} color={COLORS.danger} />
              <Text style={styles.deleteBlockText}>Remove block</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // --- Render: Question card (Practice/Mastery) ---
  const renderQuestionCard = (q: QuizQuestion, index: number) => (
    <View key={index} style={styles.blockCard}>
      <View style={styles.blockHeader}>
        <View style={[styles.blockTypeBadge, { backgroundColor: tint(COLORS.purpleVibrant) }]}>
          <Ionicons name="help-circle" size={14} color={COLORS.purpleVibrant} />
        </View>
        <Text style={styles.blockLabel}>Q{index + 1}</Text>
        <Text style={styles.blockPreview} numberOfLines={1}>{q.question || 'New question'}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => removeQuestion(index)}>
          <Ionicons name="close-circle" size={20} color={COLORS.danger} />
        </TouchableOpacity>
      </View>

      <View style={styles.blockBody}>
        <Text style={styles.fieldLabel}>Question</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. What does 'print()' do?"
          placeholderTextColor={COLORS.textMuted}
          value={q.question}
          onChangeText={(v) => updateQuestion(index, { question: v })}
        />
        {q.options.map((opt, oi) => (
          <View key={oi} style={styles.optionRow}>
            <TouchableOpacity
              style={[styles.correctDot, q.correct_answer === opt && opt !== '' && styles.correctDotActive]}
              onPress={() => opt && updateQuestion(index, { correct_answer: opt })}
            >
              {q.correct_answer === opt && opt !== '' && (
                <Ionicons name="checkmark" size={10} color="white" />
              )}
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={`Option ${oi + 1}`}
              placeholderTextColor={COLORS.textMuted}
              value={opt}
              onChangeText={(v) => {
                const newOpts = [...q.options];
                newOpts[oi] = v;
                const updates: Record<string, any> = { options: newOpts };
                if (q.correct_answer === q.options[oi]) {
                  updates.correct_answer = v;
                }
                updateQuestion(index, updates);
              }}
            />
          </View>
        ))}
        <Text style={styles.hint}>Tap the circle next to the correct answer</Text>

        <Text style={styles.fieldLabel}>Explanation (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Explain why this answer is correct..."
          placeholderTextColor={COLORS.textMuted}
          value={q.explanation}
          onChangeText={(v) => updateQuestion(index, { explanation: v })}
          multiline
        />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <EducatorHeader title="Add Node" showBack />

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Node Type Picker */}
        <Text style={styles.sectionTitle}>Node Type</Text>
        <View style={styles.typeRow}>
          {NODE_TYPES.map((nt) => (
            <TouchableOpacity
              key={nt.type}
              style={[styles.typeChip, nodeType === nt.type && { backgroundColor: nt.color, borderColor: nt.color }]}
              activeOpacity={0.8}
              onPress={() => {
                setNodeType(nt.type);
                setBlocks([]);
                setQuestions([]);
              }}
            >
              <Ionicons
                name={nt.icon as any}
                size={16}
                color={nodeType === nt.type ? 'white' : nt.color}
              />
              <Text style={[styles.typeChipText, nodeType === nt.type && { color: 'white' }]}>
                {nt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Settings */}
        <Text style={styles.sectionTitle}>Settings</Text>
        <Text style={styles.fieldLabel}>Title *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Introduction to Variables"
          placeholderTextColor={COLORS.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Brief description of this node..."
          placeholderTextColor={COLORS.textMuted}
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <View style={styles.settingsRow}>
          <View style={styles.settingsField}>
            <Text style={styles.fieldLabel}>XP</Text>
            <TextInput
              style={styles.input}
              placeholder="25"
              placeholderTextColor={COLORS.textMuted}
              value={xpReward}
              onChangeText={setXpReward}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.settingsField}>
            <Text style={styles.fieldLabel}>Pass %</Text>
            <TextInput
              style={styles.input}
              placeholder="70"
              placeholderTextColor={COLORS.textMuted}
              value={requiredScore}
              onChangeText={setRequiredScore}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.settingsField}>
            <Text style={styles.fieldLabel}>Minutes</Text>
            <TextInput
              style={styles.input}
              placeholder="5"
              placeholderTextColor={COLORS.textMuted}
              value={estimatedMinutes}
              onChangeText={setEstimatedMinutes}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Content Section */}
        {nodeType === 'learn' && (
          <>
            <Text style={styles.sectionTitle}>Lesson Blocks</Text>
            {blocks.map((block, i) => renderBlockCard(block, i))}

            <View style={styles.addBlockRow}>
              {BLOCK_TYPES.map((bt) => (
                <TouchableOpacity
                  key={bt.type}
                  style={styles.addBlockBtn}
                  activeOpacity={0.8}
                  onPress={() => addBlock(bt.type)}
                >
                  <Ionicons name={bt.icon as any} size={16} color={COLORS.purplePrimary} />
                  <Text style={styles.addBlockText}>{bt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {(nodeType === 'practice' || nodeType === 'mastery') && (
          <>
            <Text style={styles.sectionTitle}>Questions</Text>
            {questions.map((q, i) => renderQuestionCard(q, i))}

            <TouchableOpacity style={styles.addQuestionBtn} activeOpacity={0.8} onPress={addQuestion}>
              <Ionicons name="add-circle" size={18} color="white" />
              <Text style={styles.addQuestionText}>Add Question</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Save button — fixed at bottom */}
      <View style={styles.saveBar}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="white" />
              <Text style={styles.saveBtnText}>Save Node</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },

  sectionTitle: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginTop: 20,
    marginBottom: 12,
  },

  typeRow: { flexDirection: 'row', gap: 10 },
  typeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  typeChipText: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },

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

  settingsRow: { flexDirection: 'row', gap: 10 },
  settingsField: { flex: 1 },

  // Block cards
  blockCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  blockTypeBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blockLabel: { fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  blockPreview: { flex: 1, fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
  blockBody: { padding: 12, paddingTop: 0 },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  correctDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  correctDotActive: { backgroundColor: COLORS.success, borderColor: COLORS.success },

  addPointBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  addPointText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  deleteBlockBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, marginTop: 4 },
  deleteBlockText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.danger },

  addBlockRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  addBlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.purplePrimary,
    backgroundColor: tint(COLORS.purplePrimary, 0.08),
  },
  addBlockText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginTop: 12,
  },
  addQuestionText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 14 },

  hint: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, fontStyle: 'italic', marginTop: 4, marginBottom: 4 },

  // Save bar
  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
  },
  saveBtnText: { color: 'white', fontFamily: FONTS.bold, fontWeight: '700', fontSize: 16 },
});
