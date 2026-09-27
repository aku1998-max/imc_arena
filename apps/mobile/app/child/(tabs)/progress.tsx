import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Body,
  ErrorText,
  Loading,
  Note,
  ProgressBar,
  Screen,
  Title,
  TopicBadge,
} from '../../../src/components/ui';
import { useQuery } from '../../../src/hooks';
import { lastNDays } from '../../../src/lib/dates';
import { useSession } from '../../../src/session';
import { colors, fonts, minTouchTarget, radius, spacing } from '../../../src/theme';
import { topicStyle } from '../../../src/topics';

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

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={s.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={s.statValue}>{value}</Text>
      <Body muted size="small">
        {label}
      </Body>
    </View>
  );
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
      <View style={s.segment} accessibilityRole="tablist">
        {[7, 30].map((d) => {
          const active = days === d;
          return (
            <Pressable
              key={d}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setDays(d)}
              style={[s.segmentItem, active && s.segmentActive]}
            >
              <Text style={[s.segmentText, active && { color: colors.surface }]}>
                Last {d} days
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ErrorText message={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <View style={s.stats}>
            <Stat value={data.completedSessions} label="Sessions" />
            <Stat value={data.questionsAnswered} label="Questions" />
            <Stat
              value={
                data.sufficientData
                  ? `${data.firstAttempts.correct}/${data.firstAttempts.count}`
                  : '–'
              }
              label="First try"
            />
          </View>
          {!data.sufficientData && (
            <Body muted size="small">
              Answer a few more questions to see your first-try score.
            </Body>
          )}
          {data.retries.count > 0 && (
            <Body muted size="small">
              Retries: {data.retries.correct} of {data.retries.count} right
            </Body>
          )}

          {data.topics.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Body weight="semibold">By topic</Body>
              <View style={s.list}>
                {data.topics.map((t, i) => {
                  const ratio = t.firstAttemptCount
                    ? t.firstAttemptCorrect / t.firstAttemptCount
                    : 0;
                  return (
                    <View key={t.slug} style={[s.row, i < data.topics.length - 1 && s.divider]}>
                      <TopicBadge slug={t.slug} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <View style={s.rowBetween}>
                          <Body weight="medium">{topicStyle(t.slug).name}</Body>
                          <Text style={s.fraction}>
                            {t.firstAttemptCorrect}/{t.firstAttemptCount}
                          </Text>
                        </View>
                        <ProgressBar
                          value={ratio}
                          color={ratio >= 0.6 ? colors.brand : colors.incorrect}
                        />
                        {t.retryCount > 0 && (
                          <Body muted size="small">
                            {t.retryCount} {t.retryCount === 1 ? 'retry' : 'retries'}
                          </Body>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
          {data.historyLimited && (
            <Note>
              <Body size="small">Longer history is part of the full plan.</Body>
            </Note>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: minTouchTarget - 4,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.ink,
    padding: spacing.md - 4,
    gap: 2,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
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
    paddingVertical: 12,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.gridLine },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fraction: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
});
