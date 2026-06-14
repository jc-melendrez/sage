import { Stack } from 'expo-router';

export default function GameLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="lobby" />
      <Stack.Screen name="question" />
      <Stack.Screen name="leaderboard" />
      <Stack.Screen name="final" />
    </Stack>
  );
}