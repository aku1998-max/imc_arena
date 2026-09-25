import type { StudentProfile } from '@imc/contracts';
import { router } from 'expo-router';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { useQuery } from '../../src/hooks';
import { useSession } from '../../src/session';

export default function ParentHome() {
  const { signOut } = useSession();
  const { data, error, loading } = useQuery<{ students: StudentProfile[] }>('/v1/students');
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
    </Screen>
  );
}
