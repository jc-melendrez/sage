import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import { CoursePathTopic } from '@/types/learning';

const MENU_WIDTH = 168;
const MENU_ITEM_HEIGHT = 44;
const MENU_PADDING = 8;
/** Preview + Edit + the divider above Delete. */
const MENU_ROWS = 3;
const MENU_ESTIMATED_HEIGHT = MENU_ROWS * MENU_ITEM_HEIGHT + MENU_PADDING * 2;
const EDGE = 8;

type Anchor = { x: number; y: number };

/**
 * Three-dot trigger for a topic row.
 *
 * Positions itself with `measureInWindow` rather than reading
 * `e.nativeEvent.layout` from the press event — RN does not populate `layout`
 * on press events, so reading it there throws.
 */
export function TopicOverflowButton({
  topic,
  onOpen,
  style,
}: {
  topic: CoursePathTopic;
  onOpen: (topic: CoursePathTopic, anchor: Anchor) => void;
  style?: object;
}) {
  const ref = useRef<View>(null);

  const openMenu = useCallback(
    (event: { stopPropagation?: () => void }) => {
      // Safe to nest inside a tappable card: never let the parent row open.
      event.stopPropagation?.();
      const node = ref.current;
      if (!node || !node.measureInWindow) return;
      node.measureInWindow((x, y, width, height) => {
        if (!width && !height) return;
        onOpen(topic, { x: x + width, y: y + height });
      });
    },
    [topic, onOpen],
  );

  return (
    <TouchableOpacity
      ref={ref as never}
      style={[styles.trigger, style]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Options for ${topic.title}`}
      onPress={openMenu}
    >
      <Ionicons name="ellipsis-horizontal" size={24} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

type MenuProps = {
  topic: CoursePathTopic | null;
  anchor: Anchor | null;
  onClose: () => void;
  onPreview: (topic: CoursePathTopic) => void;
  onEdit: (topic: CoursePathTopic) => void;
  onDelete: (topic: CoursePathTopic) => void;
};

/**
 * Anchor-positioned topic options menu (preview / edit / delete).
 *
 * Renders as an in-tree overlay, not a <Modal> — Android silently drops a
 * Modal stacked on another, which is what broke the other action menus (see
 * components/NotificationSheet.tsx). Mount this *outside* the screen's
 * ScrollView: the overlay is absolutely positioned, and inside the scroll
 * content those coordinates would resolve against the content rather than
 * the window, breaking the measureInWindow anchors.
 *
 * Every item closes the menu before acting, so the edit flow's <Modal> never
 * stacks on top of a live overlay.
 */
export function TopicOverflowMenu({ topic, anchor, onClose, onPreview, onEdit, onDelete }: MenuProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Keep the dropdown fully on screen: flip above the trigger when there isn't
  // room below, and clamp horizontally for triggers near either edge.
  const menuOpen = !!topic && !!anchor;
  let top = 0;
  let left = 0;
  if (topic && anchor) {
    const fitsBelow = anchor.y + 6 + MENU_ESTIMATED_HEIGHT <= windowHeight - EDGE;
    top = fitsBelow
      ? anchor.y + 6
      : Math.max(
          EDGE,
          Math.min(anchor.y - MENU_ESTIMATED_HEIGHT - 6, windowHeight - MENU_ESTIMATED_HEIGHT - EDGE),
        );
    left = Math.max(EDGE, Math.min(anchor.x - MENU_WIDTH, windowWidth - MENU_WIDTH - EDGE));
  }

  if (!menuOpen || !topic) return null;

  return (
    <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1}>
      <View style={[styles.dropdown, { left, top }]}>
        <TouchableOpacity
          style={styles.item}
          activeOpacity={0.7}
          onPress={() => {
            onClose();
            onPreview(topic);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${topic.title}`}
        >
          <Ionicons name="eye-outline" size={18} color={COLORS.textPrimary} style={styles.itemIcon} />
          <Text style={styles.itemText}>Preview</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.item}
          activeOpacity={0.7}
          onPress={() => {
            onClose();
            onEdit(topic);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${topic.title}`}
        >
          <Ionicons name="create-outline" size={18} color={COLORS.textPrimary} style={styles.itemIcon} />
          <Text style={styles.itemText}>Edit Topic</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.item, styles.itemDanger]}
          activeOpacity={0.7}
          onPress={() => {
            onClose();
            onDelete(topic);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${topic.title}`}
        >
          <Ionicons name="trash-outline" size={18} color={COLORS.danger} style={styles.itemIcon} />
          <Text style={[styles.itemText, { color: COLORS.danger }]}>Delete Topic</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // padding 10, not the quiz menu's 8: a 24px icon plus 20px of padding is a
  // 44px target (WCAG 2.5.8). 8 would land at 40px.
  trigger: { padding: 10 },

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
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, height: MENU_ITEM_HEIGHT, paddingHorizontal: 14 },
  itemIcon: { width: 24 },
  itemText: { fontSize: 14, fontFamily: FONTS.medium, fontWeight: '600', color: COLORS.textPrimary },
  itemDanger: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4 },
});
