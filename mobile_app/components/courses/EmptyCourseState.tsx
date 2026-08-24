import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bgSecondary: '#dad6e7',
  surface: '#cdc2dd',
  border: 'rgba(44, 29, 0, 0.15)',
  purpleVibrant: '#8B5CF6',
  textPrimary: '#3a107a',
  textMuted: '#94A3B8',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  medium: 'Montserrat-Medium',
};

interface EmptyCourseStateProps {
  title?: string;
  subtitle?: string;
}

export default function EmptyCourseState({
  title = 'No courses yet',
  subtitle = 'Tap + to generate a personalized course.',
}: EmptyCourseStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="book-outline" size={40} color={COLORS.purpleVibrant} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 24,
    marginTop: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
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
});
