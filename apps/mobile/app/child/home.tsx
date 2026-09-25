import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { useQuery } from '../../src/hooks';
import { friendlyMessage } from '../../src/lib/api-client';
import { useSession } from '../../src/session';
import { ChildNav } from '../../src/child/ChildNav';
import { startSession } from '../../src/child/start';

interface Home {
  student: { nickname: string; grade: number };
  daily: { status: 'not_started' | 'in_progress' | 'completed'; sessionId: string | null };
  activeSessions: Array<{
    sessionId: string;
    mode: string;
    topic: { displayKey: string; slug: string } | null;
    answeredCount: number;
    itemCount: number;
  }>;
  suggestedTopic: { id: string; slug: string } | null;
  recentActivity: Array<{
    sessionId: string;
    mode: string;
    correctCount: number;
    itemCount: number;
    completedAt: string;
  }>;
  weeklyGoal: { target: number; completed: number };
  access: { pro: boolean };
}

export default function ChildHome() {
  const { api, studentId, newIdempotencyKey, pending } = useSession();
  const { data, error, loading, refresh } = useQuery<Home>(
    studentId ? `/v1/students/${studentId}/home` : null,
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Resolve any answer queued while offline before showing fresh state.
      void pending?.flush(api).finally(() => void refresh());
    }, [pending, api, refresh]),
  );

  const startDaily = async () => {
    if (!studentId) return;
    setStarting(true);
    setStartError(null);
    try {
      const r = await startSession(api, studentId, newIdempotencyKey(), { mode: 'daily' });
      if (r.status === 'ready') router.push(`/child/session/${r.sessionId}`);
    } catch (e) {
      setStartError(friendlyMessage(e));
    } finally {
      setStarting(false);
    }
  };

  if (!data) {
    return (
      <Screen>
        <ErrorText message={error} />
        {loading && <Loading />}
      </Screen>
    );
  }
  return (
    <Screen>
      <Title>Hi {data.student.nickname}!</Title>
      <Card>
        <Body>Daily challenge · 5 questions</Body>
        {data.daily.status === 'completed' ? (
          <Body>✓ Done for today. Come back tomorrow!</Body>
        ) : (
          <Button
            label={
              data.daily.status === 'in_progress'
                ? 'Continue daily challenge'
                : 'Start daily challenge'
            }
            disabled={starting}
            onPress={() => void startDaily()}
          />
        )}
        <ErrorText message={startError} />
      </Card>
      {data.activeSessions
        .filter((s) => s.mode !== 'daily')
        .map((s) => (
          <Card key={s.sessionId}>
            <Body>
              Resume {s.mode === 'topic' ? s.topic?.slug : 'mistake review'} · {s.answeredCount}/
              {s.itemCount}
            </Body>
            <Button label="Resume" onPress={() => router.push(`/child/session/${s.sessionId}`)} />
          </Card>
        ))}
      <Card>
        <Body>
          This week: {data.weeklyGoal.completed} of {data.weeklyGoal.target} practice sessions
        </Body>
        {data.suggestedTopic && <Body muted>Next topic idea: {data.suggestedTopic.slug}</Body>}
      </Card>
      {data.recentActivity.length > 0 && (
        <Card>
          <Body>Recent</Body>
          {data.recentActivity.map((a) => (
            <Body key={a.sessionId} muted>
              {a.mode}: {a.correctCount} of {a.itemCount} correct
            </Body>
          ))}
        </Card>
      )}
      <ChildNav />
    </Screen>
  );
}
