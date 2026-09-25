import { router } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { useQuery } from '../../src/hooks';
import { friendlyMessage } from '../../src/lib/api-client';
import { useSession } from '../../src/session';
import { ChildNav } from '../../src/child/ChildNav';
import { startSession } from '../../src/child/start';

interface Me {
  capabilities: string[];
  student: { grade: number };
}
interface Topics {
  topics: Array<{ id: string; slug: string; inventory: 'ready' | 'limited' | 'unavailable' }>;
}

export default function Practice() {
  const { api, studentId, newIdempotencyKey } = useSession();
  const me = useQuery<Me>('/v1/me');
  const topics = useQuery<Topics>(me.data ? `/v1/topics?grade=${me.data.student.grade}` : null);
  const [error, setError] = useState<string | null>(null);
  const canTopic = me.data?.capabilities.includes('practice:topic') ?? false;

  const start = async (topicId: string) => {
    if (!studentId) return;
    setError(null);
    try {
      const r = await startSession(api, studentId, newIdempotencyKey(), { mode: 'topic', topicId });
      if (r.status === 'ready') router.push(`/child/session/${r.sessionId}`);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  return (
    <Screen>
      <Title>Practice by topic</Title>
      {!canTopic && me.data && (
        <Card>
          <Body>
            Topic practice is part of the full plan. Ask a parent — your daily challenge is always
            free.
          </Body>
        </Card>
      )}
      <ErrorText message={error ?? topics.error ?? me.error} />
      {topics.loading && <Loading />}
      {topics.data?.topics.map((t) => (
        <Card key={t.id}>
          <Body>{t.slug}</Body>
          {t.inventory === 'unavailable' ? (
            <Body muted>Coming soon</Body>
          ) : (
            <Button
              label={`Practise ${t.slug}`}
              disabled={!canTopic}
              onPress={() => void start(t.id)}
            />
          )}
        </Card>
      ))}
      <ChildNav />
    </Screen>
  );
}
