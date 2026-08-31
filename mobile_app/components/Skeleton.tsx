import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { palette } from '@/constants/theme';

/**
 * Lightweight skeleton placeholder with a reanimated shimmer.
 * No new dependencies — reanimated is already installed app-wide.
 */

interface SkeletonBoxProps {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: object;
}

function SkeletonBox({ width, height, borderRadius = 8, style }: SkeletonBoxProps) {
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.box,
        animatedStyle,
        { width: width as any, height, borderRadius },
        style,
      ]}
    />
  );
}

/** Course card skeleton — mirrors components/courses/CourseCard layout */
export function CourseCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={{ flex: 1 }}>
          <SkeletonBox width={'40%'} height={20} borderRadius={10} />
          <SkeletonBox width={'85%'} height={18} borderRadius={9} style={styles.mt12} />
          <SkeletonBox width={'50%'} height={12} borderRadius={6} style={styles.mt8} />
        </View>
        <SkeletonBox width={60} height={60} borderRadius={30} />
      </View>
    </View>
  );
}

/** Quiz card skeleton — mirrors the quiz card layout */
export function QuizCardSkeleton() {
  return (
    <View style={styles.card}>
      <SkeletonBox width={'30%'} height={18} borderRadius={9} />
      <SkeletonBox width={'80%'} height={18} borderRadius={9} style={styles.mt12} />
      <SkeletonBox width={'45%'} height={12} borderRadius={6} style={styles.mt8} />
      <SkeletonBox width={100} height={36} borderRadius={12} style={styles.mt16} />
    </View>
  );
}

/** Group row skeleton — mirrors the inbox row layout */
export function GroupRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBox width={50} height={50} borderRadius={25} />
      <View style={{ flex: 1 }}>
        <SkeletonBox width={'60%'} height={16} borderRadius={8} />
        <SkeletonBox width={'80%'} height={12} borderRadius={6} style={styles.mt8} />
      </View>
    </View>
  );
}

/** List of skeletons for the given tab */
export function TabSkeleton({ tab }: { tab: 'lessons' | 'quizzes' | 'groups' }) {
  const count = 3;
  if (tab === 'groups') {
    return (
      <View style={styles.listWrap}>
        <View style={styles.rowButtons}>
          <SkeletonBox width={'46%'} height={44} borderRadius={14} />
          <SkeletonBox width={'46%'} height={44} borderRadius={14} />
        </View>
        {Array.from({ length: count }).map((_, i) => (
          <GroupRowSkeleton key={i} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.listWrap}>
      {Array.from({ length: count }).map((_, i) =>
        tab === 'lessons' ? (
          <CourseCardSkeleton key={i} />
        ) : (
          <QuizCardSkeleton key={i} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: palette.bgSecondary },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    marginHorizontal: 24,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    marginBottom: 12,
  },
  rowButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  listWrap: { paddingTop: 16 },
  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  mt16: { marginTop: 16 },
});
