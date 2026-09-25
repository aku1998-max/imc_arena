import { router } from 'expo-router';
import { Body, Button, Card, Screen, Title } from '../src/components/ui';

export default function Welcome() {
  return (
    <Screen>
      <Title>IMC Arena</Title>
      <Body>Daily maths practice for grades 4–6, with an explanation for every answer.</Body>
      <Card>
        <Body>
          A parent or guardian sets things up first: verify your email, give consent and create a
          child profile.
        </Body>
        <Button label="I'm a parent — get started" onPress={() => router.push('/parent/sign-in')} />
      </Card>
      <Body muted>No ads, no chat and no public profiles. Children use a nickname only.</Body>
    </Screen>
  );
}
