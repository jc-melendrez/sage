import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { CreateQuickActions } from '@/components/educator/CreateQuickActions';

export default function CreateScreen() {
  return (
    <View style={styles.container}>
      <EducatorHeader title="Create" subtitle="Build something for your class" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <CreateQuickActions />
        </View>

        <View style={styles.noteCard}>
          <View style={styles.noteIconBg}>
            <Ionicons name="sparkles" size={20} color={COLORS.purpleVibrant} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.noteTitle}>AI can help you start</Text>
            <Text style={styles.noteText}>
              Upload a study file and SAGE generates a full lesson or quiz you can polish and assign.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  scrollContent: { paddingBottom: 44 },
  section: { marginBottom: 26 },

  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    padding: 16,
  },
  noteIconBg: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(139,92,246,0.15)', justifyContent: 'center', alignItems: 'center' },
  noteTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  noteText: { fontSize: 12.5, fontFamily: FONTS.regular, color: COLORS.textSecondary, lineHeight: 18 },
});