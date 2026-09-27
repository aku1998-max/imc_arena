import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { startSession } from '../../../src/child/start';
import {
  Body,
  ErrorText,
  Eyebrow,
  Loading,
  Note,
  Screen,
  Title,
  TopicBadge,
} from '../../../src/components/ui';
import { useQuery } from '../../../src/hooks';
import { friendlyMessage } from '../../../src/lib/api-client';
import { useSession } from '../../../src/session';
import { colors, radius, spacing } from '../../../src/theme';
import { topicStyle } from '../../../src/topics';

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
  const [starting, setStarting] = useState<string | null>(null);
  const canTopic = me.data?.capabilities.includes('practice:topic') ?? false;

  const start = async (topicId: string) => {
    if (!studentId) return;
    setError(null);
    setStarting(topicId);
    try {
      const r = await startSession(api, studentId, newIdempotencyKey(), { mode: 'topic', topicId });
      if (r.status === 'ready') router.push(`/child/session/${r.sessionId}`);
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setStarting(null);
    }
  };

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <Eyebrow>Grade {me.data?.student.grade ?? ''}</Eyebrow>
        <Title>Practice a topic</Title>
      </View>
      {!canTopic && me.data && (
        <Note>
          <Body weight="medium">Topic practice is part of the full plan.</Body>
          <Body size="small">Ask a parent. Your daily challenge is always free.</Body>
        </Note>
      )}
      <ErrorText message={error ?? topics.error ?? me.error} />
      {topics.loading && <Loading />}
      <View style={s.grid}>
        {topics.data?.topics.map((t) => {
          const style = topicStyle(t.slug);
          const unavailable = t.inventory === 'unavailable';
          const disabled = unavailable || !canTopic || starting !== null;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Practise ${style.name}${unavailable ? ', coming soon' : ''}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => void start(t.id)}
              style={({ pressed }) => [
                s.tile,
                { borderColor: unavailable ? colors.border : colors.ink },
                pressed && { backgroundColor: style.soft },
                (unavailable || !canTopic) && { opacity: 0.55 },
              ]}
            >
              <TopicBadge slug={t.slug} />
              <Body weight="semibold">{style.name}</Body>
              <View style={s.tileFoot}>
                <Body muted size="small">
                  {unavailable
                    ? 'Coming soon'
                    : t.inventory === 'limited'
                      ? 'A few questions'
                      : '5 questions'}
                </Body>
                {!unavailable && canTopic && (
                  <Feather
                    name={starting === t.id ? 'loader' : 'arrow-right'}
                    size={18}
                    color={style.ink}
                  />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 4 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 124,
    padding: spacing.md - 2,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  tileFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
});
