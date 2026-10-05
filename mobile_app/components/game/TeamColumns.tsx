import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput,
  ActivityIndicator, Image, ScrollView, Animated, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
  /**
   * Whether this viewer may hand a team over to somebody else: the team's
   * current leader, or the room host (whose client passes `canRename`, which is
   * exactly the same authority).
   */
  canTransferLeader?: boolean;
  /** null while idle, otherwise the team being handed over. */
  busyTransferTeamId?: string | null;
  onTransferLeader?: (teamId: string, userId: string) => Promise<void>;
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
 * Darken a team accent until it is legible as TEXT on a white card.
 *
 * The team colors are chosen to be distinguishable from each other, which is
 * the opposite job to being readable: #22D3EE on white is roughly 1.9:1, well
 * under the 4.5:1 that body text needs, so a cyan team name was effectively
 * invisible in the lobby. Only text goes through this -- borders, tints and
 * avatar fills keep the bright accent, because those are not text and
 * darkening them would leave teams looking identical.
 */
function ink(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return COLORS.textPrimary;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;

  // Relative luminance, per WCAG 2.x.
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = () => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  // Scale toward black by a shrinking factor until the ratio clears 4.5. Capped
  // so a near-black accent is not pushed all the way down for nothing.
  for (let i = 0; i < 24 && 1.05 / (luminance() + 0.05) < 4.5; i++) {
    r = Math.round(r * 0.94);
    g = Math.round(g * 0.94);
    b = Math.round(b * 0.94);
  }
  const hexOut = (c: number) => c.toString(16).padStart(2, '0');
  return `#${hexOut(r)}${hexOut(g)}${hexOut(b)}`;
}

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
 * How wide the seat-progress track should read, as a percentage.
 *
 * Floored at a visible sliver once anyone has joined, so a one-player team is
 * not indistinguishable from an empty one, and capped at 100 so a roster that
 * outgrew its seats still fills the track rather than overflowing it.
 */
function seatFillPercent(members: number, seats: number): number {
  if (members <= 0) return 0;
  const pct = Math.round((members / Math.max(1, seats)) * 100);
  return Math.max(8, Math.min(100, pct));
}

/**
 * Articles and prepositions, skipped when picking a team's crest letters.
 *
 * Without this every room's "The Brainy Bunch" team stamps a "T" on its crest,
 * which is both wrong-looking and identical to every other "The ..." team name
 * students actually pick.
 */
const SKIP_INITIALS = new Set(['the', 'of', 'and', 'a', 'an']);

/**
 * The letters stamped on a team's crest.
 *
 * Team names are free text, so an emblem cannot be drawn from one. Two initials
 * from the first two meaningful words keeps "Blue Team" from rendering as the
 * same single "B" as "Brainy Bunch"; a team with no letters at all falls back to
 * the leading digits of its id, which is numeric and therefore never blank.
 */
function teamInitials(name: string, teamId: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter(w => !SKIP_INITIALS.has(w.toLowerCase()));
  const picked = (meaningful.length ? meaningful : words).slice(0, 2);
  if (picked.length === 0) {
    return (teamId || '?').replace(/\D/g, '').slice(0, 2).toUpperCase() || '?';
  }
  return picked.map(w => w[0]).join('').toUpperCase();
}

/**
 * Legible text color to sit ON a filled team accent.
 *
 * This is the mirror of `ink()`: there the accent has to become text on a white
 * card, here it becomes the fill under text. Team colors are picked to be
 * tellable apart from each other, not to carry white ink, so white cannot be
 * assumed -- on the brighter accents a near-black label is the readable one.
 * Whichever wins on contrast is returned, with a floor so it is never a coin
 * flip decided by rounding.
 */
function onAccent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const l = 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / 0.05;
  return onWhite >= onDark ? '#FFFFFF' : '#111827';
}

/**
 * Entrance: one fade-and-rise per team, staggered down the list.
 *
 * Deliberately mount-only (the effect depends on nothing that changes) so
 * joining or leaving a team does not replay the whole cascade -- the boxes that
 * did not change would visibly re-pop for no reason.
 */
function RiseIn({ delay, children }: { delay: number; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: 380,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Press feedback for a whole team box.
 *
 * Its own node rather than a scale on the box itself: the box already runs a
 * stagger animation, and two `Animated.timing`s driving the same value on one
 * view fight each other -- the press would stutter the entrance. Split, each has
 * one owner.
 */
function BoxPress({
  style, onPress, disabled, accessibilityLabel, children,
}: {
  style: any;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const settle = (to: number) => {
    Animated.spring(scale, {
      toValue: to, speed: 45, bounciness: 3, useNativeDriver: true,
    }).start();
  };
  return (
    <Animated.View
      // Press handlers on the outer view so the border and the shadow scale with
      // the content; the TouchableOpacity inside carries the card surface.
      onStartShouldSetResponder={() => !disabled}
      onResponderGrant={() => settle(0.975)}
      onResponderRelease={() => settle(1)}
      onResponderTerminate={() => settle(1)}
      style={[style, { transform: [{ scale }] }]}
    >
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={styles.boxPressInner}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * The seat bar, animated to its new width.
 *
 * Set straight to the first value instead of tweening in from zero, so a box
 * rendered mid-settle does not appear to fill up on its own.
 */
function SeatFill({ percent, color }: { percent: number; color: string }) {
  const w = useRef(new Animated.Value(percent)).current;
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      w.setValue(percent);
      return;
    }
    const anim = Animated.timing(w, {
      toValue: percent,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      // Width is not a native-driver property.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [percent, w]);
  return (
    <Animated.View
      style={[
        styles.progressFill,
        { backgroundColor: color },
        { width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
      ]}
    />
  );
}

/** How many faces the header stack shows before folding into a "+N". */
const STACK_MAX = 4;

/**
 * Overlapping faces in the header, as a quick read on who is on the team before
 * anyone starts reading names. The seat list below stays the interactive one --
 * it carries the ready state, the leader star and the tap-to-promote target,
 * none of which survive a horizontal strip.
 */
function AvatarStack({ members, accent }: { members: PlayerEntry[]; accent: string }) {
  if (members.length === 0) return null;
  const shown = members.slice(0, STACK_MAX);
  const overflow = members.length - shown.length;
  return (
    <View style={styles.avatarStack}>
      {shown.map((m, i) => {
        const initial = (m.displayName || '?').charAt(0).toUpperCase();
        return (
          <View
            key={m.id}
            style={[
              styles.stackAvatar,
              { marginLeft: i === 0 ? 0 : -9 },
              // Later faces sit on top, so the row reads left-to-right as the
              // order the members are already listed in underneath.
              { zIndex: STACK_MAX - i },
            ]}
          >
            {pfpSource(m.avatar) ? (
              <Image source={pfpSource(m.avatar)!} style={styles.stackAvatarImg} resizeMode="cover" />
            ) : (
              <View style={[styles.stackAvatarFallback, { borderColor: accent + '88' }]}>
                <Text style={[styles.stackAvatarText, { color: ink(accent) }]}>{initial}</Text>
              </View>
            )}
          </View>
        );
      })}
      {overflow > 0 && (
        <View style={[styles.stackAvatar, styles.stackOverflow, { marginLeft: -9, zIndex: 0 }]}>
          <Text style={styles.stackOverflowText}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Gentle breathing on your own CTA while you have not joined yet.
 *
 * Scoped to the viewer's own box: a loop on every team would run one animation
 * per box forever for a hint only the local player acts on.
 */
function ReadyPulse({ active, children }: { active: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, v]);
  return (
    <Animated.View
      // `width: '100%'` has to be restated on the wrapper: the footer centres its
      // children, so without it this view would shrink to its content and the
      // `width: '100%'` CTA inside it would have nothing to measure against.
      style={[
        styles.ctaPulse,
        {
          // 0.82 -> 1.0: enough to notice, not enough to look like a flicker.
          opacity: Animated.add(Animated.multiply(v, 0.18), 0.82),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
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
  canTransferLeader = false, busyTransferTeamId = null, onTransferLeader,
}: Props) {
  const [renaming, setRenaming] = useState<TeamEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // The server owns who leads, but a team document that predates `leaderId`
  // still reads as led by its first member -- matching the backend fallback so
  // the badge never points at somebody the API would refuse.
  const leaderOf = (team: TeamEntry): string | null => {
    const stored = team.leaderId != null ? String(team.leaderId) : null;
    if (stored && team.memberIds.some(id => String(id) === stored)) return stored;
    return team.memberIds.length ? String(team.memberIds[0]) : null;
  };
  const isLeader = (team: TeamEntry, member: PlayerEntry) =>
    String(leaderOf(team)) === String(member.id);

  const transferLeader = async (team: TeamEntry, member: PlayerEntry) => {
    if (!onTransferLeader) return;
    await onTransferLeader(String(team.id), String(member.id));
  };

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

  const renderMember = (
    member: PlayerEntry,
    accent: string,
    leader: boolean,
    onPress?: (member: PlayerEntry) => void,
  ) => {
    const isMe = myId != null && String(member.id) === String(myId);
    const initial = (member.displayName || '?').charAt(0).toUpperCase();
    const label = member.displayName || 'Player';
    return (
      <TouchableOpacity
        key={member.id}
        onPress={onPress ? () => onPress(member) : undefined}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={onPress ? `Make ${label} the team leader` : label}
        style={[styles.member, isMe && styles.memberYou]}
      >
        {pfpSource(member.avatar) ? (
          <Image source={pfpSource(member.avatar)!} style={styles.avatar} resizeMode="cover" />
        ) : (
          <View style={[styles.avatarFallback, { borderColor: accent + '88' }]}>
            <Text style={[styles.avatarText, { color: ink(accent) }]}>{initial}</Text>
          </View>
        )}
        <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
        {/* A filled star, not the TV crown: the leader is whoever holds the
            team together (renames it, locks in its answer), which is a badge of
            responsibility rather than the "host of the show" the crown read as. */}
        {leader && (
          <View style={[styles.leaderBadge, { backgroundColor: accent + '26' }]}>
            <Ionicons name="star" size={11} color={ink(accent)} />
          </View>
        )}
      </TouchableOpacity>
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
          const accentInk = ink(accent);
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

              <RiseIn delay={teamIndex * 70}>
                <BoxPress
                  style={[
                    styles.boxOuter,
                    { borderColor: isMyTeam || isHighlighted ? accent : accent + '3A' },
                    (isMyTeam || isHighlighted) && styles.boxClaimed,
                    (locked || (full && !isMyTeam)) && styles.boxMuted,
                    // The card surface itself stays pure white; only the shadow
                    // reads the team colour, so claiming a box never tints it.
                    isMyTeam && { shadowColor: accent, elevation: 6 },
                  ]}
                  onPress={() => canTap && onJoin(key)}
                  disabled={!canTap}
                  accessibilityLabel={label}
                >
                {/* ── header: crest, name, seat progress, rename ── */}
                <View style={[styles.accentEdge, { backgroundColor: accent }]} />
                <View style={styles.header}>
                  <View style={styles.titleRow}>
                    {/* Gradient shield rather than a flat bordered square: the
                        crest is the first thing anyone reads on the card, and a
                        solid fill in the team colour makes the teams scannable at
                        a glance without tinting the card itself. */}
                    <LinearGradient
                      colors={[accent, accent + 'CC']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.crest}
                    >
                      <Text style={[styles.crestText, { color: onAccent(accent) }]}>
                        {teamInitials(label, key)}
                      </Text>
                    </LinearGradient>
                    <Text style={[styles.name, { color: accentInk }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <AvatarStack members={members} accent={accent} />
                    {canRename && !team.nameLocked && !locked && (
                      <TouchableOpacity
                        onPress={() => openRename(team)}
                        hitSlop={10}
                        style={styles.pencil}
                        accessibilityLabel={`Rename ${label}`}
                      >
                        <Ionicons name="pencil" size={12} color={accentInk} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Seat progress. The header used to carry a bare "3/5" and the
                      slots below repeated it visually; a filled track makes "how
                      much room is left" readable at a glance, which is the one
                      thing the host is scanning this card for. */}
                  <View style={styles.progressRow}>
                    <View style={styles.progressTrack}>
                      <SeatFill
                        percent={seatFillPercent(members.length, seats)}
                        color={accent}
                      />
                    </View>
                    <Text style={[styles.count, { color: accentInk }]}>
                      {members.length}/{seats}
                    </Text>
                    {isMyTeam && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
                    {full && !isMyTeam && (
                      <Text style={styles.fullTag}>FULL</Text>
                    )}
                  </View>
                </View>

                {/* ── one row per seat ── */}
                <View style={styles.body}>
                  {Array.from({ length: slots }).map((_, i) => {
                    const member = members[i];
                    if (member) {
                      // Only the leader and the host can hand the seat on, and
                      // only while the room is still waiting -- the same window
                      // the rename pencil uses, because the server refuses both
                      // once the game starts.
                      const canPromote = canTransferLeader && !locked
                        && busyTransferTeamId === null
                        && !isLeader(team, member)
                        && leaderOf(team) != null;
                      return renderMember(
                        member,
                        accent,
                        isLeader(team, member),
                        canPromote ? (m: PlayerEntry) => transferLeader(team, m) : undefined,
                      );
                    }

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
                          {full ? 'full' : 'empty'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {members.length === 0 && (
                    <Text style={[styles.emptyText, { color: accentInk + 'CC' }]}>
                      {locked ? 'Locked' : 'No players yet'}
                    </Text>
                  )}
                </View>

                <View style={styles.footer}>
                  {busyTeamId === key ? (
                    <ActivityIndicator size="small" color={accent} />
                  ) : (
                    <ReadyPulse active={isMyTeam && !locked}>
                      <TouchableOpacity
                        onPress={() => canTap && onJoin(key)}
                        disabled={!canTap}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isMyTeam ? `You are on ${label}`
                            : full ? `${label} is full`
                            : `Join ${label}`
                        }
                        accessibilityState={{ disabled: !canTap }}
                        style={[
                          styles.ctaBtn,
                          // Three states, chosen once so the button and its label
                          // cannot disagree: mine (accent outline, always
                          // tappable so a member can leave), disabled (full or
                          // locked), and join (accent fill).
                          isMyTeam && { borderColor: accent },
                          !isMyTeam && (full || locked) && styles.ctaBtnDisabled,
                          !isMyTeam && !full && !locked && { backgroundColor: accent, borderColor: accent },
                        ]}
                      >
                        <Text
                          style={[
                            styles.ctaText,
                            isMyTeam && { color: accentInk },
                            !isMyTeam && (full || locked) && { color: COLORS.textMuted },
                            !isMyTeam && !full && !locked && { color: onAccent(accent) },
                          ]}
                          numberOfLines={1}
                        >
                          {isMyTeam ? "You're in" : full ? 'Team full' : locked ? 'Locked' : 'Join team'}
                        </Text>
                      </TouchableOpacity>
                    </ReadyPulse>
                  )}
                </View>
                </BoxPress>
              </RiseIn>
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

  // The press-scale wrapper. Border and shadow live here rather than on `box` so
  // the whole card -- edge included -- scales together under a press; an inner
  // scale would shrink the content and leave the outline standing still.
  boxOuter: {
    borderWidth: 1.5,
    borderRadius: 16,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  // `overflow: hidden` clips the top accent bar to the rounded corners, so the
  // two together give a card that reads as one solid object rather than a stripe
  // laid over a rectangle.
  boxPressInner: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  // A full-opacity border, not a tint: every card surface stays pure white, so
  // claiming a card has to read through its edge rather than its fill. Border
  // width is safe to change here because the border sits outside the padding --
  // the old note about a "fixed-size grid cell" predates the vertical layout.
  boxClaimed: { borderWidth: 2.5 },
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
  // Opaque, not a tint. Both hosts of this bar paint a violet gradient behind it
  // (lobby.tsx, game/index.tsx), so an alpha fill let the violet straight through
  // and the bar read as violet *only while you were spectating* -- the active
  // style was the difference between "white when you leave it" and "violet when
  // you are in it". A solid border plus the YOU pill carry that state instead.
  spectatorBarActive: {
    borderColor: COLORS.textSecondary,
    borderStyle: 'solid',
    backgroundColor: COLORS.surface,
  },
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
  // Team-coloured hairline along the top inner edge. `boxPressInner` clips it to
  // the card's rounded corners, and because it is a child rather than a border it
  // cannot change the card's measured width the way a thicker border would.
  accentEdge: { height: 4, width: '100%' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
/** The team's emblem: a gradient shield in the team colour. The face is filled
    rather than white-outlined so the card is identifiable by shape and hue at a
    glance down a list of four, and `onAccent` picks the legible ink for whatever
    fill a room's saved colour happens to be. */
  crest: {
    width: 34, height: 34, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  crestText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  name: { flexShrink: 1, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.2 },
  pencil: { padding: 3 },

  /** Overlapping faces, right-aligned between the team name and the pencil. */
  avatarStack: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', paddingLeft: 6 },
  stackAvatar: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: COLORS.surface,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  stackAvatarImg: { width: '100%', height: '100%' },
  stackAvatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stackAvatarText: { fontSize: 9, fontFamily: FONTS.extraBold },
  stackOverflow: { backgroundColor: COLORS.surfaceLight },
  stackOverflowText: { fontSize: 8, fontFamily: FONTS.extraBold, color: COLORS.textSecondary },
  ctaPulse: { width: '100%' },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  progressTrack: {
    flex: 1, height: 5, borderRadius: 3,
    backgroundColor: COLORS.surfaceLight,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  count: { fontSize: 11, fontFamily: FONTS.bold },
  fullTag: { fontSize: 9, fontFamily: FONTS.extraBold, letterSpacing: 0.6, color: COLORS.textMuted },
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
    gap: 8,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  memberYou: { backgroundColor: 'rgba(124,58,237,0.10)', borderColor: 'rgba(124,58,237,0.22)' },
  // 24 rather than 20: at 20 the initials render at 9pt and the face is too small
  // to recognise, which is the whole reason the row shows a picture.
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  avatarText: { fontSize: 10, fontFamily: FONTS.extraBold },
  memberName: {
    flex: 1, fontSize: 12, fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  /** Filled star on a tinted chip, so it reads as a badge not a letter. */
  leaderBadge: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
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
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  /** A real control, not a sentence. The footer used to read "Tap to join",
      which is indistinguishable from the caption above it and gives a screen
      reader nothing to activate. */
  ctaBtn: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnDisabled: { backgroundColor: COLORS.surfaceLight, borderColor: COLORS.border },
  ctaText: { fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },

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
