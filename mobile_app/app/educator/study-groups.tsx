import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, Pill, Avatar, EmptyState } from '@/components/educator/EducatorPrimitives';

const GROUPS = [
  {
    id: 'g1',
    name: 'Algebra Basics',
    members: ['Amara Chen', 'Sofia Reyes', 'Owen Blake'],
    activity: 'Active now',
    lastMessage: { author: 'Sofia Reyes', text: "Can someone explain question 4?", time: '5m ago' },
  },
  {
    id: 'g2',
    name: 'Fractions Support Circle',
    members: ['Diego Ramos', 'Priya Nair'],
    activity: '3h ago',
    lastMessage: { author: 'Priya Nair', text: 'I posted my notes in the shared doc', time: '3h ago' },
  },
];

export default function StudyGroupsScreen() {
  const [expanded, setExpanded] = useState<string | null>('g1');

  return (
    <View style={styles.container}>
      <EducatorHeader title="Study Groups" subtitle={`${GROUPS.length} active groups`} showBack rightIcon="add" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <SectionHeader title="Groups" actionLabel="Create Group" onAction={() => {}} />

          {GROUPS.length > 0 ? (
            <View style={{ gap: 14 }}>
              {GROUPS.map((g) => {
                const isOpen = expanded === g.id;
                return (
                  <View key={g.id} style={styles.groupCard}>
                    <TouchableOpacity style={styles.groupHeader} onPress={() => setExpanded(isOpen ? null : g.id)} activeOpacity={0.8}>
                      <View style={[styles.groupIconBg]}>
                        <Ionicons name="people" size={20} color={COLORS.purpleVibrant} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupName}>{g.name}</Text>
                        <Text style={styles.groupMeta}>{g.members.length} members · {g.activity}</Text>
                      </View>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.groupBody}>
                        {/* Members */}
                        <Text style={styles.subLabel}>Members</Text>
                        <View style={styles.membersRow}>
                          {g.members.map((m) => (
                            <View key={m} style={styles.memberChip}>
                              <Avatar initials={m.split(' ').map((n) => n[0]).join('')} size={28} />
                              <Text style={styles.memberName} numberOfLines={1}>{m}</Text>
                            </View>
                          ))}
                        </View>

                        {/* Recent message */}
                        <Text style={styles.subLabel}>Recent Message</Text>
                        <View style={styles.messagePreview}>
                          <Text style={styles.messageAuthor}>{g.lastMessage.author}</Text>
                          <Text style={styles.messageText} numberOfLines={2}>{g.lastMessage.text}</Text>
                          <Text style={styles.messageTime}>{g.lastMessage.time}</Text>
                        </View>

                        {/* Teacher actions */}
                        <View style={styles.actionsRow}>
                          <TouchableOpacity style={styles.actionBtn}>
                            <Ionicons name="create-outline" size={15} color={COLORS.purplePrimary} />
                            <Text style={styles.actionText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.actionBtn}>
                            <Ionicons name="shield-checkmark-outline" size={15} color={COLORS.purplePrimary} />
                            <Text style={styles.actionText}>Moderate</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.actionBtn}>
                            <Ionicons name="archive-outline" size={15} color={COLORS.danger} />
                            <Text style={[styles.actionText, { color: COLORS.danger }]}>Archive</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <EmptyState icon="people-outline" title="No study groups yet" text="Create a group to help students collaborate." />
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

  groupCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  groupIconBg: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(139,92,246,0.15)', justifyContent: 'center', alignItems: 'center' },
  groupName: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  groupMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  groupBody: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 },
  subLabel: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  membersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  memberChip: { alignItems: 'center', width: 60 },
  memberName: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },

  messagePreview: { backgroundColor: COLORS.bgSecondary, borderRadius: RADIUS.sm, padding: 12, marginBottom: 16 },
  messageAuthor: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleDark, marginBottom: 3 },
  messageText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textPrimary, marginBottom: 4 },
  messageTime: { fontSize: 10.5, fontFamily: FONTS.regular, color: COLORS.textMuted },

  actionsRow: { flexDirection: 'row', gap: 18 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { fontSize: 12.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
});
