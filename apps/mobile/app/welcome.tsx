import { router } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { Mascot } from '../src/components/Mascot';
import { PolicyLinks } from '../src/components/PolicyLinks';
import { Body, Button, Eyebrow, Screen, StickerCard } from '../src/components/ui';
import { spacing } from '../src/theme';

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
          <PolicyLinks />
        </>
      }
    >
      <View style={s.hero}>
        <Image
          source={require('../assets/logo.png')}
          style={s.logo}
          resizeMode="contain"
          accessibilityRole="header"
          accessibilityLabel="Math Challenge"
        />
        <Mascot pose="cheer" height={180} decorative />
        <Eyebrow>Get ready for IMC competitions</Eyebrow>
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
  logo: { width: 260, height: 97, maxWidth: '100%' },
});
