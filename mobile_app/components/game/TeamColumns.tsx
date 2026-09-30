import { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput,
  ActivityIndicator, Image,
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
  /** Room-wide fallback only; a team's own maxSize wins when the server sent one. */
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
  /** Host-only "+" beside a team's last slot. */
  canResizeTeam?: boolean;
  onResizeTeam?: (teamId: string) => void;
  resizingTeamId?: string | null;
}

const MIN_NAME = 2;
const MAX_NAME = 20;

/** Mirrors the backend DEFAULT_TEAM_MAX_SIZE, for teams that predate maxSize. */
const DEFAULT_SEATS = 5;
/** Mirrors the backend MAX_TEAM_MAX_SIZE; the "+" disables itself at this. */
const MAX_SEATS = 10;

/**
 * busyTeamId key for the spectator box. Team ids are numeric strings, so a
 * non-numeric key can never collide with a real one. Keep in sync with the
 * screens, which set it when they send teamId: null.
 */
const SPECTATOR_KEY = '__spectator__';

/** Mirrors the backend TEAM_COLORS, used only when a team doc has no color. */
const FALLBACK_TEAM_COLORS = [
  '#22D3EE', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
];

/**
 * Seats a team actually has, clamped to the same range the server enforces.
 *
 * A team with no maxSize of its own is a team that predates per-team seats, and
 * the server resolves that to DEFAULT_TEAM_MAX_SIZE -- not to the room's
 * maxTeamSize. Seeding the UI from the room instead made every legacy team
 * advertise the room cap (20, clamped to 10) while the server would still
 * refuse a 6th member, so the extra slots were tappable failures.
 */
function seatsFor(team: TeamEntry): number {
  const raw = Number(team.maxSize);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SEATS;
  return Math.max(1, Math.min(MAX_SEATS, Math.round(raw)));
}

/**
 * Team boxes for the waiting room.
 *
 * Laid out as a vertical list: Spectators pinned at the top, then one box per
 * team, separated by a "VS" label. Students start in the spectators, so that
 * box is the resting state and the way back out -- tapping a box joins that
 * team, tapping Spectators leaves. Spectating is simply "no teamId" on the
 * server, which is why leaving a team is the same request as joining one.
 *
 * Each box shows a fixed set of slots sized to the team's own seat count, so
 * the host can see at a glance how much room is left and a student can tap an
 * empty slot instead of hunting for a small "Join" control. A full team stays
 * visible but inert: the student is expected to move to another box, not to be
 * stuck.
 */
export default function TeamColumns({
  teams, players, myId, myTeamId, maxTeamSize, locked, canRename, busyTeamId,
  onJoin, onRename, canAddTeam = false, onAddTeam, addingTeam = false,
  canResizeTeam = false, onResizeTeam, resizingTeamId = null,
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

  const showAddTeam = canAddTeam && !locked && !!onAddTeam;

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

  return (
    <>
      <View style={styles.stack}>
        {/* ── spectators: pinned at the top, this is where students start ── */}
        <TouchableOpacity
          onPress={() => canTapSpectators && onJoin(null)}
          activeOpacity={0.8}
          disabled={!canTapSpectators}
          accessibilityLabel="Spectators"
          style={[
            styles.box,
            styles.spectator,
            isSpectating && styles.spectatorActive,
            locked && styles.boxMuted,
          ]}
        >
          <View style={[styles.header, styles.spectatorHeader]}>
            <View style={[styles.colorBar, { backgroundColor: COLORS.textMuted }]} />
            <View style={styles.titleRow}>
              <Ionicons name="eye-outline" size={14} color={COLORS.textSecondary} />
              <Text style={[styles.name, { color: COLORS.textSecondary }]} numberOfLines={1}>
                Spectators
              </Text>
            </View>
            <View style={styles.countRow}>
              <Text style={[styles.count, { color: COLORS.textMuted }]}>
                {spectators.length}
              </Text>
              {isSpectating && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
            </View>
          </View>

          <View style={styles.body}>
            {spectators.length === 0 ? (
              <Text style={[styles.emptyText, { color: COLORS.textMuted }]}>
                {isSpectating ? 'You are here' : 'Nobody here'}
              </Text>
            ) : (
              spectators.map(member => renderMember(member, COLORS.textSecondary))
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

        {/* ── one box per team, with a VS label between neighbours ── */}
        {teams.map((team, teamIndex) => {
          const key = String(team.id);
          const members = membersByTeam.get(key) ?? [];
          const isMyTeam = sameTeamId(team.id, myTeamId);
          const seats = seatsFor(team);
          const full = members.length >= seats;
          // A full team is dimmed but still rendered: the student needs to see it
          // to know to move somewhere else rather than concluding they are stuck.
          const canTap = !locked && !full && !isMyTeam && busyTeamId === null;
          // Never fewer slots than players, or a member could sit outside the
          // box entirely and read as missing.
          const slots = Math.max(members.length, seats);
          // Rooms created before teams carried a color still have to render:
          // every use below concatenates an alpha suffix, so a missing color
          // would put "undefined3A" into a style and silently drop the box.
          const accent = team.color || FALLBACK_TEAM_COLORS[teamIndex % FALLBACK_TEAM_COLORS.length];
          const label = team.name || `Team ${key}`;
          const atMaxSeats = seats >= MAX_SEATS;
          const canGrow = canResizeTeam && !locked && !atMaxSeats && !!onResizeTeam;

          return (
            <View key={key} style={styles.teamGroup}>
              {teamIndex > 0 && (
                <View style={styles.vsRow}>
                  <View style={styles.vsLine} />
                  <Text style={styles.vsText}>VS</Text>
                  <View style={styles.vsLine} />
                </View>
              )}

              <TouchableOpacity
                onPress={() => canTap && onJoin(key)}
                activeOpacity={0.8}
                disabled={!canTap}
                accessibilityLabel={label}
                style={[
                  styles.box,
                  { borderColor: isMyTeam ? accent : accent + '3A' },
                  isMyTeam && { backgroundColor: accent + '1A' },
                  (locked || (full && !isMyTeam)) && styles.boxMuted,
                ]}
              >
                {/* ── header: name, count, rename ── */}
                <View style={[styles.header, { backgroundColor: accent + '26' }]}>
                  <View style={[styles.colorBar, { backgroundColor: accent }]} />
                  <View style={styles.titleRow}>
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
                        <Ionicons name="pencil" size={12} color={accent} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.countRow}>
                    <Text style={[styles.count, { color: accent }]}>
                      {members.length}/{seats}
                    </Text>
                    {isMyTeam && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
                    {full && !isMyTeam && (
                      <Text style={[styles.fullTag, { color: accent }]}>FULL</Text>
                    )}
                  </View>
                </View>

                {/* ── one row per seat ── */}
                <View style={styles.body}>
                  {Array.from({ length: slots }).map((_, i) => {
                    const member = members[i];
                    if (member) return renderMember(member, accent);

                    const lastSlot = i === slots - 1;
                    // The "+" only ever appears beside the final slot, so the
                    // control to grow a team is attached to the thing it grows.
                    return (
                      <View key={`slot-${i}`} style={styles.slotRow}>
                        <TouchableOpacity
                          onPress={() => canTap && onJoin(key)}
                          activeOpacity={0.7}
                          disabled={!canTap}
                          style={[
                            styles.slot,
                            canTap && styles.slotJoinable,
                            full && styles.slotFull,
                          ]}
                          accessibilityLabel={`Join ${label}`}
                        >
                          <Text style={styles.slotText}>
                            {full ? 'full' : canTap ? 'Tap to join' : 'empty'}
                          </Text>
                        </TouchableOpacity>
                        {lastSlot && (
                          <TouchableOpacity
                            onPress={() => canGrow && onResizeTeam?.(key)}
                            disabled={!canGrow || resizingTeamId === key}
                            activeOpacity={0.7}
                            hitSlop={6}
                            style={[
                              styles.growBtn,
                              !canGrow && styles.growBtnDisabled,
                            ]}
                            accessibilityLabel={`Add a seat to ${label}`}
                          >
                            {resizingTeamId === key ? (
                              <ActivityIndicator size="small" color={COLORS.textSecondary} />
                            ) : (
                              <Ionicons
                                name="add"
                                size={16}
                                color={canGrow ? accent : COLORS.textMuted}
                              />
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {members.length === 0 && (
                    <Text style={[styles.emptyText, { color: accent + 'AA' }]}>
                      {canTap ? 'Tap a slot to join' : locked ? 'Locked' : 'Tap another team'}
                    </Text>
                  )}
                </View>

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
                      {isMyTeam ? '✓ You are here' : full ? 'Team is full' : locked ? 'Locked' : 'Tap to join'}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>

              {/* ── host adds another team ── */}
              {showAddTeam && teamIndex === teams.length - 1 && (
                <TouchableOpacity
                  onPress={onAddTeam}
                  disabled={addingTeam}
                  activeOpacity={0.7}
                  style={styles.addTeam}
                  accessibilityLabel="Add a team"
                >
                  {addingTeam ? (
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  ) : (
                    <>
                      <Ionicons name="add-circle-outline" size={18} color={COLORS.textSecondary} />
                      <Text style={styles.addLabel}>Add team</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

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
  // Vertical list: spectators on top, then each team box with a VS between.
  stack: { gap: 0 },

  box: {
    borderWidth: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  boxMuted: { opacity: 0.55 },

  teamGroup: { gap: 0 },

  // Spectators are the resting state, not a team, so the box reads as
  // "unassigned" -- dashed, uncoloured, and quieter than the teams below it.
  spectator: { borderStyle: 'dashed', borderColor: 'rgba(148,163,184,0.45)' },
  spectatorActive: { borderColor: COLORS.textSecondary, backgroundColor: 'rgba(148,163,184,0.10)' },
  spectatorHeader: { backgroundColor: 'rgba(148,163,184,0.10)' },

  addTeam: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(148,163,184,0.45)',
    borderRadius: 12,
    backgroundColor: 'rgba(148,163,184,0.06)',
  },
  addLabel: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.textSecondary },

  vsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  vsLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' },
  vsText: {
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 2,
    color: COLORS.textMuted,
  },

  header: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  colorBar: { height: 3, borderRadius: 2, marginBottom: 8, marginHorizontal: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.2 },
  pencil: { padding: 3 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  count: { fontSize: 11, fontFamily: FONTS.bold },
  fullTag: { fontSize: 9, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  youPill: {
    backgroundColor: COLORS.success,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  youPillText: { fontSize: 8, fontFamily: FONTS.extraBold, color: '#062A20' },

  body: { paddingHorizontal: 10, paddingVertical: 9, gap: 6 },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  memberYou: { backgroundColor: 'rgba(255,255,255,0.10)' },
  avatar: { width: 20, height: 20, borderRadius: 10 },
  avatarFallback: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 9, fontFamily: FONTS.extraBold },
  memberName: {
    flex: 1, fontSize: 12, fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  emptyText: { fontSize: 11, fontFamily: FONTS.semiBold, textAlign: 'center', paddingVertical: 6 },

  // A slot is one seat. Occupied seats render a member row instead.
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slot: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderStyle: 'dashed',
    borderRadius: 9,
    paddingVertical: 8,
    alignItems: 'center',
  },
  slotJoinable: { borderColor: 'rgba(255,255,255,0.22)' },
  slotFull: { opacity: 0.45 },
  slotText: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textMuted },

  growBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  growBtnDisabled: { opacity: 0.35 },

  footer: {
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
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
