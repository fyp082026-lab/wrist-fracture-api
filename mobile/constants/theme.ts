import { TextStyle, ViewStyle } from 'react-native';

export const COLORS = {
  // Canvas & Surfaces (Obsidian Diagnostic Navy)
  background: '#061426',
  surfaceLowest: '#020E21',
  surfaceLow: '#0E1C2F',
  surface: '#132033',
  surfaceHigh: '#1D2A3E',
  surfaceHighest: '#28354A',
  surfaceBorder: 'rgba(255, 255, 255, 0.08)',
  surfaceBorderHigh: 'rgba(255, 255, 255, 0.16)',
  surfaceBorderSubtle: 'rgba(255, 255, 255, 0.04)',

  // Brand Accents
  primary: '#0D9488', // Clinical Teal
  primaryBright: '#2DD4BF', // Mint Glow
  primaryContainer: '#29A195',
  onPrimaryContainer: '#00201D',
  primaryMutedBg: 'rgba(45, 212, 191, 0.12)',
  primaryMutedBorder: 'rgba(45, 212, 191, 0.35)',

  // Focus Ring (WCAG 2.2 AA visible focus)
  focusRing: '#2DD4BF',

  // Typography Contrast Levels
  textPrimary: '#F8FAFC', // 98% contrast against canvas (>12:1)
  textSecondary: '#94A3B8', // Units and clinical subtext (>6.5:1)
  textMuted: '#8391A6', // Placeholder / tertiary text (≥4.5:1 on every surface)
  outline: '#334155',

  // Status & Findings (Tri-state diagnostic feedback)
  status: {
    fracture: {
      text: '#FCA5A5',
      primary: '#EF4444',
      bg: 'rgba(239, 68, 68, 0.15)',
      border: 'rgba(239, 68, 68, 0.35)',
    },
    intact: {
      text: '#6EE7B7',
      primary: '#10B981',
      bg: 'rgba(16, 185, 129, 0.15)',
      border: 'rgba(16, 185, 129, 0.35)',
    },
    lowConfidence: {
      text: '#FCD34D',
      primary: '#F59E0B',
      bg: 'rgba(245, 158, 11, 0.15)',
      border: 'rgba(245, 158, 11, 0.35)',
    },
    info: {
      text: '#93C5FD',
      primary: '#3B82F6',
      bg: 'rgba(59, 130, 246, 0.15)',
      border: 'rgba(59, 130, 246, 0.35)',
    },
  },
};

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12, // 8-pt aligned
  base: 16, // Standard spacing unit
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
};

export const RADIUS = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
};

// Inter (Stitch typography). Custom fonts need one family per weight
export const FONTS = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

// Enforce tabular figures across all diagnostic numbers to eliminate jitter
export const TABULAR_NUMBERS: TextStyle = {
  fontVariant: ['tabular-nums'],
};

// Standardized Typography Scale with explicit line heights and letter spacing
export const TYPOGRAPHY = {
  h1: {
    fontFamily: FONTS.bold,
    fontSize: 28,
    lineHeight: 34,
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  } as TextStyle,
  h2: {
    fontFamily: FONTS.bold,
    fontSize: 22,
    lineHeight: 28,
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  } as TextStyle,
  h3: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    lineHeight: 24,
    color: COLORS.textPrimary,
    letterSpacing: -0.2,
  } as TextStyle,
  title: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.textPrimary,
    letterSpacing: -0.1,
  } as TextStyle,
  body: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
  } as TextStyle,
  bodyMedium: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
  } as TextStyle,
  bodySemibold: {
    fontFamily: FONTS.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
    letterSpacing: 0.1,
  } as TextStyle,
  caption: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textSecondary,
  } as TextStyle,
  captionMedium: {
    fontFamily: FONTS.medium,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textSecondary,
  } as TextStyle,
  captionBold: {
    fontFamily: FONTS.bold,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  } as TextStyle,
  badge: {
    fontFamily: FONTS.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  } as TextStyle,
  tiny: {
    fontFamily: FONTS.medium,
    fontSize: 10,
    lineHeight: 13,
  } as TextStyle,
};

// Preset shadow tokens
export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  } as ViewStyle,
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  } as ViewStyle,
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  } as ViewStyle,
  glow: {
    shadowColor: COLORS.primaryBright,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  } as ViewStyle,
};

// Layout presets (Max content width for tablet / desktop web)
export const LAYOUT = {
  maxContentWidth: 640,
  maxFormWidth: 480,
  headerHeight: 56,
  minTouchTarget: 48, // WCAG 2.2 AA compliant touch target minimum
};
