import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Mascot } from '../../../src/components/Mascot';
import { Body, Button, Card, ErrorText, Loading, Screen } from '../../../src/components/ui';
import { SUPPORT_URL } from '../../../src/config';
import { useQuery } from '../../../src/hooks';
import { useSession } from '../../../src/session';
import { colors, fonts, spacing } from '../../../src/theme';

export default function Profile() {
  const { leaveChildMode } = useSession();
  const { data, error, loading } = useQuery<{
    student: { nickname: string; avatarKey: string; grade: number; locale: string };
  }>('/v1/me');
  const rows = data
    ? [
        { label: 'Grade', value: String(data.student.grade) },
        { label: 'Avatar', value: data.student.avatarKey },
        {
          label: 'Language',
          value: data.student.locale === 'en' ? 'English' : data.student.locale,
        },
      ]
    : [];
  return (
    <Screen>
      <ErrorText message={error} />
      {loading && !data && <Loading />}
      {data && (
        <View style={s.header}>
          <Mascot pose="cheer" height={120} decorative />
          <Text style={s.name} accessibilityRole="header">
            {data.student.nickname}
          </Text>
        </View>
      )}
      {data && (
        <Card>
          {rows.map((r) => (
            <View key={r.label} style={s.row}>
              <Body muted>{r.label}</Body>
              <Body weight="medium">{r.value}</Body>
            </View>
          ))}
          <Body muted size="small">
            A parent can change these in parent mode.
          </Body>
        </Card>
      )}
      <Button
        label="Help"
        icon="help-circle"
        kind="secondary"
        onPress={() => void Linking.openURL(SUPPORT_URL)}
      />
      <View style={s.parent}>
        <View style={s.parentHead}>
          <Feather name="lock" size={18} color={colors.inkMuted} />
          <Body weight="semibold">For grown-ups</Body>
        </View>
        <Body muted size="small">
          Parent mode needs the parent's email sign-in. This device leaves child mode.
        </Body>
        <Button
          label="Switch to parent mode"
          kind="quiet"
          onPress={() => void leaveChildMode().then(() => router.replace('/parent/sign-in'))}
        />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.xs },
  name: { fontFamily: fonts.bold, fontSize: 28, color: colors.ink },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
  },
  parent: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  parentHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
