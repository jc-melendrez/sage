import React from 'react';
import { Stack } from 'expo-router';

import { RoleGate } from '@/components/RoleGate';

export default function EducatorLayout() {
  return (
    <RoleGate allow="educator">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="index" />
        <Stack.Screen name="lesson-new" />
        <Stack.Screen name="(tabs)/course-detail" />
        <Stack.Screen name="(tabs)/topic-detail" />
        <Stack.Screen name="(tabs)/add-node" />
        {/* Quiz manager lives outside (tabs) so it can be a real modal: React
            Navigation's `presentation: 'modal'` has no effect on a screen nested
            inside a tab navigator. */}
        <Stack.Screen
          name="quiz-manager"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </RoleGate>
  );
}
