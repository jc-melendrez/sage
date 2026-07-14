import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="users" />
      <Stack.Screen name="courses" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="announcements" />
    </Stack>
  );
}
