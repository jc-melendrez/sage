import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import LevelNode from './LevelNode';
import ProgressRing from './ProgressRing';
import { palette as COLORS, fontFamily as FONTS } from '@/constants/theme';

interface Level {
  level_id: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  content: string;
  quiz: any[];
  passing_score: number;
}

interface Course {
  course_title: string;
  subject: string;
  levels: Level[];
}

interface CourseDetailModalProps {
  course: Course;
  levelProgress: Record<string, number>;
  onTakeQuiz: (level: Level) => void;
  onClose: () => void;
}

function getLevelProgressKey(courseTitle: string, levelId: number): string {
  return `${courseTitle}::${levelId}`;
}

function getLevelStatus(
  course: Level[],
  index: number,
  levelProgress: Record<string, number>,
  courseTitle: string,
): 'locked' | 'current' | 'completed' {
  const level = course[index];
  const score = levelProgress[getLevelProgressKey(courseTitle, level.level_id)] ?? 0;

  if (score >= level.passing_score) return 'completed';

  if (index === 0) return 'current';

  const prevLevel = course[index - 1];
  const prevScore = levelProgress[getLevelProgressKey(courseTitle, prevLevel.level_id)] ?? 0;
  if (prevScore >= prevLevel.passing_score) return 'current';

  return 'locked';
}

export default function CourseDetailModal({
  course,
  levelProgress,
  onTakeQuiz,
  onClose,
}: CourseDetailModalProps) {
  const insets = useSafeAreaInsets();
  const totalLevels = course.levels.length;
  const [readingLevel, setReadingLevel] = React.useState<Level | null>(null);
  const completedCount = course.levels.filter(
    (l, i) => getLevelStatus(course.levels, i, levelProgress, course.course_title) === 'completed',
  ).length;
  const overallProgress = totalLevels > 0 ? Math.round((completedCount / totalLevels) * 100) : 0;

  const handleViewContent = (level: Level) => {
    setReadingLevel(level);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 24 }]}
      >
        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.subjectBadge}>
            <Ionicons name="school" size={10} color="white" />
            <Text style={styles.subjectLabel}>{course.subject}</Text>
          </View>
          <Text style={styles.courseTitle}>{course.course_title}</Text>
          <Text style={styles.progressLabel}>
            {completedCount} of {totalLevels} levels completed
          </Text>
        </View>

        {/* Progress ring centered */}
        <View style={styles.ringContainer}>
          <ProgressRing
            size={80}
            progress={overallProgress}
            strokeWidth={7}
            fillColor="#A78BFA"
            trackColor="rgba(255,255,255,0.15)"
          >
            <Text style={styles.ringText}>{overallProgress}%</Text>
          </ProgressRing>
        </View>
      </LinearGradient>

      {/* Level path */}
      <ScrollView
        style={styles.pathScroll}
        contentContainerStyle={styles.pathContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pathContainer}>
          {course.levels.map((level, index) => {
            const status = getLevelStatus(course.levels, index, levelProgress, course.course_title);
            const score = levelProgress[getLevelProgressKey(course.course_title, level.level_id)];
            const isLast = index === course.levels.length - 1;

            return (
              <View key={level.level_id} style={styles.nodeWrapper}>
                <LevelNode
                  level={level}
                  index={index}
                  status={status}
                  score={score}
                  isLast={isLast}
                  onPress={() => {
                    if (status === 'locked') {
                      Alert.alert('Locked', `Complete the previous level to unlock ${level.difficulty}.`);
                    } else if (status === 'current') {
                      onTakeQuiz(level);
                    } else {
                      handleViewContent(level);
                    }
                  }}
                />

                {/* Action buttons below each node */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.contentBtn]}
                    onPress={() => handleViewContent(level)}
                  >
                    <Ionicons name="book-outline" size={14} color={COLORS.purplePrimary} />
                    <Text style={styles.contentBtnText}>Read</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      styles.quizBtn,
                      status === 'locked' && styles.actionBtnDisabled,
                    ]}
                    disabled={status === 'locked'}
                    onPress={() => onTakeQuiz(level)}
                  >
                    <Ionicons name="help-circle-outline" size={14} color="white" />
                    <Text style={styles.quizBtnText}>Quiz</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {/* Trophy at end */}
          <View style={styles.trophyContainer}>
            <LinearGradient
              colors={['#F59E0B', '#D97706']}
              style={styles.trophyCircle}
            >
              <Ionicons name="trophy" size={28} color="white" />
            </LinearGradient>
            <Text style={styles.trophyText}>Course Mastered!</Text>
          </View>
        </View>
      </ScrollView>

      {/* Lesson Reader Modal */}
      <Modal visible={readingLevel !== null} animationType="slide" onRequestClose={() => setReadingLevel(null)}>
        {readingLevel && (
          <View style={styles.readerContainer}>
            <LinearGradient
              colors={[COLORS.purpleDeep, COLORS.purpleDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.readerHeader, { paddingTop: insets.top + 16 }]}
            >
              <TouchableOpacity onPress={() => setReadingLevel(null)} style={styles.backBtn} accessibilityLabel="Close lesson">
                <Ionicons name="close" size={24} color="white" />
              </TouchableOpacity>
              <View style={styles.readerHeaderTextBox}>
                <Text style={styles.readerLevelLabel}>{readingLevel.difficulty} Level</Text>
                <Text style={styles.readerTitle} numberOfLines={2}>{course.course_title}</Text>
              </View>
            </LinearGradient>

            <ScrollView
              style={styles.readerScroll}
              contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 120 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.readerBody}>{readingLevel.content}</Text>
            </ScrollView>

            <View style={[styles.readerFooter, { paddingBottom: Math.max(16, insets.bottom) }]}>
              <TouchableOpacity
                style={styles.readerQuizBtn}
                onPress={() => {
                  const level = readingLevel;
                  setReadingLevel(null);
                  onTakeQuiz(level);
                }}
              >
                <Ionicons name="help-circle-outline" size={18} color="white" />
                <Text style={styles.readerQuizBtnText}>Take the Quiz</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerContent: {
    marginBottom: 8,
  },
  subjectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  subjectLabel: {
    color: 'white',
    fontSize: 10,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
  },
  courseTitle: {
    color: 'white',
    fontSize: 24,
    fontFamily: FONTS.black,
    marginBottom: 6,
  },
  progressLabel: {
    color: '#C4B5FD',
    fontSize: 13,
    fontFamily: FONTS.medium,
  },
  ringContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  ringText: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    color: 'white',
  },
  pathScroll: {
    flex: 1,
  },
  pathContent: {
    paddingVertical: 32,
    paddingBottom: 60,
  },
  pathContainer: {
    alignItems: 'center',
    gap: 0,
  },
  nodeWrapper: {
    alignItems: 'center',
    marginBottom: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    marginBottom: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  contentBtn: {
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  contentBtnText: {
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    color: '#7C3AED',
  },
  quizBtn: {
    backgroundColor: '#7C3AED',
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  quizBtnText: {
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    color: 'white',
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  trophyContainer: {
    alignItems: 'center',
    marginTop: 20,
    gap: 10,
  },
  trophyCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  trophyText: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: '#F59E0B',
  },

  // Lesson Reader styles
  readerContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  readerHeader: {
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  readerHeaderTextBox: {
    flex: 1,
  },
  readerLevelLabel: {
    color: COLORS.purplePale,
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  readerTitle: {
    color: 'white',
    fontSize: 18,
    fontFamily: FONTS.bold,
    lineHeight: 24,
  },
  readerScroll: {
    flex: 1,
  },
  readerBody: {
    fontSize: 16,
    lineHeight: 28,
    color: COLORS.textDark,
    fontFamily: FONTS.regular,
  },
  readerFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: 'rgba(244, 242, 250, 0.94)',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  readerQuizBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 16,
    borderRadius: 16,
  },
  readerQuizBtnText: {
    color: 'white',
    fontFamily: FONTS.bold,
    fontSize: 15,
  },
});
