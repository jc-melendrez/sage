import React from 'react';
import { Stack } from 'expo-router';

import { RoleGate } from '@/components/RoleGate';

export default function SuperAdminLayout() {
  return (
    <RoleGate allow="superadmin">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="create" />
        <Stack.Screen name="config" />
        <Stack.Screen name="database" />
        <Stack.Screen name="system" />
      </Stack>
    </RoleGate>
  );
}
