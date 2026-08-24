import { Stack } from 'expo-router';

export default function EducatorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)/course-detail" />
      <Stack.Screen name="(tabs)/topic-detail" />
      <Stack.Screen name="(tabs)/add-node" />
    </Stack>
  );
}
