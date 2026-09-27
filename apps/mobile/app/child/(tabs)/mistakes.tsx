import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { startSession } from '../../../src/child/start';
import { Mascot } from '../../../src/components/Mascot';
import {
  Body,
  Button,
  ErrorText,
  Loading,
  Note,
  Screen,
  StickerCard,
  Title,
  TopicBadge,
} from '../../../src/components/ui';
import { useQuery } from '../../../src/hooks';
import { friendlyMessage } from '../../../src/lib/api-client';
import { useSession } from '../../../src/session';
import { colors, fonts, radius, spacing } from '../../../src/theme';
import { topicStyle } from '../../../src/topics';

interface Mistakes {
  items: Array<{ questionId: string; topic: { slug: string }; dueAt: string }>;
  nextCursor: string | null;
}

export default function MistakesScreen() {
  const { api, studentId, newIdempotencyKey } = useSession();
  const mistakes = useQuery<Mistakes>(
    studentId ? `/v1/students/${studentId}/mistakes?limit=50` : null,
  );
  const me = useQuery<{ capabilities: string[] }>('/v1/me');
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const canRetry = me.data?.capabilities.includes('practice:mistakes') ?? false;

  useFocusEffect(
    useCallback(() => {
      void mistakes.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const retry = async () => {
    if (!studentId) return;
    setStartError(null);
    setStarting(true);
    try {
      const r = await startSession(api, studentId, newIdempotencyKey(), { mode: 'mistakes' });
      if (r.status === 'ready') router.push(`/child/session/${r.sessionId}`);
      else setStartError('No mistakes to review right now.');
    } catch (e) {
      setStartError(friendlyMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const { data, error, loading } = mistakes;
  const byTopic = new Map<string, number>();
  for (const m of data?.items ?? [])
    byTopic.set(m.topic.slug, (byTopic.get(m.topic.slug) ?? 0) + 1);
  const total = data?.items.length ?? 0;

  return (
    <Screen>
      <Title>Try again</Title>
      <ErrorText message={error ?? startError} />
      {loading && !data && <Loading />}
      {data && total === 0 && (
        <View style={s.empty}>
          <Mascot pose="cheer" height={150} />
          <Text style={s.emptyTitle}>Nothing to review</Text>
          <Body muted>Questions you miss show up here so you can try them again later.</Body>
        </View>
      )}
      {data && total > 0 && (
        <>
          <StickerCard>
            <View style={s.hero}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.count}>{total}</Text>
                <Body weight="medium">{total === 1 ? 'question' : 'questions'} to try again</Body>
              </View>
              <Mascot pose="think" height={92} decorative />
            </View>
            {canRetry ? (
              <Button
                label="Retry my mistakes"
                icon="rotate-ccw"
                disabled={starting}
                onPress={() => void retry()}
              />
            ) : (
              <Note>
                <Body size="small">
                  Retrying mistakes is part of the full plan. You can still read the explanations
                  after each daily challenge.
                </Body>
              </Note>
            )}
          </StickerCard>
          <View style={s.list}>
            {[...byTopic.entries()].map(([slug, n], i, all) => (
              <View key={slug} style={[s.row, i < all.length - 1 && s.divider]}>
                <TopicBadge slug={slug} />
                <Body weight="medium">{topicStyle(slug).name}</Body>
                <View style={{ flex: 1 }} />
                <Body muted size="small">
                  {n} to retry
                </Body>
              </View>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { fontFamily: fonts.bold, fontSize: 44, lineHeight: 50, color: colors.incorrect },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    paddingHorizontal: 14,
    minHeight: 54,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.gridLine },
});
