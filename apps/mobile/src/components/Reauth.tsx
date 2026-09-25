import { useState } from 'react';
import { DEV_AUTH } from '../config';
import { friendlyMessage } from '../lib/api-client';
import { useSession } from '../session';
import { supabase } from '../supabase';
import { Body, Button, Card, ErrorText, Field } from './ui';

type GrantAction = 'purchase' | 'export' | 'delete_student' | 'delete_account' | 'update_sensitive';

/**
 * Sensitive actions need a fresh email code, exchanged for a single-use grant scoped to exactly
 * this action and target. A stale sign-in, hidden screen or PIN is never enough.
 */
export function Reauth({
  action,
  targetId,
  title,
  onGrant,
  onCancel,
}: {
  action: GrantAction;
  targetId: string;
  title: string;
  onGrant: (grant: string) => Promise<void>;
  onCancel: () => void;
}) {
  const session = useSession();
  const [code, setCode] = useState('');
  const [devToken, setDevToken] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const complete = async () => {
    const { grant } = await session.api.request<{ grant: string }>('POST', '/v1/adult-grants', {
      body: { action, targetId },
    });
    await onGrant(grant);
  };
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const email = async () =>
    supabase ? (await supabase.auth.getUser()).data.user?.email : undefined;

  return (
    <Card>
      <Body>{title}</Body>
      <Body muted>For your security, confirm it is you with a new email code.</Body>
      <ErrorText message={error} />
      {supabase && !sent && (
        <Button
          label="Email me a code"
          disabled={busy}
          onPress={run(async () => {
            const e = await email();
            if (!e) throw new Error('Please sign in again.');
            await session.sendOtp(e);
            setSent(true);
          })}
        />
      )}
      {supabase && sent && (
        <>
          <Field
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
          />
          <Button
            label="Confirm"
            disabled={busy || code.length < 6}
            onPress={run(async () => {
              await session.verifyOtp((await email())!, code.trim());
              await complete();
            })}
          />
        </>
      )}
      {DEV_AUTH && (
        <>
          <Field
            label="Fresh development token"
            value={devToken}
            onChangeText={setDevToken}
            autoCapitalize="none"
          />
          <Button
            label="Confirm with development token"
            kind="secondary"
            disabled={busy || !devToken}
            onPress={run(async () => {
              await session.devSignIn(devToken);
              await complete();
            })}
          />
        </>
      )}
      <Button label="Cancel" kind="secondary" onPress={onCancel} />
    </Card>
  );
}
