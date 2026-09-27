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

/* ------------------------------------------------------------------ *
 * Additive scales (educator dashboard redesign)
 *
 * These are ADDITIVE. Nothing above this line was changed, so every
 * screen that already imports COLORS / FONTS / RADIUS / STATUS renders
 * exactly as it did before. New work should prefer these scales.
 * ------------------------------------------------------------------ */

/** 4pt spacing scale. Replaces the ad-hoc 11.5/12.5/13.5/14.5 values. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/**
 * Type scale. `meta` is the smallest step and is only for supporting
 * metadata (counts, timestamps, captions) — never for anything an
 * educator has to read to act.
 */
export const TYPE = {
  meta: 12,
  sm: 13,
  body: 15,
  section: 17,
  title: 20,
} as const;

/* ---------- Contrast utilities (WCAG 2.2) ---------- */

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio between two hex colors, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(hexToRgb(a));
  const l2 = luminance(hexToRgb(b));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Flatten `tint(hex, alpha)` onto an opaque backdrop and return a solid
 * hex. `tint()` returns rgba(), which cannot be contrast-tested.
 */
export function composite(hex: string, alpha: number, bgHex: string): string {
  const f = hexToRgb(hex);
  const b = hexToRgb(bgHex);
  return rgbToHex({
    r: f.r * alpha + b.r * (1 - alpha),
    g: f.g * alpha + b.g * (1 - alpha),
    b: f.b * alpha + b.b * (1 - alpha),
  });
}

const readableCache = new Map<string, string>();

/**
 * Darken `hex` until it clears `minRatio` against `bgHex`, so a label can
 * legally sit on a tint of its own hue.
 *
 * Why this exists: rendering a pill's text in the same color as the pill's
 * 15%-alpha background measured 1.49–3.18:1 for every SAGE semantic color
 * (WCAG 2.2 SC 1.4.3 requires 4.5:1). Six of seven failed. Rather than
 * hardcoding a second palette, every caller darkens its own hue, so hue
 * identity is preserved and the fix holds for colors added later.
 */
export function readableOn(hex: string, bgHex: string, minRatio = 4.5): string {
  const key = `${hex}|${bgHex}|${minRatio}`;
  const cached = readableCache.get(key);
  if (cached) return cached;

  const bgL = luminance(hexToRgb(bgHex));
  const ratio = (c: Rgb) => {
    const l = luminance(c);
    const [hi, lo] = l >= bgL ? [l, bgL] : [bgL, l];
    return (hi + 0.05) / (lo + 0.05);
  };

  // Walk toward black in small steps; black always maximises contrast
  // against a light backdrop, so this terminates.
  let out = hex;
  for (let step = 0; step < 100; step++) {
    const c = hexToRgb(hex);
    const candidate: Rgb = {
      r: c.r * (1 - step / 100),
      g: c.g * (1 - step / 100),
      b: c.b * (1 - step / 100),
    };
    if (ratio(candidate) >= minRatio) {
      out = rgbToHex(candidate);
      break;
    }
    out = rgbToHex(candidate);
  }

  readableCache.set(key, out);
  return out;
}
