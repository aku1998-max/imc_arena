import { router } from 'expo-router';
import { useState } from 'react';
import { ChildNav } from '../../src/child/ChildNav';
import { startSession } from '../../src/child/start';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { useQuery } from '../../src/hooks';
import { friendlyMessage } from '../../src/lib/api-client';
import { useSession } from '../../src/session';

interface Mistakes {
  items: Array<{ questionId: string; topic: { slug: string }; dueAt: string }>;
  nextCursor: string | null;
}

export default function MistakesScreen() {
  const { api, studentId, newIdempotencyKey } = useSession();
  const { data, error, loading } = useQuery<Mistakes>(
    studentId ? `/v1/students/${studentId}/mistakes?limit=50` : null,
  );
  const me = useQuery<{ capabilities: string[] }>('/v1/me');
  const [startError, setStartError] = useState<string | null>(null);
  const canRetry = me.data?.capabilities.includes('practice:mistakes') ?? false;

  const retry = async () => {
    if (!studentId) return;
    setStartError(null);
    try {
      const r = await startSession(api, studentId, newIdempotencyKey(), { mode: 'mistakes' });
      if (r.status === 'ready') router.push(`/child/session/${r.sessionId}`);
      else setStartError('No mistakes to review right now.');
    } catch (e) {
      setStartError(friendlyMessage(e));
    }
  };

  const byTopic = new Map<string, number>();
  for (const m of data?.items ?? [])
    byTopic.set(m.topic.slug, (byTopic.get(m.topic.slug) ?? 0) + 1);

  return (
    <Screen>
      <Title>Mistakes to review</Title>
      <ErrorText message={error ?? startError} />
      {loading && <Loading />}
      {data && data.items.length === 0 && (
        <Card>
          <Body>🎉 Nothing to review. Great work!</Body>
        </Card>
      )}
      {data && data.items.length > 0 && (
        <Card>
          {[...byTopic.entries()].map(([slug, n]) => (
            <Body key={slug}>
              {slug}: {n} to retry
            </Body>
          ))}
          {canRetry ? (
            <Button label="Retry my mistakes" onPress={() => void retry()} />
          ) : (
            <Body muted>
              Retrying mistakes is part of the full plan. You can still see the explanations after
              each daily challenge.
            </Body>
          )}
        </Card>
      )}
      <ChildNav />
    </Screen>
  );
}
