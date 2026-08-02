import { Stack } from 'expo-router';

export default function EducatorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="student-progress" />
      <Stack.Screen name="study-groups" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="ai-insights" />
      <Stack.Screen name="announcements" />
      <Stack.Screen name="leaderboard" />
    </Stack>
  );
}
