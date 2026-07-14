// 🎨 Shared design tokens for Admin & Super Admin UI
// Matches the same purple design system used across Dashboard / Profile

export const COLORS = {
  bg: '#baaeda',
  bgSecondary: '#dad6e7',
  surface: '#FFFFFF',
  surfaceAlt: '#cdc2dd',

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
  info: '#3B82F6',

  textPrimary: '#3a107a',
  textSecondary: '#6B5A85',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.12)',

  // Role accent colors — used to visually tell Admin vs Super Admin apart
  adminAccent: '#7C3AED',   // Dean / Program Chair — purple (matches app theme)
  superAdminAccent: '#0F172A', // Developer — near-black slate, signals "system level"
  superAdminGlow: '#22D3EE',
};

export const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export const STATUS_COLORS: Record<string, string> = {
  active: COLORS.success,
  published: COLORS.success,
  approved: COLORS.success,
  online: COLORS.success,
  operational: COLORS.success,

  pending: COLORS.warning,
  review: COLORS.warning,
  draft: COLORS.textMuted,
  degraded: COLORS.warning,

  inactive: COLORS.danger,
  suspended: COLORS.danger,
  rejected: COLORS.danger,
  down: COLORS.danger,
  error: COLORS.danger,
};
