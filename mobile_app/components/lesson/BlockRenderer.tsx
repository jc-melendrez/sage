import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LessonBlock, InteractionBlock } from '@/types/learning';

const COLORS = {
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleVibrant: '#8B5CF6',
  accent: '#22D3EE',
  success: '#10B981',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

// ── Concept Block ──
export function ConceptBlockView({ block }: { block: Extract<LessonBlock, { type: 'concept' }> }) {
  return (
    <View style={styles.block}>
      <View style={styles.conceptHeader}>
        {block.icon && <Text style={styles.conceptIcon}>{block.icon}</Text>}
        <Text style={styles.conceptTitle}>{block.title}</Text>
      </View>
      <Text style={styles.conceptContent}>{block.content}</Text>
      {block.visual && (
        <View style={styles.visualBox}>
          <Text style={styles.visualText}>{block.visual}</Text>
        </View>
      )}
    </View>
  );
}

// ── Example Block ──
export function ExampleBlockView({ block }: { block: Extract<LessonBlock, { type: 'example' }> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.block}>
      {block.title && (
        <View style={styles.exampleHeader}>
          {block.icon && <Text style={styles.conceptIcon}>{block.icon}</Text>}
          <Text style={styles.exampleTitle}>{block.title}</Text>
        </View>
      )}
      {block.prompt && <Text style={styles.examplePrompt}>{block.prompt}</Text>}
      <View style={styles.exampleContent}>
        <Text style={styles.exampleText}>{block.content}</Text>
      </View>
      {block.expandable && (
        <>
          <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded(!expanded)}>
            <Text style={styles.expandText}>{expanded ? 'Hide answer' : 'Show answer'}</Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.purpleVibrant} />
          </TouchableOpacity>
          {expanded && (
            <View style={styles.expandBox}>
              <Text style={styles.expandContent}>{block.expandable}</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ── Interaction Block ──
interface InteractionProps {
  block: InteractionBlock;
  onAnswer: (correct: boolean) => void;
}

export function InteractionBlockView({ block, onAnswer }: InteractionProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);

  const handleSelect = (index: number) => {
    if (answered) return;
    setSelected(index);
    setAnswered(true);
    onAnswer(index === block.correct_index);
  };

  const isCorrect = selected === block.correct_index;

  return (
    <View style={styles.block}>
      <View style={styles.interactionHeader}>
        {block.icon && <Text style={styles.conceptIcon}>{block.icon}</Text>}
        <Text style={styles.interactionQuestion}>{block.question}</Text>
      </View>

      <View style={styles.optionsContainer}>
        {block.options.map((opt, i) => {
      let optionStyle: any = styles.option;
      let textStyle: any = styles.optionText;

          if (answered) {
            if (i === block.correct_index) {
              optionStyle = { ...optionStyle, ...styles.optionCorrect };
              textStyle = { ...textStyle, color: 'white' };
            } else if (i === selected) {
              optionStyle = { ...optionStyle, ...styles.optionWrong };
              textStyle = { ...textStyle, color: 'white' };
            } else {
              optionStyle = { ...optionStyle, opacity: 0.5 };
            }
          } else if (i === selected) {
            optionStyle = { ...optionStyle, ...styles.optionSelected };
          }

          return (
            <TouchableOpacity
              key={i}
              style={optionStyle}
              onPress={() => handleSelect(i)}
              disabled={answered}
              activeOpacity={0.8}
            >
              <Text style={textStyle}>{opt}</Text>
              {answered && i === block.correct_index && <Ionicons name="checkmark-circle" size={18} color="white" />}
              {answered && i === selected && i !== block.correct_index && <Ionicons name="close-circle" size={18} color="white" />}
            </TouchableOpacity>
          );
        })}
      </View>

      {answered && (
        <View style={[styles.feedbackBox, isCorrect ? styles.feedbackCorrect : styles.feedbackIncorrect]}>
          <Ionicons name={isCorrect ? 'checkmark-circle' : 'alert-circle'} size={18} color={isCorrect ? COLORS.success : COLORS.danger} />
          <Text style={[styles.feedbackText, { color: isCorrect ? COLORS.success : COLORS.danger }]}>
            {isCorrect ? block.feedback_correct : block.feedback_incorrect}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Summary Block ──
export function SummaryBlockView({ block }: { block: Extract<LessonBlock, { type: 'summary' }> }) {
  return (
    <View style={[styles.block, styles.summaryBlock]}>
      {block.icon && <Text style={styles.summaryIcon}>{block.icon}</Text>}
      <Text style={styles.summaryTitle}>Key Takeaways</Text>
      {block.points.map((point, i) => (
        <View key={i} style={styles.summaryPoint}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.summaryPointText}>{point}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  // Concept
  conceptHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  conceptIcon: { fontSize: 22 },
  conceptTitle: { fontSize: 18, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  conceptContent: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 22 },
  visualBox: {
    marginTop: 14,
    backgroundColor: COLORS.purpleDeep + '08',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.purpleVibrant + '20',
  },
  visualText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 20 },
  // Example
  exampleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  exampleTitle: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  examplePrompt: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, marginBottom: 10, fontStyle: 'italic' },
  exampleContent: {
    backgroundColor: COLORS.purpleDeep + '08',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.purpleVibrant,
  },
  exampleText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 22 },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 12,
    paddingVertical: 8,
  },
  expandText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant },
  expandBox: {
    marginTop: 8,
    backgroundColor: COLORS.success + '10',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.success + '30',
  },
  expandContent: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary, lineHeight: 20 },
  // Interaction
  interactionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
  interactionQuestion: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, flex: 1, lineHeight: 22 },
  optionsContainer: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  optionSelected: { borderColor: COLORS.purpleVibrant, backgroundColor: COLORS.purpleVibrant + '10' },
  optionCorrect: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  optionWrong: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  optionText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1 },
  feedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
  },
  feedbackCorrect: { backgroundColor: COLORS.success + '12' },
  feedbackIncorrect: { backgroundColor: COLORS.danger + '12' },
  feedbackText: { fontSize: 13, fontFamily: FONTS.medium, flex: 1, lineHeight: 19 },
  // Summary
  summaryBlock: { borderColor: COLORS.success + '30' },
  summaryIcon: { fontSize: 28, textAlign: 'center', marginBottom: 8 },
  summaryTitle: { fontSize: 17, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 14 },
  summaryPoint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  summaryPointText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1, lineHeight: 20 },
});
