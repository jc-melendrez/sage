import { Stack } from 'expo-router';

export default function GameLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="classic" />
      <Stack.Screen name="flashcards" />
      <Stack.Screen name="lobby" />
      <Stack.Screen name="question" />
      <Stack.Screen name="final" />
    </Stack>
  );
}