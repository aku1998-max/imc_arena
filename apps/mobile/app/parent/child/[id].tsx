import type { StudentProfile } from '@imc/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Reauth } from '../../../src/components/Reauth';
import {
  Body,
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  Screen,
  Title,
} from '../../../src/components/ui';
import { useQuery } from '../../../src/hooks';
import { lastNDays, percent } from '../../../src/lib/dates';
import { friendlyMessage } from '../../../src/lib/api-client';
import { purchase } from '../../../src/purchases';
import { useSession } from '../../../src/session';

interface Home {
  student: StudentProfile;
  daily: { status: string };
  weeklyGoal: { target: number; completed: number };
  access: { pro: boolean; validUntil: string | null };
  recentActivity: Array<{
    sessionId: string;
    mode: string;
    completedAt: string;
    correctCount: number;
    itemCount: number;
  }>;
}
interface Progress {
  completedSessions: number;
  firstAttempts: { count: number; correct: number };
  retries: { count: number; correct: number };
  topics: Array<{
    slug: string;
    firstAttemptCount: number;
    firstAttemptCorrect: number;
    retryCount: number;
  }>;
  sufficientData: boolean;
}
interface Device {
  id: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
type Sensitive = null | 'export' | 'delete' | 'purchase';

export default function ChildDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, enterChildMode } = useSession();
  const range = lastNDays(7);
  const home = useQuery<Home>(`/v1/students/${id}/home`);
  const progress = useQuery<Progress>(
    `/v1/students/${id}/progress?from=${range.from}&to=${range.to}`,
  );
  const devices = useQuery<{ devices: Device[] }>(`/v1/students/${id}/devices`);
  const billing = useQuery<{
    billingEnabled: boolean;
    entitlements: Array<{ studentId: string; revokedAt: string | null; validUntil: string | null }>;
  }>('/v1/billing/entitlements');
  const [sensitive, setSensitive] = useState<Sensitive>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  if (!home.data) {
    return (
      <Screen>
        <ErrorText message={home.error} />
        {home.loading && <Loading />}
      </Screen>
    );
  }
  const s = home.data.student;
  const p = progress.data;

  return (
    <Screen>
      <Title>{s.nickname}</Title>
      <ErrorText message={error} />
      {message && <Body>{message}</Body>}
      <Card>
        <Body>Today's challenge: {home.data.daily.status.replace('_', ' ')}</Body>
        <Body>
          This week: {home.data.weeklyGoal.completed} of {home.data.weeklyGoal.target} sessions
        </Body>
        {p &&
          (p.sufficientData ? (
            <Body>
              First-try accuracy (7 days): {p.firstAttempts.correct}/{p.firstAttempts.count} (
              {percent(p.firstAttempts.correct, p.firstAttempts.count)}) · Retries:{' '}
              {p.retries.count}
            </Body>
          ) : (
            <Body muted>Not enough answers yet to show accuracy.</Body>
          ))}
        {p?.topics.map((t) => (
          <Body key={t.slug} muted>
            {t.slug}: {t.firstAttemptCorrect}/{t.firstAttemptCount} first tries, {t.retryCount}{' '}
            retries
          </Body>
        ))}
      </Card>

      <Card>
        <Body>Hand this device to {s.nickname}</Body>
        <Body muted>
          Your sign-in is removed from this device. Returning to parent mode needs your email code.
        </Body>
        <Button
          label="Start child mode"
          onPress={() =>
            void act(async () => {
              const r = await api.request<{ token: string }>(
                'POST',
                `/v1/students/${id}/child-sessions`,
                { body: { deviceLabel: 'This device' } },
              );
              await enterChildMode(id, r.token);
              router.replace('/child/home');
            })
          }
        />
      </Card>

      <Card>
        <Body>Signed-in devices</Body>
        {devices.data?.devices.map((d) => (
          <View key={d.id} style={{ gap: 4 }}>
            <Body muted>
              {d.deviceLabel} ·{' '}
              {d.revokedAt ? 'signed out' : `until ${new Date(d.expiresAt).toLocaleDateString()}`}
            </Body>
            {!d.revokedAt && (
              <Button
                label={`Sign out ${d.deviceLabel}`}
                kind="secondary"
                onPress={() =>
                  void act(async () => {
                    await api.request('DELETE', `/v1/child-sessions/${d.id}`);
                    await devices.refresh();
                    setMessage('Device signed out.');
                  })
                }
              />
            )}
          </View>
        ))}
      </Card>

      <Card>
        <Body>Settings (parent only)</Body>
        <Field
          label="Timezone"
          value={timezone ?? s.timezone}
          onChangeText={setTimezone}
          autoCapitalize="none"
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[4, 5, 6].map((g) => (
            <View key={g} style={{ flex: 1 }}>
              <Button
                label={`Grade ${g}${s.grade === g ? ' ✓' : ''}`}
                kind={s.grade === g ? 'primary' : 'secondary'}
                onPress={() =>
                  void act(async () => {
                    await api.request('PATCH', `/v1/students/${id}`, { body: { grade: g } });
                    await home.refresh();
                  })
                }
              />
            </View>
          ))}
        </View>
        {timezone && timezone !== s.timezone && (
          <Button
            label="Save timezone"
            onPress={() =>
              void act(async () => {
                await api.request('PATCH', `/v1/students/${id}`, { body: { timezone } });
                setTimezone(null);
                await home.refresh();
              })
            }
          />
        )}
      </Card>

      <Card>
        <Body>
          Plan:{' '}
          {home.data.access.pro
            ? `Pro${home.data.access.validUntil ? ` until ${new Date(home.data.access.validUntil).toLocaleDateString()}` : ''}`
            : 'Free (daily challenge and basic progress)'}
        </Body>
        {billing.data?.billingEnabled && !home.data.access.pro && (
          <Button label="Unlock Pro for this child" onPress={() => setSensitive('purchase')} />
        )}
        {billing.data?.billingEnabled && (
          <Button
            label="Restore purchases"
            kind="secondary"
            onPress={() =>
              void act(async () => {
                await api.request('POST', '/v1/billing/restore', { body: {} });
                await home.refresh();
                setMessage('Purchases checked.');
              })
            }
          />
        )}
        {home.data.access.pro && (
          <Button
            label="Manage subscription"
            kind="secondary"
            onPress={() => void Linking.openURL('https://apps.apple.com/account/subscriptions')}
          />
        )}
      </Card>

      <Card>
        <Body>Your data</Body>
        <Button label="Export data" kind="secondary" onPress={() => setSensitive('export')} />
        <Button
          label={`Delete ${s.nickname}'s profile`}
          kind="danger"
          onPress={() => setSensitive('delete')}
        />
      </Card>

      {sensitive && (
        <Reauth
          action={sensitive === 'delete' ? 'delete_student' : sensitive}
          targetId={id}
          title={
            sensitive === 'delete'
              ? `Delete ${s.nickname}'s profile and history`
              : sensitive === 'export'
                ? 'Export practice data'
                : 'Unlock Pro'
          }
          onCancel={() => setSensitive(null)}
          onGrant={async (grant) => {
            if (sensitive === 'export') {
              const r = await api.request<{ exportId: string }>('POST', '/v1/exports', {
                body: { studentId: id },
                adultGrant: grant,
              });
              setMessage(
                `Export requested (${r.exportId.slice(0, 8)}). Check back shortly for the download link.`,
              );
            } else if (sensitive === 'delete') {
              const r = await api.request<{ notice: string }>('POST', '/v1/deletion-requests', {
                body: { scope: 'student', studentId: id },
                adultGrant: grant,
              });
              setMessage(r.notice);
              router.replace('/parent');
            } else {
              const intent = await api.request<{ billingCustomerId: string; productId: string }>(
                'POST',
                '/v1/billing/purchase-intents',
                {
                  body: { studentId: id, productId: 'imc_pro_monthly' },
                  adultGrant: grant,
                },
              );
              await purchase(api, intent);
              await api.request('POST', '/v1/billing/restore', { body: {} });
              await home.refresh();
              setMessage('Purchase verified.');
            }
            setSensitive(null);
          }}
        />
      )}
      <Button label="Back" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
