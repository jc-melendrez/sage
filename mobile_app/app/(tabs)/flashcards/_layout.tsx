import { Stack } from 'expo-router';

export default function FlashcardsTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="study" />
      <Stack.Screen name="edit" />
      <Stack.Screen name="add" />
    </Stack>
  );
}