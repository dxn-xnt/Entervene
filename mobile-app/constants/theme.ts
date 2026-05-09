/**
 * Entervene Mobile Theme
 * Matches the frontend's neobrutalism / retro design system.
 * Colors, shadows, and typography tokens are kept in sync with App.css.
 */

import { Platform } from 'react-native';

// ─── Color Tokens (synced with frontend :root) ──────────────────────────────
export const AppColors = {
  // Core
  primary: '#ffdb33',
  primaryHover: '#ffcc00',
  primaryForeground: '#000000',
  accent: '#fae583',
  accentForeground: '#000000',

  // Surfaces
  background: '#ffffff',
  foreground: '#000000',
  card: '#ffffff',
  cardForeground: '#000000',

  // Secondary
  secondary: '#000000',
  secondaryForeground: '#ffffff',

  // Muted
  muted: '#cccccc',
  mutedForeground: '#5a5a5a',

  // Feedback
  destructive: '#e63946',
  destructiveForeground: '#ffffff',

  // Borders & Shadows
  border: '#000000',

  // Extra helpers
  white: '#ffffff',
  black: '#000000',
  inputBackground: '#f9f9f9',
  placeholder: '#9a9a9a',
};

// ─── Dark-mode overrides (for future use) ────────────────────────────────────
export const AppColorsDark = {
  ...AppColors,
  background: '#1a1a1a',
  foreground: '#f5f5f5',
  card: '#242424',
  cardForeground: '#f5f5f5',
  secondary: '#3a3a3a',
  secondaryForeground: '#f5f5f5',
  muted: '#3f3f46',
  mutedForeground: '#a0a0a0',
  border: '#5c5c5c',
  inputBackground: '#2a2a2a',
  placeholder: '#777777',
};

// ─── Neobrutalism Shadow ─────────────────────────────────────────────────────
export const NeoShadow = {
  xs: { shadowOffset: { width: 1, height: 1 }, shadowOpacity: 1, shadowRadius: 0, elevation: 2 },
  sm: { shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  md: { shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  lg: { shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 6 },
  xl: { shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 0, elevation: 8 },
};

// ─── Spacing ─────────────────────────────────────────────────────────────────
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─── Border ──────────────────────────────────────────────────────────────────
export const Borders = {
  width: 2,
  radius: 0, // retro = sharp corners; set to 8 for softer look
};

// ─── Legacy Colors export (kept for compatibility with existing components) ──
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

// ─── Fonts ───────────────────────────────────────────────────────────────────
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
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
