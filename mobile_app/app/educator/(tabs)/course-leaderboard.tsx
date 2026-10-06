import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { COLORS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { useEducatorBack } from '@/hooks/useEducatorBack';
import CourseLeaderboardView from '@/components/courses/CourseLeaderboard';
import { getCourseLeaderboard, CourseLeaderboard, LeaderboardSort } from '@/services/courseService';

/**
 * The per-class leaderboard, split out of course-detail so it can live behind
 * the course options menu instead of a fourth section tab.
 *
 * Everything below the header is delegated to `CourseLeaderboardView`, which
 * already owns its podium, sort chips, table, and loading/empty/no-data states.
 * This screen exists to fetch the data and hold the sort choice.
 */
export default function CourseLeaderboardScreen() {
  const { courseId, courseName } = useLocalSearchParams<{ courseId: string; courseName: string }>();
  const cid = Number(courseId);

  const [data, setData] = useState<CourseLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<LeaderboardSort>('points');

  // Cold start / deep link: there is no stack entry to go back to, so send
  // the educator to the course they were looking at rather than the dashboard.
  const backToCourse = useEducatorBack({
    pathname: '/educator/(tabs)/course-detail',
    params: { courseId: String(cid), courseName: courseName || '' },
  } as never);

  const load = useCallback(async () => {
    try {
      setData(await getCourseLeaderboard(cid, sort));
    } catch {
      // The component renders its own empty state for a null `data`.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cid, sort]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <KeyboardSafeView style={styles.container}>
      <View style={styles.container}>
        <EducatorHeader
          title={courseName || 'Leaderboard'}
          subtitle="Ranked by course points, completed nodes or streak"
          showBack
          onBack={backToCourse}
        />

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <CourseLeaderboardView data={data} loading={loading} activeSort={sort} onSortChange={setSort} />
        </ScrollView>
      </View>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
});