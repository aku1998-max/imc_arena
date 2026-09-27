import { Feather } from '@expo/vector-icons';
import type { AnsweredItem, ContentBlock, QuestionOption, UnansweredItem } from '@imc/contracts';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Blocks, OptionContent, optionAccessibleText } from '../../../src/components/Blocks';
import { Mascot } from '../../../src/components/Mascot';
import {
  Body,
  Button,
  Card,
  ErrorText,
  Eyebrow,
  Loading,
  Note,
  Screen,
  StickerCard,
  Title,
} from '../../../src/components/ui';
import { friendlyMessage } from '../../../src/lib/api-client';
import { useSession } from '../../../src/session';
import { colors, fonts, minTouchTarget, radius, spacing } from '../../../src/theme';

interface ItemState {
  itemId: string;
  ordinal: number;
  answered: boolean;
  correct: boolean | null;
}
interface SessionState {
  sessionId: string;
  mode: 'daily' | 'topic' | 'mistakes';
  status: 'active' | 'completed' | 'abandoned';
  items: ItemState[];
  nextItemId: string | null;
  completion: {
    correctCount: number;
    itemCount: number;
    rewards: Array<{ type: string; value: number }>;
  } | null;
}
interface AnswerResult {
  attemptId: string;
  correct: boolean;
  correctOptionId: string;
  explanationBlocks: ContentBlock[];
  assets: Record<string, { url: string }>;
  nextItemId: string | null;
  completion: SessionState['completion'];
}
interface SummaryRow {
  itemId: string;
  label: string;
  correct: boolean;
}
type Phase =
  | { kind: 'loading' }
  | { kind: 'question'; item: UnansweredItem }
  | { kind: 'submitting'; item: UnansweredItem }
  | { kind: 'waiting'; item: UnansweredItem }
  | {
      kind: 'feedback';
      item: UnansweredItem | AnsweredItem;
      result: AnswerResult;
      selected: string;
    }
  | { kind: 'summary'; completion: NonNullable<SessionState['completion']>; rows: SummaryRow[] }
  | { kind: 'ended' };

const MODE_LABEL: Record<SessionState['mode'], string> = {
  daily: 'Daily challenge',
  topic: 'Topic practice',
  mistakes: 'Mistake review',
};

function stemPreview(blocks: ContentBlock[]): string {
  const text = blocks.find((b) => b.type === 'text');
  const s = text && text.type === 'text' ? text.text : 'Question';
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
}

export default function SessionPlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, pending, newIdempotencyKey } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [mode, setMode] = useState<SessionState['mode']>('daily');
  const [items, setItems] = useState<ItemState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const shownAt = useRef(Date.now());
  const keyForItem = useRef<{ itemId: string; key: string } | null>(null);

  const showItem = useCallback(
    async (itemId: string) => {
      const item = await api.request<UnansweredItem | AnsweredItem>(
        'GET',
        `/v1/sessions/${id}/items/${itemId}`,
      );
      setReported(false);
      if (item.answered) {
        setPhase({
          kind: 'feedback',
          item,
          selected: item.selectedOptionId,
          result: {
            attemptId: '',
            correct: item.correct,
            correctOptionId: item.correctOptionId,
            explanationBlocks: item.explanationBlocks,
            assets: item.assets,
            nextItemId: null,
            completion: null,
          },
        });
        return;
      }
      shownAt.current = Date.now();
      setSelected(null);
      setPhase({ kind: 'question', item });
    },
    [api, id],
  );

  const showSummary = useCallback(
    async (completion: NonNullable<SessionState['completion']>) => {
      const s = await api.request<SessionState>('GET', `/v1/sessions/${id}`);
      const rows = await Promise.all(
        s.items.map(async (it) => {
          const item = await api.request<UnansweredItem | AnsweredItem>(
            'GET',
            `/v1/sessions/${id}/items/${it.itemId}`,
          );
          return {
            itemId: it.itemId,
            label: stemPreview(item.stemBlocks),
            correct: it.correct === true,
          };
        }),
      );
      setPhase({ kind: 'summary', completion, rows });
    },
    [api, id],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      // Resume: resolve a queued submission before permitting another answer.
      const flushed = pending ? await pending.flush<AnswerResult>(api) : null;
      if (flushed?.kind === 'waiting') {
        setError('Waiting to sync your last answer…');
        return;
      }
      const s = await api.request<SessionState>('GET', `/v1/sessions/${id}`);
      setMode(s.mode);
      setItems(s.items);
      if (s.status === 'completed' && s.completion) return showSummary(s.completion);
      if (s.status !== 'active' || !s.nextItemId) return setPhase({ kind: 'ended' });
      await showItem(s.nextItemId);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  }, [api, id, pending, showItem, showSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (item: UnansweredItem) => {
    if (!selected || !pending || phase.kind === 'submitting') return; // no double submit
    if (!keyForItem.current || keyForItem.current.itemId !== item.itemId) {
      keyForItem.current = { itemId: item.itemId, key: newIdempotencyKey() };
    }
    setPhase({ kind: 'submitting', item });
    setError(null);
    const outcome = await pending.submit<AnswerResult>(api, {
      sessionId: id,
      itemId: item.itemId,
      optionId: selected,
      idempotencyKey: keyForItem.current.key,
      responseMs: Date.now() - shownAt.current,
      queuedAt: new Date().toISOString(),
    });
    if (outcome.kind === 'graded') {
      void Haptics.notificationAsync(
        outcome.result.correct
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
      setItems((prev) =>
        prev.map((x) =>
          x.itemId === item.itemId ? { ...x, answered: true, correct: outcome.result.correct } : x,
        ),
      );
      setPhase({ kind: 'feedback', item, result: outcome.result, selected });
    } else if (outcome.kind === 'waiting') {
      // Never grade offline: keep the selection and show that it is waiting.
      setPhase({ kind: 'waiting', item });
    } else if (outcome.kind === 'conflict') {
      await showItem(item.itemId);
    } else {
      setError(friendlyMessage(outcome.error));
      setPhase({ kind: 'question', item });
    }
  };

  const next = async (result: AnswerResult) => {
    try {
      if (result.completion) return await showSummary(result.completion);
      if (result.nextItemId) return await showItem(result.nextItemId);
      return await load();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  const report = async (itemId: string) => {
    try {
      await api.request('POST', '/v1/reports', { body: { category: 'unclear_question', itemId } });
      setReported(true);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  const leave = (to: '/child/home' | '/child/mistakes' = '/child/home') => router.dismissTo(to);

  if (phase.kind === 'loading') {
    return (
      <Screen>
        <ErrorText message={error} />
        {error ? <Button label="Try again" onPress={() => void load()} /> : <Loading />}
      </Screen>
    );
  }

  if (phase.kind === 'summary') {
    const { correctCount, itemCount, rewards } = phase.completion;
    const points = rewards.reduce((n, r) => n + r.value, 0);
    const perfect = rewards.some((r) => r.type === 'perfect_session');
    const hasMistake = phase.rows.some((r) => !r.correct);
    return (
      <Screen
        footer={
          <>
            <Button label="Back to home" onPress={() => leave()} />
            {hasMistake && (
              <Button
                label="Try my mistakes again"
                kind="secondary"
                onPress={() => leave('/child/mistakes')}
              />
            )}
          </>
        }
      >
        <View style={s.summaryHeader}>
          <View style={{ flex: 1, gap: 6 }}>
            <Eyebrow>{MODE_LABEL[mode]} · done</Eyebrow>
            <Title>
              {perfect
                ? 'Perfect round!'
                : correctCount >= itemCount / 2
                  ? 'Well done!'
                  : 'Good effort!'}
            </Title>
          </View>
          <Mascot
            pose={perfect || correctCount >= itemCount / 2 ? 'cheer' : 'think'}
            height={140}
            decorative
          />
        </View>
        <StickerCard>
          <View
            style={s.scoreRow}
            accessible
            accessibilityLabel={`${correctCount} out of ${itemCount} right`}
          >
            <Text style={s.score}>{correctCount}</Text>
            <Body muted size="large">
              out of {itemCount} right
            </Body>
          </View>
          <View>
            {phase.rows.map((r, i) => (
              <View
                key={r.itemId}
                style={[s.resultRow, i < phase.rows.length - 1 && s.divider]}
                accessible
                accessibilityLabel={`${r.label}: ${r.correct ? 'right' : 'to try again'}`}
              >
                <Feather
                  name={r.correct ? 'check' : 'x'}
                  size={18}
                  color={r.correct ? colors.correct : colors.incorrect}
                />
                <Text style={s.resultText} numberOfLines={1}>
                  {r.label}
                </Text>
                {!r.correct && <Text style={s.retryLater}>Retry later</Text>}
              </View>
            ))}
          </View>
          {points > 0 && (
            <View style={s.points}>
              <Feather name="star" size={18} color={colors.incorrectInk} />
              <Body size="small" weight="medium">
                +{points} points{perfect ? ' · perfect bonus included' : ''}
              </Body>
            </View>
          )}
        </StickerCard>
      </Screen>
    );
  }

  if (phase.kind === 'ended') {
    return (
      <Screen footer={<Button label="Back to home" onPress={() => leave()} />}>
        <Title>This session has ended</Title>
        <Body muted>
          A question in it was changed by our team, so it was closed. Your answers are saved.
        </Body>
      </Screen>
    );
  }

  const item = phase.item;
  const answered = phase.kind === 'feedback';
  const result = answered ? phase.result : null;
  const chosen = answered ? phase.selected : selected;
  const locked = answered || phase.kind === 'submitting' || phase.kind === 'waiting';

  const footer =
    phase.kind === 'feedback' && result ? (
      <>
        <View style={s.explainRow}>
          <Mascot
            pose={result.correct ? 'cheer' : 'think'}
            height={92}
            decorative
            style={{ marginBottom: -6 }}
          />
          <View style={{ flex: 1 }}>
            <Note>
              <Text
                style={[
                  s.noteLabel,
                  { color: result.correct ? colors.brandPressed : colors.incorrectInk },
                ]}
                accessibilityLiveRegion="polite"
              >
                {result.correct ? 'Correct! Here’s why' : 'Not quite. Here’s how'}
              </Text>
              <Blocks blocks={result.explanationBlocks} assets={result.assets} />
            </Note>
          </View>
        </View>
        <Button
          label={result.completion ? 'See results' : 'Next question'}
          icon="arrow-right"
          onPress={() => void next(result)}
        />
        {reported ? (
          <Body muted size="small">
            Thanks! Our team will check this question.
          </Body>
        ) : (
          <Button
            label="Report a problem with this question"
            kind="quiet"
            onPress={() => void report(item.itemId)}
          />
        )}
      </>
    ) : phase.kind === 'waiting' ? (
      <Note>
        <Body weight="medium">Waiting to sync</Body>
        <Body size="small">Your answer is saved and will be checked when you are back online.</Body>
        <Button label="Try again now" onPress={() => void submit(item as UnansweredItem)} />
      </Note>
    ) : (
      <Button
        label={phase.kind === 'submitting' ? 'Checking…' : 'Check answer'}
        disabled={!selected || phase.kind === 'submitting'}
        onPress={() => void submit(item as UnansweredItem)}
      />
    );

  return (
    <Screen footer={footer}>
      <View style={s.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Leave and come back later"
          onPress={() => leave()}
          style={s.close}
        >
          <Feather name="x" size={20} color={colors.ink} />
        </Pressable>
        <Text style={s.counter}>
          Question {item.ordinal} <Text style={s.counterMuted}>of {item.total}</Text>
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={s.counterMuted}>{MODE_LABEL[mode]}</Text>
      </View>
      <View
        style={s.segments}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {(items.length
          ? items
          : Array.from({ length: item.total }, (_, i) => ({
              itemId: String(i),
              ordinal: i + 1,
              answered: false,
              correct: null,
            }))
        ).map((x) => (
          <View
            key={x.itemId}
            style={[
              s.segment,
              x.answered && { backgroundColor: x.correct ? colors.correct : colors.incorrect },
              !x.answered && x.ordinal === item.ordinal && { backgroundColor: colors.ink },
            ]}
          />
        ))}
      </View>

      <Card>
        <Blocks blocks={item.stemBlocks} assets={item.assets} large />
      </Card>

      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm + 2 }}>
        {item.options.map((o: QuestionOption, i) => {
          const isChosen = chosen === o.id;
          const isKey = result?.correctOptionId === o.id;
          const wrongPick = !!result && isChosen && !isKey;
          const status = !result
            ? ''
            : isKey
              ? ' Correct answer.'
              : isChosen
                ? ' Your answer, not correct.'
                : '';
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: isChosen, disabled: locked }}
              accessibilityLabel={`Choice ${String.fromCharCode(65 + i)}: ${optionAccessibleText(o)}.${status}`}
              disabled={locked}
              onPress={() => {
                setSelected(o.id);
                void Haptics.selectionAsync().catch(() => undefined);
              }}
              style={[
                s.option,
                !result && isChosen && s.optionChosen,
                result && isKey && s.optionCorrect,
                wrongPick && s.optionWrong,
                result && !isKey && !isChosen && s.optionFaded,
              ]}
            >
              <Text style={s.letter}>{String.fromCharCode(65 + i)}</Text>
              <View style={{ flex: 1 }}>
                <OptionContent option={o} />
              </View>
              {/* Feedback never relies on colour alone: icon + words. */}
              {result && isKey && (
                <View style={s.mark}>
                  <Feather name="check" size={18} color={colors.brandPressed} />
                  <Text style={[s.markText, { color: colors.brandPressed }]}>Answer</Text>
                </View>
              )}
              {wrongPick && (
                <View style={s.mark}>
                  <Feather name="x" size={18} color={colors.incorrectInk} />
                  <Text style={[s.markText, { color: colors.incorrectInk }]}>Your pick</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <ErrorText message={error} />
    </Screen>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 4 },
  close: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  counterMuted: { fontFamily: fonts.regular, fontSize: 13, color: colors.inkMuted },
  segments: { flexDirection: 'row', gap: 6, marginTop: -4 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.gridLine },
  option: {
    minHeight: minTouchTarget + 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  optionChosen: { borderColor: colors.ink, borderWidth: 2, backgroundColor: colors.brandSoft },
  optionCorrect: {
    borderColor: colors.correct,
    borderWidth: 2,
    backgroundColor: colors.correctSoft,
  },
  optionWrong: {
    borderColor: colors.incorrect,
    borderWidth: 2,
    backgroundColor: colors.incorrectSoft,
  },
  optionFaded: { opacity: 0.6 },
  letter: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, width: 18 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markText: { fontFamily: fonts.semibold, fontSize: 14 },
  explainRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  noteLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  score: { fontFamily: fonts.bold, fontSize: 52, lineHeight: 58, color: colors.ink },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.gridLine },
  resultText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink },
  retryLater: { fontFamily: fonts.semibold, fontSize: 13, color: colors.incorrectInk },
  points: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.highlight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
