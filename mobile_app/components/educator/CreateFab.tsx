import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { CREATE_ACTIONS } from '@/components/educator/CreateQuickActions';
import { COLORS, FONTS, RADIUS, CARD_SHADOW, tint, composite, readableOn } from '@/constants/educatorTheme';

/**
 * Create speed-dial for the educator Home dashboard.
 *
 * The four destinations live in CREATE_ACTIONS, the same list the Create tab's
 * 2x2 grid renders, so the two entry points can never offer different things.
 *
 * Renders as an in-tree overlay rather than a <Modal>: Android silently drops a
 * Modal stacked on another, which is what broke the other action menus (see
 * components/NotificationSheet.tsx).
 *
 * Geometry: the parent tab bar sits in normal flow, not absolute, so this
 * screen's box already ends above it — bottom/right are measured from the
 * screen, not from the window (same assumption as app/(tabs)/activities.tsx).
 */

const FAB_SIZE = 56;
const FAB_BOTTOM = 24;
const FAB_RIGHT = 20;
const ROW_HEIGHT = 52;
const ROW_GAP = 12;
const ROW_WIDTH = 196;
/** Distance from the top of the FAB to the bottom of the first (lowest) row. */
const FIRST_ROW_OFFSET = FAB_BOTTOM + FAB_SIZE + 16;

const EXPAND_MS = 220;
const COLLAPSE_MS = 120;
const STAGGER_MS = 35;

/** Icon on a 15%-alpha wash of its own hue: 3:1 for graphics (WCAG 1.4.11). */
const ICON_CONTRAST_MIN = 3;

export function CreateFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  const openDial = useCallback(() => {
    Haptics.selectionAsync();
    setOpen(true);
  }, []);

  const pick = useCallback(
    (route: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setOpen(false);
      router.push(route as any);
    },
    [router]
  );

  // Android back closes the dial instead of leaving the dashboard.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Haptics.selectionAsync();
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  return (
    <View style={styles.layer} pointerEvents="box-none">
      {open && <DismissScrim onPress={close} />}

      <View style={styles.stack} pointerEvents={open ? 'box-none' : 'none'}>
        {CREATE_ACTIONS.map((action, index) => (
          <CreateFabRow
            key={action.id}
            index={index}
            open={open}
            label={action.label}
            icon={action.icon}
            color={action.color}
            onPress={() => pick(action.route)}
          />
        ))}
      </View>

      <MainFab open={open} onPress={open ? close : openDial} />
    </View>
  );
}

/* ---------- Dismiss scrim ---------- */

function DismissScrim({ onPress }: { onPress: () => void }) {
  const fade = useSharedValue(0);

  useEffect(() => {
    fade.value = withTiming(1, { duration: EXPAND_MS, easing: Easing.out(Easing.quad) });
  }, [fade]);

  const style = useAnimatedStyle(() => ({ opacity: fade.value * 0.38 }));

  return (
    // box-none, not box-only: the View must not swallow the press, or the
    // child TouchableOpacity never fires.
    <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, style]} pointerEvents="box-none">
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onPress}
        accessibilityLabel="Close create menu"
      />
    </Animated.View>
  );
}

/* ---------- One mini-action ---------- */

interface RowProps {
  index: number;
  open: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
}

function CreateFabRow({ index, open, label, icon, color, onPress }: RowProps) {
  // Stagger direction is bottom-up: CREATE_ACTIONS[0] is the row nearest the
  // FAB, and it is the one that should lead.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = open
      ? withDelay(index * STAGGER_MS, withTiming(1, { duration: EXPAND_MS, easing: Easing.out(Easing.back(1.4)) }))
      : withDelay(0, withTiming(0, { duration: COLLAPSE_MS, easing: Easing.in(Easing.quad) }));
  }, [open, index, progress]);

  const style = useAnimatedStyle(() => ({
    // Easing.back overshoots past 1 on the way in; opacity is not clamped by
    // the native layer, so clamp it here or it renders out of range.
    opacity: Math.min(1, progress.value),
    transform: [{ translateY: (1 - progress.value) * 16 }, { scale: 0.85 + progress.value * 0.15 }],
  }));

  const bottom = FIRST_ROW_OFFSET + index * (ROW_HEIGHT + ROW_GAP);
  // The chip is a 15% wash of the action's own hue sitting on the row's
  // surface, so contrast has to be measured against the flattened wash —
  // tint() returns rgba(), which readableOn cannot read. Icons are graphics,
  // so 3:1 (WCAG 1.4.11) is the bar, not 4.5:1.
  const iconBg = composite(color, 0.15, COLORS.surface);
  const iconColor = readableOn(color, iconBg, ICON_CONTRAST_MIN);

  return (
    <Animated.View
      style={[styles.row, { bottom }, style]}
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <TouchableOpacity
        style={styles.rowPress}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View style={[styles.rowIconBg, { backgroundColor: tint(color) }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ---------- The FAB itself ---------- */

function MainFab({ open, onPress }: { open: boolean; onPress: () => void }) {
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withTiming(open ? 1 : 0, { duration: open ? EXPAND_MS : COLLAPSE_MS, easing: Easing.out(Easing.quad) });
  }, [open, spin]);

  // add (+) becomes close (x) as the dial opens.
  const glyphStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 45}deg` }] }));

  return (
    <View style={styles.fabSlot} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close create menu' : 'Create'}
        accessibilityHint={open ? undefined : 'Shows lesson, quiz, game and assignment creation'}
        accessibilityState={{ expanded: open }}
      >
        <Animated.View style={glyphStyle}>
          <Ionicons name="add" size={30} color="#fff" />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  scrim: { backgroundColor: COLORS.purpleDeep },

  /* Rows position themselves with bottom/right, so this only needs to cover
   * the screen; pointerEvents keeps it off the taps. */
  stack: { ...StyleSheet.absoluteFillObject },

  row: {
    position: 'absolute',
    right: FAB_RIGHT,
    width: ROW_WIDTH,
    height: ROW_HEIGHT,
  },
  rowPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    ...CARD_SHADOW,
  },
  rowIconBg: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  fabSlot: { position: 'absolute', right: FAB_RIGHT, bottom: FAB_BOTTOM },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: COLORS.purplePrimary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
});
