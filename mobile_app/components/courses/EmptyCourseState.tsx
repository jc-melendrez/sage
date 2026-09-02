import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette as COLORS, fontFamily as FONTS } from '@/constants/theme';

interface EmptyCourseStateProps {
  title?: string;
  subtitle?: string;
  onJoinClass?: () => void;
}

export default function EmptyCourseState({
  title = 'No self-study courses yet',
  subtitle = 'Generate a personalized AI course with the + button, or join your educator\u2019s class.',
  onJoinClass,
}: EmptyCourseStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="book-outline" size={40} color={COLORS.purpleVibrant} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {onJoinClass && (
        <TouchableOpacity style={styles.joinBtn} onPress={onJoinClass} accessibilityLabel="Join a class with a code">
          <Ionicons name="school-outline" size={16} color="white" />
          <Text style={styles.joinBtnText}>Join a Class</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 24,
    marginTop: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    borderStyle: 'dashed',
    paddingVertical: 40,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.purplePrimary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 18,
  },
  joinBtnText: {
    color: 'white',
    fontFamily: FONTS.bold,
    fontSize: 13,
  },
});
