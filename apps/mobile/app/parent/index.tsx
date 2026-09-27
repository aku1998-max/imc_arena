import type { StudentProfile } from '@imc/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { PolicyLinks } from '../../src/components/PolicyLinks';
import { Reauth } from '../../src/components/Reauth';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { useQuery } from '../../src/hooks';
import { useSession } from '../../src/session';

export default function ParentHome() {
  const { api, signOut } = useSession();
  const { data, error, loading } = useQuery<{ students: StudentProfile[] }>('/v1/students');
  const me = useQuery<{ account?: { id: string } }>('/v1/me');
  const [deleting, setDeleting] = useState(false);
  const accountId = me.data?.account?.id;

  return (
    <Screen>
      <Title>Your children</Title>
      <ErrorText message={error} />
      {loading && <Loading />}
      {data?.students.length === 0 && (
        <Card>
          <Body>Create a profile to start. We only ask for a nickname, grade and timezone.</Body>
        </Card>
      )}
      {data?.students.map((s) => (
        <Card key={s.id}>
          <Body>
            {s.nickname} · Grade {s.grade}
          </Body>
          <Button
            label={`Open ${s.nickname}`}
            onPress={() => router.push(`/parent/child/${s.id}`)}
          />
        </Card>
      ))}
      <Button
        label="Add a child"
        kind="secondary"
        onPress={() => router.push('/parent/new-child')}
      />
      <Button
        label="Sign out"
        kind="secondary"
        onPress={() => void signOut().then(() => router.replace('/welcome'))}
      />
      {accountId && !deleting && (
        <Button
          label="Delete my account"
          kind="quiet"
          hint="Deletes your account, all child profiles and their practice history"
          onPress={() => setDeleting(true)}
        />
      )}
      {accountId && deleting && (
        <Reauth
          action="delete_account"
          targetId={accountId}
          title="Delete your account, all child profiles and their practice history. A store subscription is not cancelled automatically: cancel it in your Apple or Google account."
          onCancel={() => setDeleting(false)}
          onGrant={async (grant) => {
            await api.request('POST', '/v1/deletion-requests', {
              body: { scope: 'account', accountId },
              adultGrant: grant,
            });
            setDeleting(false);
            await signOut();
            router.replace('/welcome');
          }}
        />
      )}
      <PolicyLinks />
    </Screen>
  );
}
