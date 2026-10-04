import { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput,
  ActivityIndicator, Image, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { pfpSource } from '@/constants/pfps';
import {
  sameTeamId, joinedAtMillis, type PlayerEntry, type TeamEntry,
} from '@/types/game';

/**
 * Matches the lobby's light theme: white surfaces with dark ink. The team cards
 * sit on the lobby's white card background, so a dark palette here would put
 * dark panels inside a light screen.
 */
const COLORS = {
  surface: '#FFFFFF',
  surfaceLight: '#F3F4F6',
  textPrimary: '#1F2937',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  warning: '#F59E0B',
  success: '#10B981',
  border: 'rgba(76, 29, 149, 0.12)',
  /** Placeholder/seat fills, light enough to read as empty on white. */
  hairline: 'rgba(76, 29, 149, 0.08)',
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
  /**
   * Id of a team to pulse. The caller sets it right after `teams/add/` returns,
   * because a fresh column lands off screen in the horizontal strip and the
   * only other cue (nothing) is indistinguishable from the tap never landing.
   */
  highlightTeamId?: string | null;
}

const MIN_NAME = 2;
const MAX_NAME = 20;

/**
 * Every team shows at least this many boxes. Mirrors the backend's
 * DEFAULT_TEAM_MAX_SIZE, which is also what it falls back to for a team that
 * predates maxSize.
 */
const DEFAULT_SEATS = 5;
/**
 * Ceiling for a team that auto-assign grew. Only auto-assign can raise a team
 * now -- there is no "+" -- so this is reached only when a room has more
 * players than the teams can hold, and it mirrors the backend's
 * MAX_TEAM_MAX_SIZE.
 */
const MAX_SEATS = 10;

/**
 * busyTeamId key for the spectator bar. Team ids are numeric strings, so a
 * non-numeric key can never collide with a real one. Keep in sync with the
 * screens, which set it when they send teamId: null.
 */
const SPECTATOR_KEY = '__spectator__';

/** Mirrors the backend TEAM_COLORS, used only when a team doc has no color. */
const FALLBACK_TEAM_COLORS = [
  '#22D3EE', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
];

/**
 * Boxes to draw for one team, clamped to the range the server enforces.
 *
 * The floor is DEFAULT_SEATS, not 1, so a team always looks like a five-box
 * column. The ceiling and the value itself come from the team's own maxSize,
 * which auto-assign raises when the roster is bigger than the seats allow. That
 * matters for agreement with the server: rendering only max(5, memberCount)
 * would let a grown team report FULL at five members while the backend would
 * still have happily admitted a sixth.
 */
function seatsFor(team: TeamEntry): number {
  const raw = Number(team.maxSize);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SEATS;
  return Math.max(DEFAULT_SEATS, Math.min(MAX_SEATS, Math.round(raw)));
}

/**
 * Team boxes for the waiting room.
 *
 * Laid out as a vertical list: Spectators pinned at the top, then one box per
 * team, separated by a "VS" label. Students start in the spectators, so that
 * bar is the resting state and the way back out -- tapping a box joins that
 * team, tapping the spectators bar leaves. Spectating is simply "no teamId" on
 * the server, which is why leaving a team is the same request as joining one.
 *
 * The spectators bar is deliberately not a box like the teams. It holds the
 * players who have not picked a team yet, newest arrival first, and carries the
 * host's add-team control in its top-right corner -- that corner is the only
 * place a team can be added from, so the control does not compete with the
 * columns for attention mid-list.
 *
 * Each team is a column of boxes sized to its own seat count, so the host can
 * see at a glance how much room is left and a student can tap an empty box
 * instead of hunting for a small "Join" control. A full team stays visible but
 * inert: the student is expected to move to another box, not to be stuck.
 */
export default function TeamColumns({
  teams, players, myId, myTeamId, locked, canRename, busyTeamId,
  onJoin, onRename, canAddTeam = false, onAddTeam, addingTeam = false,
  highlightTeamId = null,
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

  // Newest arrival first, because that is what the strip is for: the host wants
  // to see who just turned up, and a name-sorted list buries them in the middle.
  // Name is the tiebreaker so two players landing in the same millisecond (or
  // both from a room that predates joinedAt) keep a stable order.
  const spectators = useMemo(
    () => players
      .filter(player => !player.teamId)
      .sort((a, b) => (
        joinedAtMillis(b) - joinedAtMillis(a)
        || (a.displayName || '').localeCompare(b.displayName || '')
      )),
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
        {/* ── spectators bar: who is here but has not picked a team yet ──
            Students arrive with no teamId, so this bar is both the resting state
            and the way back out -- tapping it leaves the current team.

            The bar is a plain View holding two sibling TouchableOpacitys (the
            title and the strip) rather than one TouchableOpacity wrapping both.
            That keeps "tap anywhere on the bar to leave" true while leaving the
            host's Add Team button outside every leave target. Nesting it inside
            one would have made a single tap ambiguous, and a host standing on a
            team would end up back in the spectators instead of adding one. */}
        <View
          style={[
            styles.spectatorBar,
            isSpectating && styles.spectatorBarActive,
            locked && styles.boxMuted,
          ]}
        >
          <View style={styles.spectatorBarHead}>
            <TouchableOpacity
              onPress={() => canTapSpectators && onJoin(null)}
              activeOpacity={0.8}
              disabled={!canTapSpectators}
              accessibilityLabel="Spectators"
              style={styles.spectatorBarTitle}
            >
              <Ionicons name="eye-outline" size={14} color={COLORS.textSecondary} />
              <Text style={[styles.spectatorBarName, { color: COLORS.textSecondary }]} numberOfLines={1}>
                Spectators
              </Text>
              <Text style={[styles.spectatorBarCount, { color: COLORS.textMuted }]}>
                {spectators.length}
              </Text>
              {isSpectating && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
            </TouchableOpacity>

            {/* ── the one place a team can be added from ── */}
            {showAddTeam && (
              <TouchableOpacity
                onPress={onAddTeam}
                disabled={addingTeam}
                activeOpacity={0.7}
                hitSlop={8}
                style={[styles.addTeamBtn, addingTeam && styles.addTeamBtnDisabled]}
                accessibilityLabel="Add a team"
              >
                {addingTeam ? (
                  <ActivityIndicator size="small" color={COLORS.textPrimary} />
                ) : (
                  <>
                    <Ionicons name="add" size={15} color={COLORS.textPrimary} />
                    <Text style={styles.addTeamBtnText}>TEAM</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            onPress={() => canTapSpectators && onJoin(null)}
            activeOpacity={0.8}
            disabled={!canTapSpectators}
            accessibilityLabel="Leave your team and spectate"
            style={styles.spectatorBarLeave}
          >
            {/* Every spectator, newest first. Horizontal so the bar keeps a fixed
                height no matter how many people are waiting. */}
            {spectators.length === 0 ? (
              <Text style={[styles.emptyText, { color: COLORS.textMuted }]}>
                {isSpectating ? 'You are here' : 'Nobody here yet'}
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.spectatorStrip}
              >
                {busyTeamId === SPECTATOR_KEY && (
                  <View style={styles.spectatorChip}>
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  </View>
                )}
                {spectators.map(member => {
                  const isMe = myId != null && String(member.id) === String(myId);
                  const initial = (member.displayName || '?').charAt(0).toUpperCase();
                  return (
                    <View key={member.id} style={[styles.spectatorChip, isMe && styles.spectatorChipYou]}>
                      {pfpSource(member.avatar) ? (
                        <Image source={pfpSource(member.avatar)!} style={styles.chipAvatar} resizeMode="cover" />
                      ) : (
                        <View style={styles.chipAvatarFallback}>
                          <Text style={styles.chipAvatarText}>{initial}</Text>
                        </View>
                      )}
                      <Text style={styles.chipName} numberOfLines={1}>{member.displayName}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {!isSpectating && !locked && (
              <Text style={[styles.spectatorBarHint, { color: COLORS.textMuted }]} numberOfLines={1}>
                Tap the bar to leave your team
              </Text>
            )}
          </TouchableOpacity>
        </View>

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
          const isHighlighted = sameTeamId(team.id, highlightTeamId);

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
                  // Full-opacity border + tint instead of a thicker border:
                  // styles.box is a fixed-size grid cell, so changing borderWidth
                  // would nudge the inner content by half a pixel for 2s.
                  isHighlighted && { borderColor: accent, backgroundColor: accent + '24' },
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

                    return (
                      <TouchableOpacity
                        key={`slot-${i}`}
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
            </View>
          );
        })}
      </View>

      {/* ── rename modal ── */}
      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <KeyboardSafeView style={styles.backdrop}>
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
        </KeyboardSafeView>
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

  // Spectators are a slim bar, not a team box: they are "nobody has picked yet"
  // rather than a competing column, and the bar stays one row tall however many
  // people are waiting because the names scroll sideways inside it.
  spectatorBar: {
    borderWidth: 1.5,
    borderRadius: 16,
    borderStyle: 'dashed',
    borderColor: 'rgba(107,114,128,0.35)',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  spectatorBarActive: { borderColor: COLORS.textSecondary, backgroundColor: 'rgba(107,114,128,0.08)' },
  spectatorBarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  spectatorBarTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  spectatorBarLeave: { gap: 6 },
  spectatorBarName: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 1.4 },
  spectatorBarCount: { fontSize: 12, fontFamily: FONTS.extraBold },
  spectatorBarHint: { fontSize: 10, fontFamily: FONTS.medium },

  spectatorStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 4 },
  spectatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(107,114,128,0.28)',
    backgroundColor: COLORS.surfaceLight,
  },
  spectatorChipYou: { borderColor: COLORS.textSecondary, backgroundColor: 'rgba(124,58,237,0.10)' },
  chipAvatar: { width: 24, height: 24, borderRadius: 12 },
  chipAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.22)',
  },
  chipAvatarText: { fontSize: 10, fontFamily: FONTS.extraBold, color: COLORS.textPrimary },
  chipName: { maxWidth: 110, fontSize: 12, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },

  // Host-only. Lives in the spectators bar's top-right corner rather than
  // below the teams, so adding a team does not shift the columns around.
  addTeamBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: COLORS.hairline,
  },
  addTeamBtnDisabled: { opacity: 0.6 },
  addTeamBtnText: { fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 1, color: COLORS.textSecondary },

  vsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  vsLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
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
  memberYou: { backgroundColor: 'rgba(124,58,237,0.10)' },
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
  slot: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: 'center',
  },
  slotJoinable: { borderColor: 'rgba(124,58,237,0.40)' },
  slotFull: { opacity: 0.45 },
  slotText: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textMuted },

  footer: {
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
    alignItems: 'center', backgroundColor: COLORS.surfaceLight,
  },
  cancelText: { color: COLORS.textSecondary, fontFamily: FONTS.bold, fontSize: 14 },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#7C3AED' },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 14 },
});
