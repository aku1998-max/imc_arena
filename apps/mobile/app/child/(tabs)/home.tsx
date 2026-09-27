import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { startSession } from '../../../src/child/start';
import { Mascot } from '../../../src/components/Mascot';
import {
  Body,
  Button,
  Card,
  ErrorText,
  Eyebrow,
  Loading,
  ProgressBar,
  Screen,
  StickerCard,
  Title,
  TopicBadge,
} from '../../../src/components/ui';
import { useQuery } from '../../../src/hooks';
import { friendlyMessage } from '../../../src/lib/api-client';
import { lastNDays } from '../../../src/lib/dates';
import { useSession } from '../../../src/session';
import { colors, fonts, radius, spacing } from '../../../src/theme';
import { topicStyle } from '../../../src/topics';

interface Home {
  student: { nickname: string; grade: number };
  daily: { status: 'not_started' | 'in_progress' | 'completed'; sessionId: string | null };
  activeSessions: Array<{
    sessionId: string;
    mode: string;
    topic: { slug: string } | null;
    answeredCount: number;
    itemCount: number;
  }>;
  suggestedTopic: { id: string; slug: string } | null;
  weeklyGoal: { target: number; completed: number };
}
interface Progress {
  topics: Array<{ slug: string; firstAttemptCount: number; firstAttemptCorrect: number }>;
}
interface Mistakes {
  items: unknown[];
}

export default function ChildHome() {
  const { api, studentId, newIdempotencyKey, pending } = useSession();
  const week = lastNDays(7);
  const home = useQuery<Home>(studentId ? `/v1/students/${studentId}/home` : null);
  const progress = useQuery<Progress>(
    studentId ? `/v1/students/${studentId}/progress?from=${week.from}&to=${week.to}` : null,
  );
  const mistakes = useQuery<Mistakes>(
    studentId ? `/v1/students/${studentId}/mistakes?limit=50` : null,
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Resolve any answer queued while offline before showing fresh state.
      void pending?.flush(api).finally(() => {
        void home.refresh();
        void progress.refresh();
        void mistakes.refresh();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending, api]),
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

  const data = home.data;
  if (!data) {
    return (
      <Screen>
        <ErrorText message={home.error} />
        {home.loading && <Loading />}
      </Screen>
    );
  }
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const topics = (progress.data?.topics ?? []).filter((t) => t.firstAttemptCount > 0).slice(0, 4);
  const mistakeCount = mistakes.data?.items.length ?? 0;
  const resumable = data.activeSessions.filter((s) => s.mode !== 'daily');

  return (
    <Screen>
      <View style={s.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Body muted size="small">
            {today}
          </Body>
          <Title>Hi {data.student.nickname}</Title>
        </View>
        <Mascot pose="cheer" height={96} decorative />
      </View>

      <StickerCard>
        <View style={s.rowBetween}>
          <Eyebrow>Today</Eyebrow>
          <Body muted size="small">
            about 6 min
          </Body>
        </View>
        {data.daily.status === 'completed' ? (
          <>
            <Text style={s.cardTitle}>Daily challenge done</Text>
            <View style={s.row}>
              <Feather name="check-circle" size={20} color={colors.brand} />
              <Body>Come back tomorrow for 5 new questions.</Body>
            </View>
          </>
        ) : (
          <>
            <Text style={s.cardTitle}>
              Daily challenge: <Text style={s.marker}> 5 questions </Text>
            </Text>
            <Body muted size="small">
              2 easy · 2 medium · 1 harder, from Grade {data.student.grade} topics
            </Body>
            <Button
              label={data.daily.status === 'in_progress' ? 'Continue' : 'Start'}
              icon="arrow-right"
              disabled={starting}
              onPress={() => void startDaily()}
            />
          </>
        )}
        <ErrorText message={startError} />
      </StickerCard>

      {resumable.map((r) => (
        <Pressable
          key={r.sessionId}
          accessibilityRole="button"
          accessibilityLabel={`Resume ${r.mode === 'topic' ? topicStyle(r.topic?.slug).name : 'mistake review'}, ${r.answeredCount} of ${r.itemCount} answered`}
          onPress={() => router.push(`/child/session/${r.sessionId}`)}
          style={s.resume}
        >
          <TopicBadge slug={r.topic?.slug ?? null} />
          <View style={{ flex: 1 }}>
            <Body weight="medium">
              Resume {r.mode === 'topic' ? topicStyle(r.topic?.slug).name : 'mistake review'}
            </Body>
            <Body muted size="small">
              {r.answeredCount} of {r.itemCount} answered
            </Body>
          </View>
          <Feather name="chevron-right" size={22} color={colors.inkMuted} />
        </Pressable>
      ))}

      <View style={{ gap: spacing.sm }}>
        <View style={s.rowBetween}>
          <Body weight="semibold">This week</Body>
          <Body muted size="small">
            {Math.min(data.weeklyGoal.completed, data.weeklyGoal.target)} of{' '}
            {data.weeklyGoal.target} sessions
          </Body>
        </View>
        <ProgressBar value={data.weeklyGoal.completed / data.weeklyGoal.target} />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Body weight="semibold">Topics this week</Body>
        {topics.length === 0 ? (
          <Card style={{ borderWidth: 1, borderColor: colors.border }}>
            <Body muted>
              Your topics appear here after your first challenge.
              {data.suggestedTopic ? ` Try ${topicStyle(data.suggestedTopic.slug).name} next.` : ''}
            </Body>
          </Card>
        ) : (
          <View style={s.list}>
            {topics.map((t, i) => (
              <View key={t.slug} style={[s.listRow, i < topics.length - 1 && s.listDivider]}>
                <TopicBadge slug={t.slug} />
                <Body weight="medium">{topicStyle(t.slug).name}</Body>
                <View style={{ flex: 1 }} />
                <Text style={s.fraction}>
                  {t.firstAttemptCorrect}/{t.firstAttemptCount}
                </Text>
                <View style={{ width: 64 }}>
                  <ProgressBar
                    value={t.firstAttemptCorrect / t.firstAttemptCount}
                    color={
                      t.firstAttemptCorrect / t.firstAttemptCount >= 0.6
                        ? colors.brand
                        : colors.incorrect
                    }
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {mistakeCount > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${mistakeCount} questions to try again. Review`}
          onPress={() => router.navigate('/child/mistakes')}
          style={s.mistakes}
        >
          <Feather name="rotate-ccw" size={20} color={colors.incorrect} />
          <Body weight="medium">
            {mistakeCount} {mistakeCount === 1 ? 'question' : 'questions'} to try again
          </Body>
          <View style={{ flex: 1 }} />
          <Text style={s.review}>Review</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: -spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, color: colors.ink },
  marker: { backgroundColor: colors.marker },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 64,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    paddingHorizontal: 14,
    minHeight: 54,
  },
  listDivider: { borderBottomWidth: 1, borderBottomColor: colors.gridLine },
  fraction: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  mistakes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.incorrect,
    backgroundColor: colors.surface,
  },
  review: { fontFamily: fonts.semibold, color: colors.incorrect, fontSize: 15 },
});
