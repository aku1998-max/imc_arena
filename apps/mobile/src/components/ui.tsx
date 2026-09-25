import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, minTouchTarget, radius, spacing, typography } from '../theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'danger' && styles.buttonDanger,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, kind === 'danger' && styles.buttonTextDanger]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        placeholderTextColor={colors.textMuted}
        {...props}
      />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={styles.errorText}>⚠︎ {message}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.loading} accessibilityLabel={label}>
      <ActivityIndicator color={colors.text} />
      <Text style={styles.muted}>{label}…</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surfaceIvory },
  content: { padding: spacing.md, gap: spacing.md },
  title: {
    fontSize: typography.fontSizeTitle,
    fontWeight: typography.weightBold,
    color: colors.text,
  },
  body: {
    fontSize: typography.fontSizeBody,
    lineHeight: typography.lineHeightBody,
    color: colors.text,
  },
  muted: { color: colors.textMuted },
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accentPressed,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonSecondary: { backgroundColor: colors.surface, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.incorrect, borderColor: colors.incorrect },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    fontSize: typography.fontSizeBody,
    fontWeight: typography.weightBold,
    color: colors.text,
  },
  buttonTextDanger: { color: colors.surface },
  disabled: { opacity: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  field: { gap: spacing.xs },
  label: { fontSize: typography.fontSizeSmall, color: colors.textMuted },
  input: {
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    fontSize: typography.fontSizeBody,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { backgroundColor: colors.incorrectSoft, borderRadius: radius.sm, padding: spacing.sm },
  errorText: { color: colors.incorrect, fontSize: typography.fontSizeBody },
  loading: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
});
