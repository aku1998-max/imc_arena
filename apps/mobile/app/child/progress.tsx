import { useState } from 'react';
import { View } from 'react-native';
import { ChildNav } from '../../src/child/ChildNav';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { useQuery } from '../../src/hooks';
import { lastNDays } from '../../src/lib/dates';
import { useSession } from '../../src/session';

interface Progress {
  completedSessions: number;
  questionsAnswered: number;
  firstAttempts: { count: number; correct: number };
  retries: { count: number; correct: number };
  topics: Array<{
    slug: string;
    firstAttemptCount: number;
    firstAttemptCorrect: number;
    retryCount: number;
  }>;
  sufficientData: boolean;
  historyLimited: boolean;
}

export default function ProgressScreen() {
  const { studentId } = useSession();
  const [days, setDays] = useState(7);
  const range = lastNDays(days);
  const { data, error, loading } = useQuery<Progress>(
    studentId ? `/v1/students/${studentId}/progress?from=${range.from}&to=${range.to}` : null,
  );
  return (
    <Screen>
      <Title>My progress</Title>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[7, 30].map((d) => (
          <View key={d} style={{ flex: 1 }}>
            <Button
              label={`Last ${d} days${days === d ? ' ✓' : ''}`}
              kind={days === d ? 'primary' : 'secondary'}
              onPress={() => setDays(d)}
            />
          </View>
        ))}
      </View>
      <ErrorText message={error} />
      {loading && <Loading />}
      {data && (
        <>
          <Card>
            <Body>Sessions finished: {data.completedSessions}</Body>
            <Body>Questions answered: {data.questionsAnswered}</Body>
            {data.sufficientData ? (
              <Body>
                Right on the first try: {data.firstAttempts.correct} of {data.firstAttempts.count}
              </Body>
            ) : (
              <Body muted>Answer a few more questions to see your first-try score.</Body>
            )}
            <Body muted>
              Retries: {data.retries.correct} of {data.retries.count} correct
            </Body>
            {data.historyLimited && <Body muted>Longer history is part of the full plan.</Body>}
          </Card>
          {data.topics.map((t) => (
            <Card key={t.slug}>
              <Body>{t.slug}</Body>
              <Body muted>
                First tries: {t.firstAttemptCorrect} of {t.firstAttemptCount} · Retries:{' '}
                {t.retryCount}
              </Body>
            </Card>
          ))}
        </>
      )}
      <ChildNav />
    </Screen>
  );
}
