import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { SectionHeader, EmptyState } from './EducatorPrimitives';

interface Announcement {
  id: string;
  title: string;
  time: string;
}

interface AnnouncementsSectionProps {
  items: Announcement[];
}

export function AnnouncementsSection({ items }: AnnouncementsSectionProps) {
  const router = useRouter();

  return (
    <View style={styles.section}>
      <SectionHeader title="Recent Announcements" actionLabel="New" onAction={() => router.push('/educator/announcements' as any)} />
      {items.length > 0 ? (
        <View style={styles.card}>
          {items.map((a, idx) => (
            <View key={a.id} style={[styles.item, idx > 0 && styles.borderTop]}>
              <Ionicons name="megaphone" size={16} color={COLORS.purpleVibrant} />
              <Text style={styles.text} numberOfLines={1}>{a.title}</Text>
              <Text style={styles.time}>{a.time}</Text>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState icon="megaphone-outline" title="No announcements yet" text="Post an update to keep your class in the loop." />
      )}
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
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  text: { flex: 1, fontSize: 13.5, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.textPrimary },
  time: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
