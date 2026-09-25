import { describe, expect, it } from 'vitest';
import { difficultySlots, selectQuestions, type SelectionCandidate } from '../src/selection.js';

const mix = { 1: 2, 2: 2, 3: 1 } as const;
function pool(spec: Array<[difficulty: number, topic: string]>): SelectionCandidate[] {
  return spec.map(([difficulty, topicId], i) => ({
    questionId: `q${String(i).padStart(3, '0')}`,
    versionId: `v${i}`,
    topicId,
    difficulty,
  }));
}

describe('difficultySlots', () => {
  it('produces the 2/2/1 mix for five items and scales for other counts', () => {
    expect(difficultySlots(5, mix)).toEqual([1, 1, 2, 2, 3]);
    expect(difficultySlots(3, mix).length).toBe(3);
    expect(difficultySlots(10, mix)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
  });
});

describe('selectQuestions', () => {
  const rich = pool(
    Array.from({ length: 30 }, (_, i) => [(i % 3) + 1, `t${i % 5}`] as [number, string]),
  );

  it('selects five distinct identities with the preferred mix, deterministically per seed', () => {
    const a = selectQuestions({ candidates: rich, recent: new Set(), count: 5, mix, seed: 's1' });
    const b = selectQuestions({ candidates: rich, recent: new Set(), count: 5, mix, seed: 's1' });
    expect(a).toEqual(b);
    if (!a.ok) throw new Error('expected success');
    expect(new Set(a.picks.map((p) => p.questionId)).size).toBe(5);
    expect(a.picks.map((p) => p.difficulty)).toEqual([1, 1, 2, 2, 3]);
    expect(a.relaxed).toEqual([]);
  });

  it('spreads topics when inventory allows', () => {
    const r = selectQuestions({
      candidates: rich,
      recent: new Set(),
      count: 5,
      mix,
      seed: 'spread',
    });
    if (!r.ok) throw new Error('expected success');
    expect(new Set(r.picks.map((p) => p.topicId)).size).toBe(5);
  });

  it('avoids recently seen questions, relaxing only when needed', () => {
    const recent = new Set(rich.slice(0, 27).map((c) => c.questionId));
    const r = selectQuestions({ candidates: rich, recent, count: 5, mix, seed: 'r' });
    if (!r.ok) throw new Error('expected success');
    const fresh = r.picks.filter((p) => !recent.has(p.questionId));
    expect(fresh).toHaveLength(3);
    expect(r.relaxed).toContain('recent');
  });

  it('relaxes difficulty before recency', () => {
    const onlyEasy = pool(Array.from({ length: 8 }, () => [1, 't'] as [number, string]));
    const r = selectQuestions({
      candidates: onlyEasy,
      recent: new Set(),
      count: 5,
      mix,
      seed: 'd',
    });
    if (!r.ok) throw new Error('expected success');
    expect(r.relaxed).toEqual(['difficulty']);
  });

  it('never pads: fewer than five distinct identities fails', () => {
    const dupes = [
      ...pool([
        [1, 't'],
        [2, 't'],
        [3, 't'],
        [1, 't'],
      ]),
      ...pool([[1, 't']]),
    ];
    const r = selectQuestions({ candidates: dupes, recent: new Set(), count: 5, mix, seed: 'x' });
    expect(r).toEqual({ ok: false, available: 4 });
  });
});
