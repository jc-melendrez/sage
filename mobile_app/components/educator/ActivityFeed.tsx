import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { SectionHeader } from './EducatorPrimitives';

interface ActivityItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  time: string;
  color: string;
}

interface ActivityFeedProps {
  items: ActivityItem[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Recent Activity" />
      <View style={styles.card}>
        {items.map((item, idx) => (
          <View key={item.id} style={[styles.item, idx > 0 && styles.borderTop]}>
            <View style={[styles.iconBox, { backgroundColor: tint(item.color) }]}>
              <Ionicons name={item.icon} size={18} color={item.color} />
            </View>
            <View style={styles.body}>
              <Text style={styles.text}>{item.text}</Text>
              <Text style={styles.time}>{item.time}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 28 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  iconBox: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1 },
  text: { fontSize: 13.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary, marginBottom: 2 },
  time: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
