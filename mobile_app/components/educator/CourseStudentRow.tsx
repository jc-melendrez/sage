import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, STATUS, tint, SPACE, TYPE } from '@/constants/educatorTheme';
import { Avatar, ProgressBar } from './EducatorPrimitives';
import {
  CourseStudentRow as Row,
  StudentHealth,
  formatLastActive,
  initialsOf,
} from '@/services/courseRoster';

/**
 * `neverStarted` gets the neutral text color rather than a new entry in
 * `educatorTheme.STATUS`: it isn't a risk state, it's an absence of one, and
 * rendering it in the danger hue would flag every student who joined late in
 * the week as a problem.
 */
const HEALTH_COLOR: Record<StudentHealth, string> = {
  onTrack: STATUS.onTrack,
  atRisk: STATUS.atRisk,
  needsAttention: STATUS.needsAttention,
  neverStarted: COLORS.textMuted,
};

const HEALTH_LABEL: Record<StudentHealth, string> = {
  onTrack: 'On track',
  atRisk: 'At risk',
  needsAttention: 'Watch',
  neverStarted: 'Not started',
};

export interface StudentAnchor {
  x: number;
  y: number;
}

/* ---------- Row ---------- */

interface CourseStudentRowProps {
  student: Row;
  /** Open the options menu anchored to this row's trigger. */
  onMenu?: (student: Row, anchor: StudentAnchor) => void;
}

export function CourseStudentRow({ student, onMenu }: CourseStudentRowProps) {
  const triggerRef = useRef<View>(null);
  const healthColor = HEALTH_COLOR[student.health];

  /**
   * Positions with `measureInWindow`, not `e.nativeEvent.layout` — RN does not
   * populate `layout` on press events, so reading it there throws.
   */
  const openMenu = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      const node = triggerRef.current;
      if (!onMenu || !node?.measureInWindow) return;
      node.measureInWindow((x, y, width, height) => {
        if (!width && !height) return;
        onMenu(student, { x: x + width, y: y + height });
      });
    },
    [student, onMenu],
  );

  const initials = initialsOf(student.name);

  return (
    // A plain View, not a TouchableOpacity: the only control on this row is the
    // options trigger, and a row that advertises itself as a button but does
    // nothing when tapped is a lie to both TalkBack and anyone else.
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${student.name}, ${HEALTH_LABEL[student.health]}, ${student.completionPct}% complete`}
    >
      <Avatar initials={initials} size={44} />

      <View style={styles.middle}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{student.name}</Text>
          <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
        </View>

        <View style={styles.progressRow}>
          <ProgressBar percent={student.completionPct} height={5} />
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {/* totalNodes === 0 is a real state (a course with no content yet),
              so the denominator is omitted rather than shown as "0/0". */}
          {student.totalNodes > 0 ? `${student.completionPct}% · ${student.nodesCompleted}/${student.totalNodes} nodes` : 'No content yet'}
          {' · '}
          {student.quizzesCompleted} quiz{student.quizzesCompleted === 1 ? '' : 'es'}
        </Text>
      </View>

      <View style={styles.right}>
        <View style={[styles.streakBadge, { backgroundColor: tint(COLORS.warning) }]}>
          <Ionicons name="flame" size={12} color={COLORS.warning} />
          <Text style={styles.streakText}>{student.streak}</Text>
        </View>
        <Text style={[styles.healthLabel, { color: healthColor }]}>{HEALTH_LABEL[student.health]}</Text>
        <Text style={styles.lastActive}>{formatLastActive(student.lastActivity)}</Text>

        {onMenu && (
          <TouchableOpacity
            ref={triggerRef as never}
            style={styles.trigger}
            hitSlop={8}
            activeOpacity={0.6}
            onPress={openMenu}
            accessibilityRole="button"
            accessibilityLabel={`Options for ${student.name}`}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/* ---------- Anchored options menu ---------- */

const MENU_WIDTH = 200;
const MENU_ITEM_HEIGHT = 44;
const MENU_PADDING = 8;
const MENU_ROWS = 2;
const MENU_ESTIMATED_HEIGHT = MENU_ROWS * MENU_ITEM_HEIGHT + MENU_PADDING * 2;
const EDGE = 8;

/**
 * Single anchored dropdown for the roster.
 *
 * Render this ONCE, outside the screen's ScrollView. Two reasons, both of
 * which have bitten this codebase before:
 *
 *   - RN `zIndex` cannot lift a nested child above a later sibling of its
 *     ancestor, so a menu rendered per-row inside the list is painted
 *     underneath the rows below it. See the long note at
 *     components/ai/AIAssistantScreen.tsx:885-900, where a per-row Delete
 *     silently stopped working.
 *   - The trigger anchors come from `measureInWindow`, i.e. window
 *     coordinates. Inside scroll content those numbers resolve against the
 *     content rather than the window and the dropdown lands in the wrong spot.
 *
 * It is an in-tree absolute overlay rather than a <Modal> because Android
 * silently drops a Modal stacked on another.
 */
export function StudentRosterMenu({
  student,
  anchor,
  onClose,
  onCopyEmail,
  onRemove,
}: {
  student: Row | null;
  anchor: StudentAnchor | null;
  onClose: () => void;
  onCopyEmail: (student: Row) => void;
  onRemove: (student: Row) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  if (!student || !anchor) return null;

  const fitsBelow = anchor.y + 6 + MENU_ESTIMATED_HEIGHT <= windowHeight - EDGE;
  const top = fitsBelow
    ? anchor.y + 6
    : Math.max(EDGE, Math.min(anchor.y - MENU_ESTIMATED_HEIGHT - 6, windowHeight - MENU_ESTIMATED_HEIGHT - EDGE));
  const left = Math.max(EDGE, Math.min(anchor.x - MENU_WIDTH, windowWidth - MENU_WIDTH - EDGE));

  return (
    <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1} accessibilityLabel="Close menu">
      <View style={[styles.dropdown, { left, top }]}>
        <TouchableOpacity
          style={styles.menuItem}
          activeOpacity={0.7}
          onPress={() => {
            onClose();
            onCopyEmail(student);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${student.name}'s email`}
        >
          <Ionicons name="mail-outline" size={18} color={COLORS.textPrimary} style={styles.menuIcon} />
          <Text style={styles.menuItemText}>Copy email</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, styles.menuItemDanger]}
          activeOpacity={0.7}
          onPress={() => {
            onClose();
            onRemove(student);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${student.name} from this class`}
        >
          <Ionicons name="person-remove-outline" size={18} color={COLORS.danger} style={styles.menuIcon} />
          <Text style={[styles.menuItemText, { color: COLORS.danger }]}>Remove student</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  middle: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  name: { fontSize: TYPE.body, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, flexShrink: 1 },
  healthDot: { width: 7, height: 7, borderRadius: 3.5 },
  progressRow: { marginBottom: 5 },
  meta: { fontSize: TYPE.meta, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  right: { alignItems: 'flex-end', gap: 4 },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  streakText: { fontSize: TYPE.meta - 1, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.warning },
  healthLabel: { fontSize: TYPE.meta - 2, fontFamily: FONTS.semiBold, fontWeight: '600' },
  lastActive: { fontSize: TYPE.meta - 2, fontFamily: FONTS.regular, color: COLORS.textMuted },
  // padding 10 so a 22px icon still clears a 42px target (WCAG 2.5.8).
  trigger: { padding: 10, marginTop: 2 },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  dropdown: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: MENU_PADDING,
    width: MENU_WIDTH,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: MENU_ITEM_HEIGHT, paddingHorizontal: 14 },
  menuIcon: { width: 24 },
  menuItemText: { fontSize: TYPE.body, fontFamily: FONTS.medium, fontWeight: '600', color: COLORS.textPrimary },
  menuItemDanger: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACE.xs },
});