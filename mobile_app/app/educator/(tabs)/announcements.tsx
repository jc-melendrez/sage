import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';

const RECIPIENT_OPTIONS = ['Entire Class', 'Selected Classes', 'Study Groups'];

const HISTORY = [
  { id: 'h1', title: 'Quiz on Fractions moved to Friday', recipients: 'Entire Class', time: '2h ago', scheduled: false },
  { id: 'h2', title: 'Reminder: Study Group meets after school', recipients: 'Algebra Basics group', time: '1d ago', scheduled: false },
  { id: 'h3', title: 'Progress reports go out next Monday', recipients: 'Entire Class', time: 'Scheduled for Jul 18', scheduled: true },
];

export default function AnnouncementsScreen() {
  const [recipient, setRecipient] = useState('Entire Class');
  const [message, setMessage] = useState('');

  return (
    <View style={styles.container}>
      <EducatorHeader title="Announcements" subtitle="Keep your class in the loop" showBack />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <SectionHeader title="New Announcement" />
          <View style={styles.composeCard}>
            <TextInput
              style={styles.textArea}
              placeholder="Write your announcement..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              value={message}
              onChangeText={setMessage}
            />

            <Text style={styles.fieldLabel}>Recipients</Text>
            <View style={styles.chipRow}>
              {RECIPIENT_OPTIONS.map((r) => (
                <FilterChip key={r} label={r} active={recipient === r} onPress={() => setRecipient(r)} />
              ))}
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.scheduleBtn} activeOpacity={0.85}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.purplePrimary} />
                <Text style={styles.scheduleText}>Schedule</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.broadcastBtn} activeOpacity={0.85}>
                <Ionicons name="megaphone" size={16} color="white" />
                <Text style={styles.broadcastText}>Broadcast Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Previous Announcements" />
          {HISTORY.length > 0 ? (
            <View style={styles.listCard}>
              {HISTORY.map((h, idx) => (
                <View key={h.id} style={[styles.historyItem, idx > 0 && styles.borderTop]}>
                  <View style={[styles.historyIconBg, { backgroundColor: tint(h.scheduled ? COLORS.warning : COLORS.purpleVibrant) }]}>
                    <Ionicons name={h.scheduled ? 'time' : 'megaphone'} size={16} color={h.scheduled ? COLORS.warning : COLORS.purpleVibrant} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyTitle} numberOfLines={2}>{h.title}</Text>
                    <Text style={styles.historyMeta}>{h.recipients} · {h.time}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="megaphone-outline" title="No announcements yet" text="Your posted updates will show up here." />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },

  composeCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  textArea: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  fieldLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  scheduleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, borderWidth: 2, borderColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 12 },
  scheduleText: { color: COLORS.purplePrimary, fontSize: 13.5, fontFamily: FONTS.bold, fontWeight: '700' },
  broadcastBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1.3, backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 12 },
  broadcastText: { color: 'white', fontSize: 13.5, fontFamily: FONTS.bold, fontWeight: '700' },

  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  historyIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  historyTitle: { fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  historyMeta: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
