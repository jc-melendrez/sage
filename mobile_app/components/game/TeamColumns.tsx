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
  /** null means "go back to the spectators". */
  onJoin: (teamId: string | null) => void;
  onRename: (teamId: string, name: string) => Promise<void>;
  /** Host-only, and only while the room is still waiting. */
  canAddTeam?: boolean;
  onAddTeam?: () => void;
  addingTeam?: boolean;
}

const MIN_NAME = 2;
const MAX_NAME = 20;

/**
 * busyTeamId key for the spectator column. Team ids are numeric strings, so a
 * non-numeric key can never collide with a real one. Keep in sync with the
 * screens, which set it when they send teamId: null.
 */
const SPECTATOR_KEY = '__spectator__';

/** Mirrors the backend TEAM_COLORS, used only when a team doc has no color. */
const FALLBACK_TEAM_COLORS = [
  '#22D3EE', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
];

/**
 * Team columns for the waiting room.
 *
 * The leftmost column is always Spectators. Students land there by default, so
 * it is the resting state rather than an edge case: tapping a team column joins
 * that team, and tapping Spectators goes back. Spectating is simply "no
 * teamId" on the server, which is why leaving a team is the same request as
 * joining one.
 *
 * The whole column is the tap target rather than a small "Join" button, so a
 * student joining on a phone does not have to hit a 60px-wide control.
 */
export default function TeamColumns({
  teams, players, myId, myTeamId, maxTeamSize, locked, canRename, busyTeamId,
  onJoin, onRename, canAddTeam = false, onAddTeam, addingTeam = false,
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

  const spectators = useMemo(
    () => players
      .filter(player => !player.teamId)
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
    [players]
  );

  // Spectators counts as a column, so it has to be included in every layout
  // decision or the row overflows one column earlier than it used to. The host's
  // "add team" control takes width too, which is enough to tip a narrow phone
  // into scrolling, so it counts here even though it holds no players.
  const showAddColumn = canAddTeam && !locked && !!onAddTeam;
  const columnCount = teams.length + 1 + (showAddColumn ? 1 : 0);
  const scroll = columnCount > 2;

  // With many columns they get too narrow to read, so cap how many member chips
  // each one shows and summarise the rest rather than stretching to fit.
  const perColumn = columnCount <= 3 ? 8 : columnCount <= 4 ? 5 : 4;

  const openRename = (team: TeamEntry) => {
    setRenaming(team);
    setDraft(team.name || `Team ${team.id}`);
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

  const renderMember = (member: PlayerEntry, accent: string) => {
    const isMe = myId != null && String(member.id) === String(myId);
    const initial = (member.displayName || '?').charAt(0).toUpperCase();
    return (
      <View key={member.id} style={[styles.member, isMe && styles.memberYou]}>
        {pfpSource(member.avatar) ? (
          <Image source={pfpSource(member.avatar)!} style={styles.avatar} resizeMode="cover" />
        ) : (
          <View style={[styles.avatarFallback, { borderColor: accent + '88' }]}>
            <Text style={[styles.avatarText, { color: accent }]}>{initial}</Text>
          </View>
        )}
        <Text style={styles.memberName} numberOfLines={1}>{member.displayName}</Text>
      </View>
    );
  };

  const isSpectating = myTeamId == null;
  const canTapSpectators = !locked && !isSpectating && busyTeamId === null;
  const shownSpectators = spectators.slice(0, perColumn);
  const spectatorOverflow = spectators.length - shownSpectators.length;

  return (
    <>
      <ScrollView
        horizontal={scroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.row,
          scroll && styles.rowScroll,
        ]}
      >
        {/* ── spectators: always first, this is where students start ── */}
        <TouchableOpacity
          onPress={() => canTapSpectators && onJoin(null)}
          activeOpacity={0.8}
          disabled={!canTapSpectators}
          accessibilityLabel="Spectators"
          style={[
            styles.column,
            !scroll && styles.columnFlex,
            styles.spectator,
            isSpectating && styles.spectatorActive,
            locked && styles.columnMuted,
          ]}
        >
          <View style={[styles.header, styles.spectatorHeader]}>
            <View style={[styles.colorBar, { backgroundColor: COLORS.textMuted }]} />
            <Text style={[styles.name, { color: COLORS.textSecondary }]} numberOfLines={1}>
              Spectators
            </Text>
            <View style={styles.countRow}>
              <Text style={[styles.count, { color: COLORS.textMuted }]}>
                {spectators.length}
              </Text>
              {isSpectating && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
            </View>
          </View>

          <View style={styles.body}>
            {shownSpectators.map(member => renderMember(member, COLORS.textSecondary))}

            {spectatorOverflow > 0 && (
              <View style={styles.overflow}>
                <Text style={styles.overflowText}>+{spectatorOverflow} more</Text>
              </View>
            )}

            {spectators.length === 0 && (
              <View style={styles.emptySlot}>
                <Ionicons name="eye-outline" size={18} color={COLORS.textMuted} />
                <Text style={[styles.emptyText, { color: COLORS.textMuted }]}>
                  {isSpectating ? 'You are here' : 'Nobody here'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            {busyTeamId === SPECTATOR_KEY ? (
              <ActivityIndicator size="small" color={COLORS.textSecondary} />
            ) : (
              <Text style={[styles.footerText, { color: isSpectating ? COLORS.textSecondary : COLORS.textMuted }]} numberOfLines={1}>
                {isSpectating ? '✓ You are here' : 'Tap to leave team'}
              </Text>
            )}
          </View>
        </TouchableOpacity>

        {teams.map((team, teamIndex) => {
          const key = String(team.id);
          const members = membersByTeam.get(key) ?? [];
          const isMyTeam = sameTeamId(team.id, myTeamId);
          const full = members.length >= maxTeamSize;
          const canTap = !locked && !full && !isMyTeam && busyTeamId === null;
          const shown = members.slice(0, perColumn);
          const overflow = members.length - shown.length;
          const slots = Math.max(0, Math.min(maxTeamSize, 4) - members.length);
          // Rooms created before teams carried a color still have to render:
          // every use below concatenates an alpha suffix, so a missing color
          // would put "undefined3A" into a style and silently drop the column.
          const accent = team.color || FALLBACK_TEAM_COLORS[teamIndex % FALLBACK_TEAM_COLORS.length];
          const label = team.name || `Team ${key}`;

          return (
            <TouchableOpacity
              key={key}
              onPress={() => canTap && onJoin(key)}
              activeOpacity={0.8}
              disabled={!canTap}
              accessibilityLabel={label}
              style={[
                styles.column,
                !scroll && styles.columnFlex,
                { borderColor: isMyTeam ? accent : accent + '3A' },
                isMyTeam && { backgroundColor: accent + '1A' },
                (locked || (full && !isMyTeam)) && styles.columnMuted,
              ]}
            >
              {/* ── header: name, count, rename ── */}
              <View style={[styles.header, { backgroundColor: accent + '26' }]}>
                <View style={[styles.colorBar, { backgroundColor: accent }]} />
                <Text style={[styles.name, { color: accent }]} numberOfLines={1}>
                  {label}
                </Text>
                {canRename && !team.nameLocked && !locked && (
                  <TouchableOpacity
                    onPress={() => openRename(team)}
                    hitSlop={10}
                    style={styles.pencil}
                    accessibilityLabel={`Rename ${label}`}
                  >
                    <Ionicons name="pencil" size={11} color={accent} />
                  </TouchableOpacity>
                )}
                <View style={styles.countRow}>
                  <Text style={[styles.count, { color: accent }]}>
                    {members.length}/{maxTeamSize}
                  </Text>
                  {isMyTeam && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
                </View>
              </View>

              {/* ── members ── */}
              <View style={styles.body}>
                {shown.map(member => renderMember(member, accent))}

                {overflow > 0 && (
                  <View style={styles.overflow}>
                    <Text style={styles.overflowText}>+{overflow} more</Text>
                  </View>
                )}

                {members.length === 0 && (
                  <View style={styles.emptySlot}>
                    <Ionicons name="add-circle-outline" size={18} color={accent + '88'} />
                    <Text style={[styles.emptyText, { color: accent + 'AA' }]}>Tap to join</Text>
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
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Text
                    style={[
                      styles.footerText,
                      { color: isMyTeam ? accent : full ? COLORS.textMuted : COLORS.textSecondary },
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

        {/* ── host adds a team while students are still arriving ── */}
        {showAddColumn && (
          <TouchableOpacity
            onPress={onAddTeam}
            disabled={addingTeam}
            activeOpacity={0.7}
            accessibilityLabel="Add a team"
            style={[styles.column, styles.addColumn, !scroll && styles.addColumnFlex]}
          >
            {addingTeam ? (
              <ActivityIndicator size="small" color={COLORS.textSecondary} />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={26} color={COLORS.textSecondary} />
                <Text style={styles.addLabel}>Add team</Text>
              </>
            )}
          </TouchableOpacity>
        )}
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

  // Spectators are the resting state, not a team, so the column reads as
  // "unassigned" -- dashed, uncoloured, and quieter than the teams beside it.
  spectator: { borderStyle: 'dashed', borderColor: 'rgba(148,163,184,0.45)' },
  spectatorActive: { borderColor: COLORS.textSecondary, backgroundColor: 'rgba(148,163,184,0.10)' },
  spectatorHeader: { backgroundColor: 'rgba(148,163,184,0.10)' },

  addColumn: {
    minWidth: 96,
    maxWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderStyle: 'dashed',
    borderColor: 'rgba(148,163,184,0.45)',
    backgroundColor: 'rgba(148,163,184,0.06)',
  },
  addColumnFlex: { minWidth: 0, maxWidth: undefined },
  addLabel: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

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
