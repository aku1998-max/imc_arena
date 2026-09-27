import {
  colors,
  gridSize,
  minTouchTarget,
  radius,
  spacing,
  topicColors,
  typography,
} from '@imc/design';

export { colors, gridSize, minTouchTarget, radius, spacing, topicColors, typography };

/**
 * Lexend (designed for reading ease) in the four weights the app uses. Each weight is its own
 * family on Android, so styles pick a family instead of setting fontWeight.
 */
export const fonts = {
  regular: 'Lexend_400Regular',
  medium: 'Lexend_500Medium',
  semibold: 'Lexend_600SemiBold',
  bold: 'Lexend_700Bold',
} as const;
