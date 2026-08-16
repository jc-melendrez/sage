import { Stack } from 'expo-router';

export default function SuperAdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="admins" />
      <Stack.Screen name="config" />
      <Stack.Screen name="database" />
      <Stack.Screen name="system" />
    </Stack>
  );
}
