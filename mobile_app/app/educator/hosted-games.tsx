import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { CourseGamesSection } from '@/components/educator/CourseGamesSection';

/**
 * Every game this educator hosted, class or no class.
 *
 * The per-class Games tab (course-detail) only answers for rooms archived
 * with a course, so a game run from the dashboard's FAB — which archives
 * with course=None — is invisible there. This screen reads
 * GET /users/games/mine/ instead, and labels each row with its class (or
 * NO CLASS) so both kinds of game live in one list.
 */
export default function HostedGamesScreen() {
  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Hosted games"
        subtitle="Every game you've run, with full results"
        showBack
      />
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <CourseGamesSection title="All games" showCourse />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 },
});
