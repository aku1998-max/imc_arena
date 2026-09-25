import type { AnsweredItem, ContentBlock, QuestionOption, UnansweredItem } from '@imc/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Blocks, OptionContent, optionAccessibleText } from '../../../src/components/Blocks';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../../src/components/ui';
import { friendlyMessage } from '../../../src/lib/api-client';
import { useSession } from '../../../src/session';
import { colors, minTouchTarget, radius, spacing, typography } from '../../../src/theme';

interface SessionState {
  sessionId: string;
  mode: string;
  status: 'active' | 'completed' | 'abandoned';
  items: Array<{ itemId: string; ordinal: number; answered: boolean; correct: boolean | null }>;
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
  | { kind: 'summary'; completion: NonNullable<SessionState['completion']> }
  | { kind: 'ended' };

export default function SessionPlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, pending, newIdempotencyKey } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
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
      if (s.status === 'completed' && s.completion)
        return setPhase({ kind: 'summary', completion: s.completion });
      if (s.status !== 'active' || !s.nextItemId) return setPhase({ kind: 'ended' });
      await showItem(s.nextItemId);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  }, [api, id, pending, showItem]);

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
    if (result.completion) return setPhase({ kind: 'summary', completion: result.completion });
    if (result.nextItemId) return showItem(result.nextItemId);
    return load();
  };

  const report = async (itemId: string) => {
    try {
      await api.request('POST', '/v1/reports', { body: { category: 'unclear_question', itemId } });
      setReported(true);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

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
    return (
      <Screen>
        <Title>Session complete!</Title>
        <Card>
          <Text style={s.big} accessibilityLabel={`${correctCount} out of ${itemCount} correct`}>
            {correctCount} / {itemCount}
          </Text>
          {rewards.map((r) => (
            <Body key={r.type}>
              ★ {r.type === 'perfect_session' ? 'Perfect session bonus' : 'Session complete'}: +
              {r.value}
            </Body>
          ))}
        </Card>
        <Button label="Back to home" onPress={() => router.replace('/child/home')} />
        <Button
          label="Review mistakes"
          kind="secondary"
          onPress={() => router.replace('/child/mistakes')}
        />
      </Screen>
    );
  }
  if (phase.kind === 'ended') {
    return (
      <Screen>
        <Body>This practice session has ended.</Body>
        <Button label="Back to home" onPress={() => router.replace('/child/home')} />
      </Screen>
    );
  }

  const item = phase.item;
  const answered = phase.kind === 'feedback';
  const result = answered ? phase.result : null;
  const chosen = answered ? phase.selected : selected;

  return (
    <Screen>
      <Body muted>
        Question {item.ordinal} of {item.total}
      </Body>
      <Blocks blocks={item.stemBlocks} assets={item.assets} />
      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
        {item.options.map((o: QuestionOption, i) => {
          const isChosen = chosen === o.id;
          const isKey = result?.correctOptionId === o.id;
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
              accessibilityState={{
                selected: isChosen,
                disabled: answered || phase.kind === 'submitting',
              }}
              accessibilityLabel={`Choice ${String.fromCharCode(65 + i)}: ${optionAccessibleText(o)}.${status}`}
              disabled={answered || phase.kind === 'submitting' || phase.kind === 'waiting'}
              onPress={() => setSelected(o.id)}
              style={[
                s.option,
                isChosen && s.optionChosen,
                result && isKey && s.optionCorrect,
                result && isChosen && !isKey && s.optionWrong,
              ]}
            >
              <Text style={s.letter}>{String.fromCharCode(65 + i)}</Text>
              <OptionContent option={o} />
              {/* Feedback never relies on colour alone: icon + words. */}
              {result && isKey && <Text style={s.mark}>✓ Correct</Text>}
              {result && isChosen && !isKey && <Text style={s.mark}>✗ Your answer</Text>}
            </Pressable>
          );
        })}
      </View>
      <ErrorText message={error} />
      {phase.kind === 'waiting' && (
        <Card>
          <Body>
            ⏳ Waiting to sync. Your answer is saved and will be checked when you are back online.
          </Body>
          <Button label="Try again now" onPress={() => void submit(item as UnansweredItem)} />
        </Card>
      )}
      {(phase.kind === 'question' || phase.kind === 'submitting') && (
        <Button
          label={phase.kind === 'submitting' ? 'Checking…' : 'Check answer'}
          disabled={!selected || phase.kind === 'submitting'}
          onPress={() => void submit(item as UnansweredItem)}
        />
      )}
      {result && (
        <Card>
          <Text style={s.feedback} accessibilityLiveRegion="polite">
            {result.correct
              ? '✓ Well done — that is correct!'
              : '✗ Not quite. Here is how it works:'}
          </Text>
          <Blocks blocks={result.explanationBlocks} assets={result.assets} />
          <Button
            label={result.completion ? 'See results' : 'Next question'}
            onPress={() => void next(result)}
          />
          {!reported ? (
            <Button
              label="Report a problem with this question"
              kind="secondary"
              onPress={() => void report(item.itemId)}
            />
          ) : (
            <Body muted>Thanks! We will check this question.</Body>
          )}
        </Card>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  option: {
    minHeight: minTouchTarget + 8,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionChosen: { borderColor: colors.text, backgroundColor: colors.accentSoft },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.incorrect, backgroundColor: colors.incorrectSoft },
  letter: {
    fontWeight: typography.weightBold,
    fontSize: typography.fontSizeBody,
    color: colors.text,
    width: 20,
  },
  mark: { marginLeft: 'auto', fontWeight: typography.weightBold, color: colors.text },
  feedback: {
    fontSize: typography.fontSizeBody + 2,
    fontWeight: typography.weightBold,
    color: colors.text,
  },
  big: {
    fontSize: typography.fontSizeDisplay,
    fontWeight: typography.weightBold,
    color: colors.text,
    textAlign: 'center',
  },
});
