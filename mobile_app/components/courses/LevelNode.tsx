import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = {
  success: '#10B981',
  warning: '#F59E0B',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
  surface: '#cdc2dd',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Level {
  level_id: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  passing_score: number;
}

interface LevelNodeProps {
  level: Level;
  index: number;
  status: 'locked' | 'current' | 'completed';
  score?: number;
  isLast: boolean;
  onPress: () => void;
}

const STATUS_CONFIG = {
  completed: {
    gradient: [COLORS.success, '#059669'] as [string, string],
    icon: 'checkmark' as const,
    glowColor: COLORS.success,
  },
  current: {
    gradient: [COLORS.purplePrimary, COLORS.purpleVibrant] as [string, string],
    icon: 'play' as const,
    glowColor: COLORS.purpleVibrant,
  },
  locked: {
    gradient: ['#CBD5E1', '#94A3B8'] as [string, string],
    icon: 'lock-closed' as const,
    glowColor: 'transparent',
  },
};

const DIFFICULTY_ICONS: Record<string, string> = {
  Beginner: 'leaf',
  Intermediate: 'flame',
  Advanced: 'rocket',
};

export default function LevelNode({
  level,
  index,
  status,
  score,
  isLast,
  onPress,
}: LevelNodeProps) {
  const config = STATUS_CONFIG[status];
  const isLocked = status === 'locked';
  const nodeSize = 68;
  const passed = score !== undefined && score >= level.passing_score;

  return (
    <View style={styles.container}>
      <View style={styles.nodeRow}>
        {/* Connector line (before node, except first) */}
        {index > 0 && <View style={styles.connectorTop} />}

        {/* Node circle */}
        <TouchableOpacity
          style={[styles.nodeTouchable, isLocked && { opacity: 0.5 }]}
          disabled={isLocked}
          onPress={onPress}
          activeOpacity={0.8}
        >
          {/* Glow effect for current node */}
          {status === 'current' && <View style={[styles.glow, { backgroundColor: config.glowColor }]} />}

          <LinearGradient
            colors={config.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.nodeCircle, { width: nodeSize, height: nodeSize, borderRadius: nodeSize / 2 }]}
          >
            <Ionicons
              name={status === 'current' ? (DIFFICULTY_ICONS[level.difficulty] as any) : config.icon}
              size={status === 'current' ? 26 : 22}
              color="white"
            />
          </LinearGradient>

          {/* Completion badge */}
          {status === 'completed' && (
            <View style={styles.checkBadge}>
              <Ionicons name="checkmark" size={10} color="white" />
            </View>
          )}
        </TouchableOpacity>

        {/* Connector line (after node, except last) */}
        {!isLast && <View style={styles.connectorBottom} />}
      </View>

      {/* Labels */}
      <View style={styles.labelsContainer}>
        <Text style={[
          styles.difficultyLabel,
          isLocked && { color: COLORS.textMuted },
        ]}>
          {level.difficulty}
        </Text>

        {/* Score pill */}
        {score !== undefined && score > 0 && (
          <View style={[
            styles.scorePill,
            passed ? styles.scorePillPassed : styles.scorePillAttempted,
          ]}>
            <Text style={[
              styles.scoreText,
              passed ? styles.scoreTextPassed : styles.scoreTextAttempted,
            ]}>
              {score}%
            </Text>
          </View>
        )}

        {/* Pass requirement */}
        {status === 'locked' && (
          <Text style={styles.passRequired}>
            Pass {level.passing_score}% to unlock
          </Text>
        )}
        {status === 'current' && (
          <Text style={styles.passRequired}>
            Pass {level.passing_score}% to continue
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    position: 'relative',
  },
  nodeRow: {
    alignItems: 'center',
  },
  nodeTouchable: {
    zIndex: 2,
  },
  nodeCircle: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  glow: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    opacity: 0.2,
    top: -8,
    left: -8,
    zIndex: -1,
  },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  connectorTop: {
    position: 'absolute',
    top: -44,
    width: 3,
    height: 44,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderRadius: 1.5,
    zIndex: 0,
  },
  connectorBottom: {
    position: 'absolute',
    bottom: -44,
    width: 3,
    height: 44,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderRadius: 1.5,
    zIndex: 0,
  },
  labelsContainer: {
    alignItems: 'center',
    marginTop: 14,
    gap: 4,
  },
  difficultyLabel: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
  },
  scorePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  scorePillPassed: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  scorePillAttempted: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  scoreText: {
    fontSize: 12,
    fontFamily: FONTS.bold,
  },
  scoreTextPassed: {
    color: COLORS.success,
  },
  scoreTextAttempted: {
    color: COLORS.warning,
  },
  passRequired: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
});
