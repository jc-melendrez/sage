import { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput,
  ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { pfpSource } from '@/constants/pfps';
import {
  sameTeamId, type PlayerEntry, type TeamEntry,
} from '@/types/game';

const COLORS = {
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  warning: '#F59E0B',
  success: '#10B981',
};

const FONTS = {
  bold: 'Montserrat-Bold',
  extraBold: 'Montserrat-ExtraBold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Props {
  teams: TeamEntry[];
  players: PlayerEntry[];
  myId: string | null;
  myTeamId: string | null;
  maxTeamSize: number;
  locked: boolean;
  /** The host (or any member) may name a team once; after that it is locked. */
  canRename: boolean;
  busyTeamId: string | null;
  onJoin: (teamId: string) => void;
  onRename: (teamId: string, name: string) => Promise<void>;
}

const MIN_NAME = 2;
const MAX_NAME = 20;

/**
 * Team columns for the waiting room.
 *
 * Tapping a column joins that team. The whole column is the tap target rather
 * than a small "Join" button, so a student joining on a phone does not have to
 * hit a 60px-wide control — with four or five teams side by side that is the
 * difference between picking a team and giving up and standing around.
 */
export default function TeamColumns({
  teams, players, myId, myTeamId, maxTeamSize, locked, canRename, busyTeamId, onJoin, onRename,
}: Props) {
  const [renaming, setRenaming] = useState<TeamEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const membersByTeam = useMemo(() => {
    const map = new Map<string, PlayerEntry[]>();
    for (const team of teams) map.set(String(team.id), []);
    for (const player of players) {
      if (!player.teamId) continue;
      const key = String(player.teamId);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(player);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    }
    return map;
  }, [teams, players]);

  // With many teams the columns get too narrow to read, so cap how many member
  // chips each one shows and summarise the rest rather than letting the
  // columns stretch to fit the whole class.
  const perColumn = teams.length <= 3 ? 8 : teams.length <= 4 ? 5 : 4;

  const openRename = (team: TeamEntry) => {
    setRenaming(team);
    setDraft(team.name);
  };

  const submitRename = async () => {
    if (!renaming) return;
    const name = draft.trim();
    if (name.length < MIN_NAME || name.length > MAX_NAME) return;
    setSaving(true);
    try {
      await onRename(String(renaming.id), name);
      setRenaming(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScrollView
        horizontal={teams.length > 3}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.row,
          teams.length > 3 && styles.rowScroll,
        ]}
      >
        {teams.map(team => {
          const key = String(team.id);
          const members = membersByTeam.get(key) ?? [];
          const isMyTeam = sameTeamId(team.id, myTeamId);
          const full = members.length >= maxTeamSize;
          const canTap = !locked && !full && !isMyTeam && busyTeamId === null;
          const shown = members.slice(0, perColumn);
          const overflow = members.length - shown.length;
          const slots = Math.max(0, Math.min(maxTeamSize, 4) - members.length);

          return (
            <TouchableOpacity
              key={key}
              onPress={() => canTap && onJoin(key)}
              activeOpacity={0.8}
              disabled={!canTap}
              style={[
                styles.column,
                teams.length <= 3 && styles.columnFlex,
                { borderColor: isMyTeam ? team.color : team.color + '3A' },
                isMyTeam && { backgroundColor: team.color + '1A' },
                (locked || (full && !isMyTeam)) && styles.columnMuted,
              ]}
            >
              {/* ── header: name, count, rename ── */}
              <View style={[styles.header, { backgroundColor: team.color + '26' }]}>
                <View style={[styles.colorBar, { backgroundColor: team.color }]} />
                <Text style={[styles.name, { color: team.color }]} numberOfLines={1}>
                  {team.name}
                </Text>
                {canRename && !team.nameLocked && !locked && (
                  <TouchableOpacity
                    onPress={() => openRename(team)}
                    hitSlop={10}
                    style={styles.pencil}
                    accessibilityLabel={`Rename ${team.name}`}
                  >
                    <Ionicons name="pencil" size={11} color={team.color} />
                  </TouchableOpacity>
                )}
                <View style={styles.countRow}>
                  <Text style={[styles.count, { color: team.color }]}>
                    {members.length}/{maxTeamSize}
                  </Text>
                  {isMyTeam && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
                </View>
              </View>

              {/* ── members ── */}
              <View style={styles.body}>
                {shown.map(member => {
                  const isMe = myId != null && String(member.id) === String(myId);
                  const initial = (member.displayName || '?').charAt(0).toUpperCase();
                  return (
                    <View key={member.id} style={[styles.member, isMe && styles.memberYou]}>
                      {pfpSource(member.avatar) ? (
                        <Image source={pfpSource(member.avatar)!} style={styles.avatar} resizeMode="cover" />
                      ) : (
                        <View style={[styles.avatarFallback, { borderColor: team.color + '88' }]}>
                          <Text style={[styles.avatarText, { color: team.color }]}>{initial}</Text>
                        </View>
                      )}
                      <Text style={styles.memberName} numberOfLines={1}>{member.displayName}</Text>
                    </View>
                  );
                })}

                {overflow > 0 && (
                  <View style={styles.overflow}>
                    <Text style={styles.overflowText}>+{overflow} more</Text>
                  </View>
                )}

                {members.length === 0 && (
                  <View style={styles.emptySlot}>
                    <Ionicons name="add-circle-outline" size={18} color={team.color + '88'} />
                    <Text style={[styles.emptyText, { color: team.color + 'AA' }]}>Tap to join</Text>
                  </View>
                )}

                {members.length > 0 && slots > 0 && Array.from({ length: slots }).map((_, i) => (
                  <View key={`slot-${i}`} style={styles.slot}>
                    <Text style={styles.slotText}>empty</Text>
                  </View>
                ))}
              </View>

              {/* ── footer: join state ── */}
              <View style={styles.footer}>
                {busyTeamId === key ? (
                  <ActivityIndicator size="small" color={team.color} />
                ) : (
                  <Text
                    style={[
                      styles.footerText,
                      { color: isMyTeam ? team.color : full ? COLORS.textMuted : COLORS.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {isMyTeam ? '✓ You are here' : full ? 'FULL' : locked ? 'Locked' : 'Tap to join'}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── rename modal ── */}
      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name your team</Text>
            <Text style={styles.modalSub} numberOfLines={1}>
              {renaming?.name} · {MIN_NAME}-{MAX_NAME} characters
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={MAX_NAME}
              placeholder="e.g. The Brainy Bunch"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRenaming(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, draft.trim().length < MIN_NAME && styles.saveBtnDisabled]}
                onPress={submitRename}
                disabled={saving || draft.trim().length < MIN_NAME}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  rowScroll: { paddingRight: 16 },

  column: {
    flex: 1,
    minWidth: 112,
    maxWidth: 220,
    borderWidth: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  columnFlex: { flex: 1, maxWidth: undefined },
  columnMuted: { opacity: 0.55 },

  header: { paddingHorizontal: 10, paddingTop: 9, paddingBottom: 8 },
  colorBar: { height: 3, borderRadius: 2, marginBottom: 7, marginHorizontal: 2 },
  name: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.2 },
  pencil: { position: 'absolute', top: 16, right: 8, padding: 3 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  count: { fontSize: 11, fontFamily: FONTS.bold },
  youPill: {
    backgroundColor: COLORS.success,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  youPillText: { fontSize: 8, fontFamily: FONTS.extraBold, color: '#062A20' },

  body: { paddingHorizontal: 8, paddingVertical: 8, gap: 5, minHeight: 96 },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  memberYou: { backgroundColor: 'rgba(255,255,255,0.10)' },
  avatar: { width: 20, height: 20, borderRadius: 10 },
  avatarFallback: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 9, fontFamily: FONTS.extraBold },
  memberName: {
    flex: 1, fontSize: 11, fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  overflow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 9,
    paddingVertical: 5,
    alignItems: 'center',
  },
  overflowText: { fontSize: 10, fontFamily: FONTS.semiBold, color: COLORS.textMuted },
  emptySlot: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18, gap: 4 },
  emptyText: { fontSize: 10, fontFamily: FONTS.semiBold },
  slot: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderStyle: 'dashed',
    borderRadius: 9,
    paddingVertical: 5,
    alignItems: 'center',
  },
  slotText: { fontSize: 9, fontFamily: FONTS.medium, color: COLORS.textMuted },

  footer: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    minHeight: 34,
  },
  footerText: { fontSize: 11, fontFamily: FONTS.bold },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  modalCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: 18, padding: 20, gap: 8,
  },
  modalTitle: { fontSize: 18, fontFamily: FONTS.extraBold, color: COLORS.textPrimary },
  modalSub: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: COLORS.textPrimary, fontSize: 15, fontFamily: FONTS.semiBold,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)',
  },
  cancelText: { color: COLORS.textSecondary, fontFamily: FONTS.bold, fontSize: 14 },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#7C3AED' },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 14 },
});
