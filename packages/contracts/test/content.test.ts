import { describe, expect, it } from 'vitest';
import {
  importQuestionSchema,
  localizedContentSchema,
  unansweredItemSchema,
  validateForPublication,
} from '../src/index.js';

const content = {
  schemaVersion: 1,
  stemBlocks: [{ type: 'text', text: 'What is 6 x 7?' }],
  options: [
    { id: 'a', text: '36' },
    { id: 'b', text: '42' },
    { id: 'c', text: '48' },
    { id: 'd', text: '49' },
  ],
  explanationBlocks: [{ type: 'text', text: 'Six groups of seven total 42.' }],
};

describe('publication validator', () => {
  it('accepts four distinct choices with one valid key', () => {
    expect(validateForPublication(content, 'b')).toEqual([]);
  });

  it('rejects a key that is not one of the choices', () => {
    expect(validateForPublication(content, 'e').map((i) => i.code)).toContain(
      'ANSWER_NOT_AN_OPTION',
    );
  });

  it('rejects anything other than exactly four choices', () => {
    const three = { ...content, options: content.options.slice(0, 3) };
    expect(validateForPublication(three, 'b').map((i) => i.code)).toContain('OPTION_COUNT');
  });

  it('rejects duplicate choice ids and duplicate choice text', () => {
    const dupId = { ...content, options: [...content.options.slice(0, 3), { id: 'a', text: '1' }] };
    expect(validateForPublication(dupId, 'b').map((i) => i.code)).toContain('DUPLICATE_OPTION_ID');
    const dupText = {
      ...content,
      options: [...content.options.slice(0, 3), { id: 'd', text: '36' }],
    };
    expect(validateForPublication(dupText, 'b').map((i) => i.code)).toContain('DUPLICATE_OPTION');
  });

  it('rejects missing answer keys', () => {
    expect(validateForPublication(content, null).map((i) => i.code)).toEqual(['MISSING_ANSWER']);
  });
});

describe('allowlisted block format', () => {
  it('rejects html blocks and unknown fields', () => {
    const html = { ...content, stemBlocks: [{ type: 'html', html: '<script>x</script>' }] };
    expect(localizedContentSchema.safeParse(html).success).toBe(false);
    const extra = { ...content, stemBlocks: [{ type: 'text', text: 'x', html: '<b>' }] };
    expect(localizedContentSchema.safeParse(extra).success).toBe(false);
  });

  it('parses the documented import example', () => {
    const parsed = importQuestionSchema.parse({
      ...content,
      correctOptionId: 'b',
      grade: 4,
      topicSlug: 'arithmetic',
      difficulty: 1,
    });
    expect(parsed.locale).toBe('en');
  });

  it('rejects grades outside 4..6', () => {
    const r = importQuestionSchema.safeParse({
      ...content,
      correctOptionId: 'b',
      grade: 7,
      topicSlug: 'arithmetic',
      difficulty: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe('safe question DTO', () => {
  it('refuses answer metadata on an unanswered item', () => {
    const dto = {
      itemId: '00000000-0000-4000-8000-000000000001',
      ordinal: 1,
      total: 5,
      stemBlocks: content.stemBlocks,
      options: content.options,
      assets: {},
      answered: false,
    };
    expect(unansweredItemSchema.safeParse(dto).success).toBe(true);
    expect(unansweredItemSchema.safeParse({ ...dto, correctOptionId: 'b' }).success).toBe(false);
    expect(
      unansweredItemSchema.safeParse({ ...dto, explanationBlocks: content.explanationBlocks })
        .success,
    ).toBe(false);
  });
});
