import { Stack } from 'expo-router';

export default function CourseLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[courseId]" />
      <Stack.Screen name="topic/[topicId]" />
      <Stack.Screen name="node/[nodeId]" />
    </Stack>
  );
}
