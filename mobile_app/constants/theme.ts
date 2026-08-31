/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
export const colors = {
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primaryLight: '#A78BFA',
  secondary: '#10B981',
  secondaryDark: '#059669',
  accent: '#F59E0B',
  background: '#F9FAFB',
  surface: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  purple: {
    50: '#F5F3FF',
    100: '#EDE9FE',
    200: '#DDD6FE',
    300: '#C4B5FD',
    400: '#A78BFA',
    500: '#8B5CF6',
    600: '#7C3AED',
    700: '#6D28D9',
    800: '#5B21B6',
    900: '#4C1D95',
  },
  gradients: {
    primary: ['#7C3AED', '#6D28D9'],
    secondary: ['#10B981', '#059669'],
    accent: ['#F59E0B', '#D97706'],
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

/**
 * Semantic palette for the learning screens (courses, quizzes, groups, chat).
 * Consolidates the five duplicated per-file COLORS objects.
 * Values are unchanged from the legacy palettes (behavior-preserving migration);
 * contrast/surface tuning happens centrally here in later passes.
 */
export const palette = {
  // Backgrounds — soft neutral canvas, white cards (Phase 2 surface modernization)
  bg: '#F4F2FA',
  bgSecondary: '#ECE9F5',
  surface: '#FFFFFF',
  surfaceLight: '#5A4F6C',

  // Purple ramp aliases (values match colors.purple)
  purpleDeep: colors.purple[900],
  purpleDark: colors.purple[700],
  purplePrimary: colors.purple[600],
  purpleVibrant: colors.purple[500],
  purpleLight: colors.purple[400],
  purplePale: colors.purple[300],
  purpleGhost: colors.purple[200],

  // Accents
  accent: '#22D3EE',
  success: colors.success,
  successDark: '#059669',
  warning: colors.warning,
  warningDark: '#D97706',
  danger: colors.error,

  // Text
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textDark: '#1F2937',
  // AA-compliant muted text for light surfaces (#6B7280 on white/bg ≈ 4.8:1)
  textMuted: '#6B7280',
  textMutedStrong: '#6B7280',

  // Borders — purple-tinted (replaces legacy brown-black rgba(44,29,0,0.15))
  border: 'rgba(76, 29, 149, 0.12)',
  borderPurple: 'rgba(76, 29, 149, 0.12)',
  // Stronger variant for dashed/empty-state outlines that must read at a glance
  borderStrong: 'rgba(76, 29, 149, 0.28)',
};

/** Montserrat weight map — names must match the fonts loaded in app/_layout.tsx */
export const fontFamily = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
} as const;

/** Type scale */
export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  base: 15,
  lg: 16,
  xl: 18,
  xxl: 22,
  display: 28,
  hero: 32,
} as const;

/** Elevation scale — consistent iOS shadows + Android elevation */
export const elevation = {
  sm: {
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;
