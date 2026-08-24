import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ProgressRing from './ProgressRing';

const COLORS = {
  surface: '#cdc2dd',
  border: 'rgba(44, 29, 0, 0.15)',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Course {
  course_title: string;
  subject: string;
  levels: any[];
}

interface CourseCardProps {
  course: Course;
  completedLevels: number;
  onPress: () => void;
}

const SUBJECT_COLORS: Record<string, string> = {
  math: '#7C3AED',
  science: '#10B981',
  english: '#F59E0B',
  history: '#EF4444',
  default: '#7C3AED',
};

function getSubjectColor(subject: string): string {
  const key = subject?.toLowerCase() || '';
  return SUBJECT_COLORS[key] || SUBJECT_COLORS.default;
}

export default function CourseCard({ course, completedLevels, onPress }: CourseCardProps) {
  const totalLevels = course.levels?.length || 0;
  const progress = totalLevels > 0 ? Math.round((completedLevels / totalLevels) * 100) : 0;
  const subjectColor = getSubjectColor(course.subject);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardBody}>
        <View style={styles.leftSection}>
          <View style={[styles.subjectBadge, { backgroundColor: subjectColor + '1F' }]}>
            <View style={[styles.subjectDot, { backgroundColor: subjectColor }]} />
            <Text style={[styles.subjectText, { color: subjectColor }]}>{course.subject}</Text>
          </View>
          <Text style={styles.courseTitle} numberOfLines={2}>{course.course_title}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="layers-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.metaText}>{totalLevels} levels</Text>
            {completedLevels > 0 && (
              <>
                <View style={styles.metaDot} />
                <Text style={[styles.metaText, { color: subjectColor }]}>{completedLevels} done</Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.rightSection}>
          <ProgressRing
            size={60}
            progress={progress}
            strokeWidth={5}
            fillColor={subjectColor}
          >
            <Text style={styles.ringPercent}>{progress}%</Text>
          </ProgressRing>
          <LinearGradient
            colors={[subjectColor, subjectColor + 'CC']}
            style={styles.chevronBtn}
          >
            <Ionicons name="chevron-forward" size={16} color="white" />
          </LinearGradient>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginHorizontal: 24,
    marginBottom: 14,
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  cardBody: {
    flexDirection: 'row',
    padding: 18,
    alignItems: 'center',
  },
  leftSection: {
    flex: 1,
  },
  subjectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
    gap: 5,
  },
  subjectDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  subjectText: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  courseTitle: {
    fontSize: 17,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 8,
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.textMuted,
    marginHorizontal: 2,
  },
  rightSection: {
    alignItems: 'center',
    marginLeft: 14,
    gap: 8,
  },
  ringPercent: {
    fontSize: 13,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
  },
  chevronBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
