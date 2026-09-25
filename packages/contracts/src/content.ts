import { z } from 'zod';

/** Current version of the rich-content JSON structure stored in question_localizations. */
export const CONTENT_SCHEMA_VERSION = 1;

export const GRADES = [4, 5, 6] as const;
export const gradeSchema = z.number().int().min(4).max(6);
export const difficultySchema = z.number().int().min(1).max(3);
export const localeSchema = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Expected a BCP 47 language tag such as "en" or "en-GB"');

/** Stable option identifiers. Grading always uses these ids, never array positions. */
export const optionIdSchema = z.string().regex(/^[a-z0-9_-]{1,16}$/);

const textBlock = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(2000),
});

const mathBlock = z.strictObject({
  type: z.literal('math'),
  latex: z.string().min(1).max(1000),
  display: z.boolean().default(false),
  /** Spoken/readable fallback for screen readers. */
  alt: z.string().min(1).max(500),
});

const imageBlock = z.strictObject({
  type: z.literal('image'),
  assetId: z.uuid(),
  alt: z.string().min(1).max(500),
});

/** Allowlisted block format. Arbitrary HTML is never accepted. */
export const contentBlockSchema = z.discriminatedUnion('type', [textBlock, mathBlock, imageBlock]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const optionSchema = z
  .strictObject({
    id: optionIdSchema,
    text: z.string().min(1).max(300).optional(),
    math: z.string().min(1).max(300).optional(),
    alt: z.string().min(1).max(300).optional(),
  })
  .refine((o) => o.text !== undefined || o.math !== undefined, {
    message: 'An option needs text or math',
  })
  .refine((o) => o.math === undefined || o.alt !== undefined, {
    message: 'A math option needs alt text',
  });
export type QuestionOption = z.infer<typeof optionSchema>;

export const blocksSchema = z.array(contentBlockSchema).min(1).max(20);

/** Localized content body as stored (stem_blocks/options/explanation_blocks). */
export const localizedContentSchema = z.strictObject({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  stemBlocks: blocksSchema,
  options: z.array(optionSchema).min(2).max(6),
  explanationBlocks: blocksSchema,
});
export type LocalizedContent = z.infer<typeof localizedContentSchema>;

/**
 * Staff/import shape of a single question (see spec section 09). correctOptionId and
 * explanationBlocks never leave the server in an unanswered student DTO.
 */
export const importQuestionSchema = z.strictObject({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  sourceReference: z.string().min(1).max(200).optional(),
  locale: localeSchema.default('en'),
  stemBlocks: blocksSchema,
  options: z.array(optionSchema).min(2).max(6),
  correctOptionId: optionIdSchema,
  explanationBlocks: blocksSchema,
  grade: gradeSchema,
  topicSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  difficulty: difficultySchema,
});
export type ImportQuestion = z.infer<typeof importQuestionSchema>;

export const importFileSchema = z.strictObject({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  sourceType: z.enum(['original', 'licensed', 'imc_archive']),
  rightsStatus: z.enum(['unknown', 'cleared', 'restricted']),
  rightsNotes: z.string().max(2000).optional(),
  questions: z.array(z.unknown()).min(1).max(500),
});

export const QUESTION_STATES = ['draft', 'in_review', 'approved', 'published', 'retired'] as const;
export type QuestionState = (typeof QUESTION_STATES)[number];

export interface PublicationIssue {
  code: string;
  message: string;
}

/**
 * Publication validator (spec section 06/09): exactly four distinct choices and exactly one
 * answer id that belongs to those choices, and a valid versioned content body.
 */
export function validateForPublication(
  content: unknown,
  correctOptionId: string | null | undefined,
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const parsed = localizedContentSchema.safeParse(content);
  if (!parsed.success) {
    issues.push({ code: 'INVALID_CONTENT', message: z.prettifyError(parsed.error) });
    return issues;
  }
  const { options } = parsed.data;
  if (options.length !== 4) {
    issues.push({ code: 'OPTION_COUNT', message: 'Exactly four choices are required.' });
  }
  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== options.length) {
    issues.push({ code: 'DUPLICATE_OPTION_ID', message: 'Option ids must be distinct.' });
  }
  const labels = new Set(options.map((o) => `${o.text ?? ''}|${o.math ?? ''}`.trim()));
  if (labels.size !== options.length) {
    issues.push({ code: 'DUPLICATE_OPTION', message: 'Choices must be distinct.' });
  }
  if (!correctOptionId) {
    issues.push({ code: 'MISSING_ANSWER', message: 'An answer key is required.' });
  } else if (!ids.has(correctOptionId)) {
    issues.push({
      code: 'ANSWER_NOT_AN_OPTION',
      message: 'The answer id must belong to the choices.',
    });
  }
  return issues;
}

/** Collects every image asset id referenced by the content body. */
export function referencedAssetIds(content: LocalizedContent): {
  stem: string[];
  solution: string[];
} {
  const pick = (blocks: ContentBlock[]) =>
    blocks.flatMap((b) => (b.type === 'image' ? [b.assetId] : []));
  return { stem: pick(content.stemBlocks), solution: pick(content.explanationBlocks) };
}
