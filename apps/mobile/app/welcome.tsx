import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Mascot } from '../src/components/Mascot';
import { Body, Button, Eyebrow, Screen, StickerCard } from '../src/components/ui';
import { colors, fonts, spacing } from '../src/theme';

export default function Welcome() {
  return (
    <Screen
      footer={
        <>
          <Button
            label="I'm a parent — get started"
            icon="arrow-right"
            onPress={() => router.push('/parent/sign-in')}
          />
          <Body muted size="small">
            No ads, no chat and no public profiles. Children use a nickname only.
          </Body>
        </>
      }
    >
      <View style={s.hero}>
        <Mascot pose="cheer" height={200} />
        <Eyebrow>Math Challenge</Eyebrow>
        <Text style={s.title} accessibilityRole="header">
          IMC <Text style={s.marker}> Arena </Text>
        </Text>
        <Body>Daily maths practice for grades 4–6, with an explanation for every answer.</Body>
      </View>
      <StickerCard>
        <Body weight="semibold">Grown-ups first</Body>
        <Body muted size="small">
          A parent or guardian sets things up: verify your email, give consent and create a child
          profile.
        </Body>
      </StickerCard>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  title: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 48, color: colors.ink },
  marker: { backgroundColor: colors.marker },
});
