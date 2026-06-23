import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Lesson } from '@/types/lesson';
import LessonSection from './LessonSection';
import { colors, spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/config/api';
import { getCurrentUser, getToken } from '@/services/authService';

interface LessonDisplayProps {
  lesson: Lesson;
  onClose: () => void;
}

export default function LessonDisplay({ lesson, onClose }: LessonDisplayProps) {
  const [loading, setLoading] = useState(false);
  const user = getCurrentUser();

  const handleSaveLesson = async () => {
    if (!user) {
      Alert.alert('Error', 'Please log in to save lessons');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/users/${user.id}/lessons/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: lesson.title,
          subject: lesson.subject,
          sections: lesson.sections,
          learning_objectives: lesson.learning_objectives,
          estimated_duration: lesson.estimated_duration,
        }),
      });

      if (response.ok) {
        Alert.alert('Success', 'Lesson saved successfully!');
      } else {
        Alert.alert('Error', 'Failed to save lesson');
      }
    } catch (error) {
      console.error('Error saving lesson:', error);
      Alert.alert('Error', 'Failed to save lesson');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.gradients.primary as any}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
          <View style={styles.lessonInfo}>
            <Text style={styles.lessonTitle}>{lesson.title}</Text>
            <Text style={styles.lessonSubject}>{lesson.subject}</Text>
          </View>
          <TouchableOpacity 
            style={[styles.saveButton, loading && { opacity: 0.5 }]} 
            onPress={handleSaveLesson}
            disabled={loading}
          >
            <Ionicons name="bookmark" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.contentContainer}>
          {/* Learning Objectives */}
          <View style={styles.objectivesSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="flag" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Learning Objectives</Text>
            </View>
            <View style={styles.objectivesList}>
              {lesson.learning_objectives.map((objective, index) => (
                <View key={index} style={styles.objectiveItem}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.secondary} />
                  <Text style={styles.objectiveText}>{objective}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Estimated Duration */}
          <View style={styles.durationSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="time" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Estimated Duration</Text>
            </View>
            <Text style={styles.durationText}>{lesson.estimated_duration}</Text>
          </View>

          {/* Lesson Sections */}
          <View style={styles.sectionsSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="library" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Lesson Content</Text>
            </View>
            {lesson.sections.map((section, index) => (
              <LessonSection key={index} section={section} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerGradient: {
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lessonInfo: {
    flex: 1,
    marginLeft: 20,
  },
  lessonTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  lessonSubject: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
  saveButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  objectivesSection: {
    marginBottom: spacing.xl,
  },
  objectivesList: {
    gap: 12,
  },
  objectiveItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  objectiveText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    flex: 1,
  },
  durationSection: {
    marginBottom: spacing.xl,
  },
  durationText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  sectionsSection: {
    marginBottom: spacing.xl,
  },
});