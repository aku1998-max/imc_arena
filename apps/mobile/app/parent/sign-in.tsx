import { router } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '../../src/components/ui';
import { DEV_AUTH } from '../../src/config';
import { useSession } from '../../src/session';

export default function ParentSignIn() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Parent sign-in</Title>
      <Body>
        We will email you a one-time code. Parent mode is always protected by sign-in, never by a
        PIN alone.
      </Body>
      <ErrorText message={error} />
      {!sent ? (
        <Card>
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Button
            label="Send code"
            disabled={busy || !email.includes('@')}
            onPress={() =>
              void run(async () => {
                await session.sendOtp(email.trim());
                setSent(true);
              })
            }
          />
        </Card>
      ) : (
        <Card>
          <Field
            label={`Code sent to ${email}`}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
          />
          <Button
            label="Verify"
            disabled={busy || code.length < 6}
            onPress={() =>
              void run(async () => {
                await session.verifyOtp(email.trim(), code.trim());
                router.replace('/parent');
              })
            }
          />
          <Button label="Use a different email" kind="secondary" onPress={() => setSent(false)} />
        </Card>
      )}
      {DEV_AUTH && (
        <Card>
          <Body muted>
            Development only: paste a token from `pnpm --filter @imc/api dev:token parent`.
          </Body>
          <Field
            label="Development token"
            value={devToken}
            onChangeText={setDevToken}
            autoCapitalize="none"
          />
          <Button
            label="Use development token"
            kind="secondary"
            disabled={!devToken}
            onPress={() =>
              void run(async () => {
                await session.devSignIn(devToken);
                router.replace('/parent');
              })
            }
          />
        </Card>
      )}
    </Screen>
  );
}
