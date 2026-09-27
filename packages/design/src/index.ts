/**
 * Design tokens shared by mobile and admin. Tokens only: each app owns its own components.
 *
 * Direction "Graph Paper": a studious, clean look on graph-paper white, with the IMC
 * Math Challenge jersey green as the brand colour and highlighter yellow for explanations.
 * The green is the mascot's jersey green, darkened just enough for white text (5.1:1).
 */
export const colors = {
  brand: '#12803F',
  brandPressed: '#0D5F2E',
  brandSoft: '#E2F5E9',
  ink: '#172019',
  inkMuted: '#52625A',
  inkFaint: '#7D8B84',
  paper: '#FCFDFB',
  gridLine: '#E3EFE6',
  surface: '#FFFFFF',
  border: '#CFDCD3',
  highlight: '#FFF9C9',
  marker: '#FFF27A',
  star: '#F5C400',
  // Feedback colours are always paired with an icon and words, never used alone.
  // Incorrect is orange (not red) so it stays distinct from green for colour-blind children.
  correct: '#12803F',
  correctSoft: '#E2F5E9',
  incorrect: '#B45309',
  incorrectInk: '#92400E',
  incorrectSoft: '#FDF0E1',
  focus: '#172019',
  // Aliases kept for older screens.
  accent: '#12803F',
  accentPressed: '#0D5F2E',
  accentSoft: '#E2F5E9',
  text: '#172019',
  textMuted: '#52625A',
  surfaceIvory: '#FCFDFB',
  info: '#1D5FB8',
} as const;

/** Topic accents borrowed from the multicolour "Math" letters of the IMC logo. */
export const topicColors = {
  arithmetic: { ink: '#B45309', soft: '#FFF1E0' },
  fractions: { ink: '#6D28D9', soft: '#F1E8FF' },
  geometry: { ink: '#1D5FB8', soft: '#E3EEFF' },
  patterns: { ink: '#12803F', soft: '#E2F5E9' },
  measurement: { ink: '#B42318', soft: '#FDE8E7' },
  logic: { ink: '#0E7490', soft: '#E0F4F8' },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const typography = {
  fontSizeBody: 17,
  fontSizeSmall: 14,
  fontSizeCaption: 12,
  fontSizeTitle: 28,
  fontSizeDisplay: 44,
  lineHeightBody: 25,
  weightRegular: '400',
  weightBold: '700',
} as const;

/** Grid cell of the graph-paper background, in logical pixels. */
export const gridSize = 24;

/** Minimum touch target in logical pixels (44-48 recommended). */
export const minTouchTarget = 48;

export type ColorToken = keyof typeof colors;
export type TopicSlug = keyof typeof topicColors;
