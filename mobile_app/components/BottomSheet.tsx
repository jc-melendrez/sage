/**
 * In-tree bottom sheet.
 *
 * Deliberately not a <Modal>. Android silently drops a Modal stacked on
 * another, which is what broke the action menus this pattern replaced (see
 * NotificationSheet for the original). Rendering an absolutely-positioned
 * overlay in the normal tree keeps it above the screen's content and, unlike
 * a Modal, means `useSafeAreaInsets` here reports the real window rather than
 * zero -- so the sheet handles notches and gesture bars without guessing.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, type DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const COLORS = {
  bg: '#F4F2FA',
  textPrimary: '#3a107a',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Fraction of the screen the sheet may occupy, e.g. '78%' or 400. */
  maxHeight?: DimensionValue;
  children?: React.ReactNode;
}

export default function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  maxHeight = '78%',
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View
        style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom + 20 }]}
        pointerEvents="box-none"
      >
        <View style={styles.grabber} />
        {(title || subtitle) && (
          <View style={styles.header}>
            <View style={styles.headerText}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </Pressable>
          </View>
        )}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerText: { flex: 1 },
  title: {
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    marginTop: 3,
    lineHeight: 17,
  },
  list: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  cardSub: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    marginTop: 3,
    lineHeight: 17,
  },
  cardTime: {
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: '#8B5CF6',
    marginTop: 6,
  },
  empty: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted },
});

export const sheetStyles = styles;
