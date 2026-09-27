import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, CARD_SHADOW, tint, composite, readableOn } from '@/constants/educatorTheme';

/* Resolved once at module load so StyleSheet entries stay literal. */
const EMPTY_ICON_COLOR = readableOn(COLORS.purpleVibrant, COLORS.bgSecondary, 3);
const EMPTY_TITLE_COLOR = readableOn(COLORS.purpleDark, COLORS.surface);
const EMPTY_TEXT_COLOR = readableOn(COLORS.purpleVibrant, COLORS.surface);

/* ---------- StatCard — mirrors profile.tsx overviewCard ---------- */
interface StatCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
  color?: string;
  flex?: boolean;
}
export function StatCard({ icon, value, label, color = COLORS.purpleVibrant, flex = true }: StatCardProps) {
  return (
    <View style={[styles.statCard, flex && { flex: 1 }]}>
      <View style={[styles.statIconBg, { backgroundColor: tint(color) }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/* ---------- SectionHeader — mirrors Dashboard.tsx sectionHeader ---------- */
interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}
export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && (
        <TouchableOpacity
          onPress={onAction}
          style={styles.sectionAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.viewAllText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ---------- ProgressBar — mirrors profile.tsx glass progress bar ---------- */
interface ProgressBarProps {
  percent: number; // 0-100
  height?: number;
  trackColor?: string;
}
export function ProgressBar({ percent, height = 8, trackColor = 'rgba(124,58,237,0.12)' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={[styles.progressTrack, { height, backgroundColor: trackColor, borderRadius: height / 2 }]}>
      <LinearGradient
        colors={[COLORS.purplePrimary, COLORS.purpleLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.progressFill, { width: `${clamped}%`, borderRadius: height / 2 }]}
      />
    </View>
  );
}

/* ---------- Pill — status / count chip, mirrors liveBadge & earnedPill ---------- */
interface PillProps {
  label: string;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}
export function Pill({ label, color = COLORS.purpleVibrant, icon }: PillProps) {
  // The chip background is a 15%-alpha wash of the label's own hue, which
  // measured 1.49-3.18:1 for every SAGE semantic color (WCAG 1.4.3 needs
  // 4.5:1). Flatten the wash onto the surface, then darken the hue until it
  // clears the bar. Hue identity is preserved and the fix also covers any
  // color a future caller passes in.
  const bg = composite(color, 0.15, COLORS.surface);
  const fg = readableOn(color, bg);
  return (
    <View style={[styles.pill, { backgroundColor: tint(color) }]}>
      {icon && <Ionicons name={icon} size={11} color={fg} style={{ marginRight: 4 }} />}
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/* ---------- FilterChip — segmented filter, e.g. Today / Week / Month ---------- */
interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}
export function FilterChip({ label, active, onPress, disabled = false }: FilterChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.filterChip, active && styles.filterChipActive, disabled && styles.filterChipDisabled]}
      activeOpacity={0.8}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ---------- EmptyState — mirrors Dashboard.tsx emptyStateCard ---------- */
interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
}
export function EmptyState({ icon, title, text }: EmptyStateProps) {
  return (
    <View style={styles.emptyCard} accessible accessibilityRole="summary" accessibilityLabel={`${title}. ${text}`}>
      <View style={styles.emptyIconBox}>
        <Ionicons name={icon} size={32} color={EMPTY_ICON_COLOR} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

/* ---------- Avatar — initials circle, mirrors profile.tsx avatarContainer ---------- */
interface AvatarProps {
  initials: string;
  size?: number;
}
export function Avatar({ initials, size = 44 }: AvatarProps) {
  return (
    <LinearGradient
      colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, justifyContent: 'center', alignItems: 'center' }}
    >
      <Text style={{ color: 'white', fontFamily: FONTS.black, fontSize: size * 0.36 }}>{initials}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  statCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statIconBg: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statValue: { fontSize: 20, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.extraBold, fontWeight: '900', letterSpacing: 1, color: COLORS.textPrimary, flexShrink: 1, marginRight: 12 },
  // padding grows the tap target to 44px (WCAG 2.5.8); the negative margin
  // cancels it so the header keeps its existing visual rhythm.
  sectionAction: { paddingVertical: 14, marginVertical: -14, paddingHorizontal: 4, marginHorizontal: -4 },
  viewAllText: { color: COLORS.purpleDeep, fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600' },

  progressTrack: { width: '100%', overflow: 'hidden' },
  progressFill: { height: '100%' },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontFamily: FONTS.bold, fontWeight: '700' },

  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  filterChipDisabled: { opacity: 0.5 },
  filterChipText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  filterChipTextActive: { color: 'white' },

  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl - 12,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptyIconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: { color: EMPTY_TITLE_COLOR, fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  emptyText: { color: EMPTY_TEXT_COLOR, fontSize: 13, fontFamily: FONTS.regular, textAlign: 'center', lineHeight: 19 },
});

export { CARD_SHADOW };
