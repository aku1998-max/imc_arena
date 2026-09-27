import { Feather } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, gridSize, minTouchTarget, radius, spacing, typography } from '../theme';
import { topicStyle } from '../topics';

export type IconName = ComponentProps<typeof Feather>['name'];

/** Faint graph-paper grid drawn behind a screen. Purely decorative. */
export function GraphPaper() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const cols = Math.ceil(size.w / gridSize);
  const rows = Math.ceil(size.h / gridSize);
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: cols }, (_, i) => (
        <View key={`c${i}`} style={[s.gridV, { left: (i + 1) * gridSize }]} />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <View key={`r${i}`} style={[s.gridH, { top: (i + 1) * gridSize }]} />
      ))}
    </View>
  );
}

/**
 * A screen on graph paper. `footer` stays pinned to the bottom (primary actions), so the main
 * button is always reachable with a thumb.
 */
export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <GraphPaper />
      {scroll ? (
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[s.content, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={s.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Small uppercase label above a card or section. */
export function Eyebrow({
  children,
  color = colors.brand,
}: {
  children: ReactNode;
  color?: string;
}) {
  return <Text style={[s.eyebrow, { color }]}>{children}</Text>;
}

export function Body({
  children,
  muted = false,
  size = 'body',
  weight = 'regular',
}: {
  children: ReactNode;
  muted?: boolean;
  size?: 'body' | 'small' | 'large';
  weight?: keyof typeof fonts;
}) {
  return (
    <Text
      style={[
        s.body,
        size === 'small' && s.small,
        size === 'large' && s.large,
        { fontFamily: fonts[weight] },
        muted && s.muted,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  hint,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'quiet';
  disabled?: boolean;
  hint?: string;
  icon?: IconName;
}) {
  const textColor =
    kind === 'primary' || kind === 'danger'
      ? colors.surface
      : kind === 'quiet'
        ? colors.brand
        : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' && { backgroundColor: pressed ? colors.brandPressed : colors.brand },
        kind === 'secondary' && [
          s.buttonSecondary,
          pressed && { backgroundColor: colors.brandSoft },
        ],
        kind === 'danger' && { backgroundColor: pressed ? '#8F1C13' : '#B42318' },
        kind === 'quiet' && s.buttonQuiet,
        disabled && s.disabled,
      ]}
    >
      <Text style={[s.buttonText, { color: textColor }]}>{label}</Text>
      {icon ? <Feather name={icon} size={18} color={textColor} /> : null}
    </Pressable>
  );
}

/** White card with an ink outline. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

/** The featured card: ink outline with a solid green offset shadow, like a sticker on paper. */
export function StickerCard({ children }: { children: ReactNode }) {
  return (
    <View style={s.stickerWrap}>
      <View style={s.stickerShadow} />
      <View style={[s.card, s.stickerCard]}>{children}</View>
    </View>
  );
}

/** Highlighter-yellow note, used for explanations. */
export function Note({ children }: { children: ReactNode }) {
  return <View style={s.note}>{children}</View>;
}

export function TopicChip({ slug, suffix }: { slug: string | null | undefined; suffix?: string }) {
  const t = topicStyle(slug);
  return (
    <View style={[s.chip, { backgroundColor: t.soft }]}>
      <Text style={[s.chipSymbol, { color: t.ink }]}>{t.symbol}</Text>
      <Text style={[s.chipText, { color: t.ink }]}>
        {t.name}
        {suffix ? ` · ${suffix}` : ''}
      </Text>
    </View>
  );
}

/** Square topic badge used in lists. */
export function TopicBadge({ slug }: { slug: string | null | undefined }) {
  const t = topicStyle(slug);
  return (
    <View style={[s.badge, { backgroundColor: t.soft }]}>
      <Text style={[s.badgeText, { color: t.ink }]}>{t.symbol}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = colors.brand }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      style={s.bar}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <View style={[s.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        placeholderTextColor={colors.inkFaint}
        {...props}
      />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={s.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Feather name="alert-circle" size={18} color={colors.incorrectInk} />
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={s.loading} accessibilityLabel={label}>
      <ActivityIndicator color={colors.brand} />
      <Text style={s.muted}>{label}…</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.gridLine },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.gridLine },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: typography.fontSizeTitle,
    lineHeight: 34,
    color: colors.ink,
  },
  eyebrow: {
    fontFamily: fonts.semibold,
    fontSize: typography.fontSizeCaption,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  body: {
    fontSize: typography.fontSizeBody,
    lineHeight: typography.lineHeightBody,
    color: colors.ink,
  },
  small: { fontSize: typography.fontSizeSmall, lineHeight: 20 },
  large: { fontSize: 20, lineHeight: 28 },
  muted: { color: colors.inkMuted, fontFamily: fonts.regular },
  button: {
    minHeight: minTouchTarget + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  buttonQuiet: { backgroundColor: 'transparent', minHeight: minTouchTarget },
  buttonText: { fontFamily: fonts.semibold, fontSize: typography.fontSizeBody },
  disabled: { opacity: 0.45 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    borderWidth: 1.5,
    borderColor: colors.ink,
    gap: spacing.sm + 2,
  },
  stickerWrap: { paddingRight: 4, paddingBottom: 4 },
  stickerShadow: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
  },
  stickerCard: { padding: spacing.lg - 4 },
  note: {
    backgroundColor: colors.highlight,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.ink,
    padding: spacing.md,
    gap: 6,
  },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipSymbol: { fontFamily: fonts.bold, fontSize: 13 },
  chipText: { fontFamily: fonts.semibold, fontSize: 13 },
  badge: {
    width: 36,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 14 },
  bar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gridLine,
    overflow: 'hidden',
    flexGrow: 1,
  },
  barFill: { height: 8, borderRadius: 4 },
  field: { gap: spacing.xs },
  label: { fontFamily: fonts.medium, fontSize: typography.fontSizeSmall, color: colors.inkMuted },
  input: {
    minHeight: minTouchTarget + 4,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md - 4,
    fontFamily: fonts.regular,
    fontSize: typography.fontSizeBody,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  error: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.incorrectSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.incorrect,
    padding: spacing.md - 4,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.medium,
    color: colors.incorrectInk,
    fontSize: typography.fontSizeBody - 1,
  },
  loading: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
});
