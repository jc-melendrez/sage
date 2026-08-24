import { Stack } from 'expo-router';

export default function FlashcardsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="study" />
      <Stack.Screen name="edit" />
    </Stack>
  );
}
