/**
 * Design tokens shared by mobile and admin. Tokens only: each app owns its own components.
 * Solid warm yellow accents, dark readable text, white/ivory surfaces, no gradients.
 */
export const colors = {
  accent: '#F5B700',
  accentPressed: '#D99F00',
  accentSoft: '#FFF3C4',
  text: '#1B1B1F',
  textMuted: '#4A4A55',
  surface: '#FFFFFF',
  surfaceIvory: '#FFFBF0',
  border: '#D9D4C7',
  focus: '#1B1B1F',
  // Feedback colours are always paired with an icon and text, never used alone.
  correct: '#1E6B3A',
  correctSoft: '#E3F4E8',
  incorrect: '#A3261B',
  incorrectSoft: '#FBE6E3',
  info: '#1F4E8C',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 6, md: 12, lg: 20 } as const;

export const typography = {
  fontSizeBody: 17,
  fontSizeSmall: 14,
  fontSizeTitle: 24,
  fontSizeDisplay: 32,
  lineHeightBody: 24,
  weightRegular: '400',
  weightBold: '700',
} as const;

/** Minimum touch target in logical pixels (44-48 recommended). */
export const minTouchTarget = 48;

export type ColorToken = keyof typeof colors;
