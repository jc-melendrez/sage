import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';
import type { HeaderAnchor } from './EducatorHeader';

const MENU_PADDING = 8;
const MENU_ITEM_HEIGHT = 44;
const EDGE = 8;

/** Comfortably wider than the longest label here ("Remove class chat"). */
const MENU_WIDTH = 208;

export interface CourseOption {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Renders the label and icon in the danger hue, above a divider. */
  destructive?: boolean;
}

/**
 * Dropdown anchored to EducatorHeader's options button.
 *
 * The trigger lives in the header (it has to, to sit in the icon row and look
 * like part of it) but this dropdown does NOT. Render it once, at the screen
 * root, outside the ScrollView. Both constraints are load-bearing:
 *
 *   - RN `zIndex` cannot lift a nested child above a later sibling of its
 *     ancestor, so a menu rendered inside the scroll content gets painted
 *     underneath the rows below it. See the long note at
 *     components/ai/AIAssistantScreen.tsx:885-900, where a per-row Delete
 *     silently stopped working.
 *   - The anchor comes from `measureInWindow`, i.e. window coordinates.
 *     Inside scroll content those numbers resolve against the content rather
 *     than the window, so the dropdown lands in the wrong place.
 *
 * It's an in-tree absolute overlay rather than a <Modal> because Android
 * silently drops a Modal stacked on another.
 */
export function CourseOptionsMenu({
  open,
  anchor,
  options,
  onClose,
}: {
  open: boolean;
  anchor: HeaderAnchor | null;
  options: CourseOption[];
  onClose: () => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  if (!open || !anchor || options.length === 0) return null;

  // One extra row of height for the divider the destructive item draws.
  const estimatedHeight = MENU_PADDING * 2 + options.length * MENU_ITEM_HEIGHT;

  const fitsBelow = anchor.y + 6 + estimatedHeight <= windowHeight - EDGE;
  const top = fitsBelow
    ? anchor.y + 6
    : Math.max(EDGE, Math.min(anchor.y - estimatedHeight - 6, windowHeight - estimatedHeight - EDGE));
  const left = Math.max(EDGE, Math.min(anchor.x - MENU_WIDTH, windowWidth - MENU_WIDTH - EDGE));

  return (
    <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1} accessibilityLabel="Close menu">
      <View style={[styles.dropdown, { left, top }]}>
        {options.map((option, index) => {
          const isFirstDestructive = index > 0 && option.destructive && !options[index - 1]?.destructive;
          const color = option.destructive ? COLORS.danger : COLORS.textPrimary;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.item, isFirstDestructive && styles.itemDivider]}
              activeOpacity={0.7}
              onPress={() => {
                onClose();
                option.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={option.label}
            >
              <Ionicons name={option.icon} size={18} color={color} style={styles.itemIcon} />
              <Text style={[styles.itemText, option.destructive && { color }]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  itemDivider: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4, paddingTop: 4 },
  itemIcon: { width: 24 },
  itemText: { fontSize: 14, fontFamily: FONTS.medium, fontWeight: '600', color: COLORS.textPrimary },
});