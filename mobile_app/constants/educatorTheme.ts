/**
 * Educator Interface — Design Tokens
 *
 * These are the SAME tokens used in components/Dashboard.tsx and
 * app/(tabs)/profile.tsx. Do not introduce new colors/fonts here —
 * extend this file instead of forking new values, so every educator
 * screen stays visually identical to the student-facing app.
 */

export const COLORS = {
  bg: '#E4EAF6',
  bgSecondary: '#DBE1F0',
  surface: '#EFF3FA',
  surfaceLight: '#5A4F6C',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
  purpleGhost: '#DDD6FE',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textSecondary: '#5B5780',
  textMuted: '#6B6F85',
  border: 'rgba(76, 29, 149, 0.16)',
};

export const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

// Shared radii / elevation, lifted from Card.tsx, Dashboard.tsx statCard,
// and profile.tsx overviewCard/listCard so every new surface matches.
export const RADIUS = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 32,
  pill: 9999,
};

export const CARD_SHADOW = {
  shadowColor: COLORS.purpleDeep,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 3,
};

// Tints used throughout Dashboard/Profile for icon chips: rgba(color, 0.15)
export const tint = (hex: string, alpha = 0.15) => {
  const bigint = parseInt(hex.replace('#', ''), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Status colors for at-risk / on-track student states, assignment status,
// and flagged AI conversations — reuses existing semantic colors only.
export const STATUS = {
  onTrack: COLORS.success,
  atRisk: COLORS.danger,
  needsAttention: COLORS.warning,
  submitted: COLORS.success,
  pending: COLORS.warning,
  overdue: COLORS.danger,
  assigned: COLORS.purpleVibrant,
};
