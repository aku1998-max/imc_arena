import { importQuestionSchema, validateForPublication } from '@imc/contracts';
import { expect, it } from 'vitest';
import { SEED_TOPICS, syntheticQuestions } from '../src/questions.js';

it('every synthetic question is valid, publishable and unique', () => {
  const qs = syntheticQuestions(9);
  expect(qs.length).toBeGreaterThan(100);
  const stems = new Set<string>();
  for (const q of qs) {
    const parsed = importQuestionSchema.parse(q);
    expect(
      validateForPublication(
        {
          schemaVersion: 1,
          stemBlocks: parsed.stemBlocks,
          options: parsed.options,
          explanationBlocks: parsed.explanationBlocks,
        },
        parsed.correctOptionId,
      ),
    ).toEqual([]);
    stems.add(`${q.grade}:${JSON.stringify(q.stemBlocks)}`);
    expect(SEED_TOPICS.map((t) => t.slug)).toContain(q.topicSlug);
  }
  expect(stems.size).toBe(qs.length);
});

it('covers every grade and difficulty', () => {
  const qs = syntheticQuestions(3);
  for (const grade of [4, 5, 6]) {
    for (const difficulty of [1, 2, 3]) {
      expect(qs.some((q) => q.grade === grade && q.difficulty === difficulty)).toBe(true);
    }
  }
});
