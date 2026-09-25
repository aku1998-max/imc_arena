import { randomUUID } from 'node:crypto';
import {
  CONTENT_SCHEMA_VERSION,
  importQuestionSchema,
  localizedContentSchema,
  referencedAssetIds,
  validateForPublication,
  type ImportQuestion,
  type PublicationIssue,
  type VersionContentBody,
} from '@imc/contracts';
import {
  accounts,
  content,
  ops,
  practice,
  type LocalizationRow,
  type Tx,
  type VersionRow,
} from '@imc/db';
import { z } from 'zod';
import { productDefaults } from '../config.js';
import { canonicalJson, sha256Hex } from '../crypto.js';
import { DomainError, forbidden, invalidState, notFound } from '../errors.js';
import type { StoragePort } from '../ports.js';
import { audit, decodeCursor, encodeCursor, requireStaff, track } from './common.js';

const PILOT_LOCALE = 'en';

export function computeContentHash(input: {
  grade: number;
  topicSlug: string;
  difficulty: number;
  correctOptionId: string | null;
  localizations: LocalizationRow[];
}): string {
  const locs = [...input.localizations]
    .sort((a, b) => a.locale.localeCompare(b.locale))
    .map((l) => ({
      locale: l.locale,
      stemBlocks: l.stemBlocks,
      options: l.options,
      explanationBlocks: l.explanationBlocks,
    }));
  return sha256Hex(
    canonicalJson({
      v: CONTENT_SCHEMA_VERSION,
      grade: input.grade,
      topicSlug: input.topicSlug,
      difficulty: input.difficulty,
      correctOptionId: input.correctOptionId,
      localizations: locs,
    }),
  );
}

async function staffRoles(tx: Tx): Promise<Set<string>> {
  return new Set(await accounts.activeStaffRoles(tx, requireStaff(tx)));
}

async function requireRole(tx: Tx, ...roles: string[]) {
  const held = await staffRoles(tx);
  if (!roles.some((r) => held.has(r)))
    throw forbidden('Your staff role does not allow this action.');
  return held;
}

/** Validates the JSONB body with the versioned schema before it is stored. */
function parseLocalized(body: VersionContentBody): LocalizationRow {
  const parsed = localizedContentSchema.safeParse({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    stemBlocks: body.stemBlocks,
    options: body.options,
    explanationBlocks: body.explanationBlocks,
  });
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Content does not match the block schema.', {
      issues: z.prettifyError(parsed.error),
    });
  }
  const ids = parsed.data.options.map((o) => o.id);
  if (!ids.includes(body.correctOptionId)) {
    throw new DomainError('VALIDATION_FAILED', 'The answer id must be one of the option ids.');
  }
  return {
    locale: body.locale,
    stemBlocks: parsed.data.stemBlocks,
    options: parsed.data.options,
    explanationBlocks: parsed.data.explanationBlocks,
  };
}

async function writeVersionContent(
  tx: Tx,
  versionId: string,
  loc: LocalizationRow,
  correctOptionId: string,
) {
  const parsed = localizedContentSchema.parse({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    stemBlocks: loc.stemBlocks,
    options: loc.options,
    explanationBlocks: loc.explanationBlocks,
  });
  const assetIds = referencedAssetIds(parsed);
  const all = [...assetIds.stem, ...assetIds.solution];
  const found = await content.findAssets(tx, all);
  if (found.length !== new Set(all).size) {
    throw new DomainError('VALIDATION_FAILED', 'Content references an unknown image asset.');
  }
  await content.upsertLocalization(tx, versionId, loc);
  await content.staffSetAnswerKey(tx, versionId, correctOptionId);
  await content.replaceVersionAssets(tx, versionId, assetIds);
}

async function refreshHash(tx: Tx, versionId: string): Promise<string> {
  const v = (await content.findVersion(tx, versionId))!;
  const hash = computeContentHash({
    grade: v.grade,
    topicSlug: v.topicSlug,
    difficulty: v.difficulty,
    correctOptionId: await content.staffAnswerKey(tx, versionId),
    localizations: await content.listLocalizations(tx, versionId),
  });
  await content.updateVersionAttributes(tx, versionId, {
    grade: v.grade,
    topicId: v.topicId,
    difficulty: v.difficulty,
    contentHash: hash,
  });
  return hash;
}

async function topicIdFor(tx: Tx, slug: string): Promise<string> {
  const topic = await content.findTopicBySlug(tx, slug);
  if (!topic || !topic.active)
    throw new DomainError('VALIDATION_FAILED', `Unknown topic "${slug}".`);
  return topic.id;
}

export async function createQuestion(
  tx: Tx,
  input: {
    sourceType: string;
    sourceReference?: string | undefined;
    rightsStatus: string;
    rightsNotes?: string | undefined;
    version: VersionContentBody;
  },
) {
  const actor = requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  if (input.sourceReference) {
    const dup = await content.findQuestionBySourceReference(
      tx,
      input.sourceType,
      input.sourceReference,
    );
    if (dup) throw new DomainError('CONFLICT', 'A question with this source reference exists.');
  }
  const loc = parseLocalized(input.version);
  const topicId = await topicIdFor(tx, input.version.topicSlug);
  const question = await content.insertQuestion(tx, {
    sourceType: input.sourceType,
    sourceReference: input.sourceReference ?? null,
    rightsStatus: input.rightsStatus,
    rightsNotes: input.rightsNotes ?? null,
    createdBy: actor,
  });
  const versionId = await content.insertVersion(tx, {
    questionId: question.id,
    grade: input.version.grade,
    topicId,
    difficulty: input.version.difficulty,
    contentHash: 'pending',
    authorId: actor,
  });
  await writeVersionContent(tx, versionId, loc, input.version.correctOptionId);
  await refreshHash(tx, versionId);
  await audit(
    tx,
    'question.created',
    { type: 'question_version', id: versionId },
    {
      metadata: { questionId: question.id },
    },
  );
  return { questionId: question.id, versionId };
}

/**
 * Edits a draft/in-review/approved version. Any edit returns it to draft and invalidates approval
 * (the approval hash no longer matches). Published/retired versions are immutable.
 */
export async function updateVersion(tx: Tx, versionId: string, body: VersionContentBody) {
  requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  const v = await content.findVersion(tx, versionId, { forUpdate: true });
  if (!v) throw notFound('Version');
  if (v.state === 'published' || v.state === 'retired') {
    throw invalidState('Published versions are immutable. Create a new draft to correct it.');
  }
  const loc = parseLocalized(body);
  const topicId = await topicIdFor(tx, body.topicSlug);
  await content.updateVersionAttributes(tx, versionId, {
    grade: body.grade,
    topicId,
    difficulty: body.difficulty,
    contentHash: v.contentHash,
  });
  await writeVersionContent(tx, versionId, loc, body.correctOptionId);
  const hash = await refreshHash(tx, versionId);
  if (v.state !== 'draft') {
    await content.setVersionState(tx, versionId, 'draft', {
      approvedBy: null,
      approvedContentHash: null,
    });
  }
  await audit(
    tx,
    'version.edited',
    { type: 'question_version', id: versionId },
    {
      metadata: { previousState: v.state, contentHash: hash },
    },
  );
  return { versionId, state: 'draft' as const };
}

/** Correction path: a new draft copied from the latest version of a question. */
export async function createDraftFromLatest(tx: Tx, questionId: string) {
  const actor = requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  const latest = await content.latestVersionOf(tx, questionId);
  if (!latest) throw notFound('Question');
  if (latest.state !== 'published' && latest.state !== 'retired') {
    throw invalidState('This question already has an unpublished version.');
  }
  const locs = await content.listLocalizations(tx, latest.id);
  const key = await content.staffAnswerKey(tx, latest.id);
  const versionId = await content.insertVersion(tx, {
    questionId,
    grade: latest.grade,
    topicId: latest.topicId,
    difficulty: latest.difficulty,
    contentHash: latest.contentHash,
    authorId: actor,
  });
  for (const loc of locs) await writeVersionContent(tx, versionId, loc, key ?? '');
  await refreshHash(tx, versionId);
  await audit(
    tx,
    'version.drafted',
    { type: 'question_version', id: versionId },
    {
      metadata: { fromVersionId: latest.id },
    },
  );
  return { versionId, state: 'draft' as const };
}

async function publicationIssues(tx: Tx, v: VersionRow): Promise<PublicationIssue[]> {
  const issues: PublicationIssue[] = [];
  const question = await content.findQuestion(tx, v.questionId);
  if (question?.rightsStatus !== 'cleared') {
    issues.push({ code: 'RIGHTS_NOT_CLEARED', message: 'Rights status must permit reuse.' });
  }
  const locs = await content.listLocalizations(tx, v.id);
  const key = await content.staffAnswerKey(tx, v.id);
  const en = locs.find((l) => l.locale === PILOT_LOCALE);
  if (!en)
    issues.push({ code: 'MISSING_ENGLISH', message: 'Complete English content is required.' });
  for (const loc of locs) {
    const body = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      stemBlocks: loc.stemBlocks,
      options: loc.options,
      explanationBlocks: loc.explanationBlocks,
    };
    for (const issue of validateForPublication(body, key)) {
      issues.push({ ...issue, message: `[${loc.locale}] ${issue.message}` });
    }
  }
  for (const a of await content.listVersionAssets(tx, v.id)) {
    if (a.status !== 'ready') {
      issues.push({
        code: 'ASSET_NOT_READY',
        message: `Image ${a.assetId} has not been verified.`,
      });
    }
    if (!a.altText.trim()) {
      issues.push({ code: 'ASSET_ALT_MISSING', message: `Image ${a.assetId} needs alt text.` });
    }
  }
  return issues;
}

export async function submitForReview(tx: Tx, versionId: string) {
  requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  const v = await content.findVersion(tx, versionId, { forUpdate: true });
  if (!v) throw notFound('Version');
  if (v.state !== 'draft') throw invalidState('Only drafts can be submitted for review.');
  const issues = (await publicationIssues(tx, v)).filter((i) => i.code !== 'RIGHTS_NOT_CLEARED');
  if (issues.length) {
    throw new DomainError('VALIDATION_FAILED', 'Fix the content issues before review.', { issues });
  }
  await content.setVersionState(tx, versionId, 'in_review');
  await audit(tx, 'version.submitted', { type: 'question_version', id: versionId });
  return { versionId, state: 'in_review' as const };
}

/** Independent review: the reviewer can never be the author. Approval records the content hash. */
export async function reviewVersion(
  tx: Tx,
  versionId: string,
  input: { decision: 'approve' | 'request_changes'; comments?: string | undefined },
) {
  const actor = requireStaff(tx);
  await requireRole(tx, 'reviewer', 'administrator');
  const v = await content.findVersion(tx, versionId, { forUpdate: true });
  if (!v) throw notFound('Version');
  if (v.state !== 'in_review') throw invalidState('Only versions in review can be reviewed.');
  if (v.authorId === actor) throw forbidden('Authors cannot review their own version.');
  if (input.decision === 'request_changes' && !input.comments) {
    throw new DomainError('VALIDATION_FAILED', 'Explain the requested changes.');
  }
  const hash = await refreshHash(tx, versionId);
  await content.insertReview(tx, {
    versionId,
    reviewerId: actor,
    decision: input.decision,
    comments: input.comments ?? null,
    contentHash: hash,
  });
  if (input.decision === 'approve') {
    await content.setVersionState(tx, versionId, 'approved', {
      approvedBy: actor,
      approvedContentHash: hash,
    });
  } else {
    await content.setVersionState(tx, versionId, 'draft');
  }
  await audit(
    tx,
    `version.review.${input.decision}`,
    { type: 'question_version', id: versionId },
    {
      metadata: { contentHash: hash },
    },
  );
  return {
    versionId,
    state: input.decision === 'approve' ? ('approved' as const) : ('draft' as const),
  };
}

export async function publishVersion(tx: Tx, versionId: string) {
  requireStaff(tx);
  await requireRole(tx, 'administrator');
  const v = await content.findVersion(tx, versionId, { forUpdate: true });
  if (!v) throw notFound('Version');
  if (v.state !== 'approved') throw invalidState('Only approved versions can be published.');
  if (!v.approvedBy || v.approvedBy === v.authorId) {
    throw invalidState('Publication requires an independent approval.');
  }
  const hash = computeContentHash({
    grade: v.grade,
    topicSlug: v.topicSlug,
    difficulty: v.difficulty,
    correctOptionId: await content.staffAnswerKey(tx, versionId),
    localizations: await content.listLocalizations(tx, versionId),
  });
  if (hash !== v.approvedContentHash) {
    throw invalidState('Content changed after approval. It must be reviewed again.');
  }
  const issues = await publicationIssues(tx, v);
  if (issues.length) {
    throw new DomainError('VALIDATION_FAILED', 'This version cannot be published yet.', { issues });
  }
  const previous = await content.publishedVersionOf(tx, v.questionId);
  if (previous) {
    await content.setVersionState(tx, previous.id, 'retired', { retired: true });
    await audit(
      tx,
      'version.retired',
      { type: 'question_version', id: previous.id },
      {
        reason: 'superseded',
        metadata: { supersededBy: versionId },
      },
    );
  }
  await content.setVersionState(tx, versionId, 'published', { published: true });
  await content.setActiveVersion(tx, v.questionId, versionId);
  await audit(
    tx,
    'version.published',
    { type: 'question_version', id: versionId },
    {
      metadata: { contentHash: hash, questionId: v.questionId },
    },
  );
  return { versionId, state: 'published' as const };
}

/**
 * Retires a published version from new selection. Existing attempts keep referencing it.
 * With flagAffectedResults (wrong-key runbook) active sessions holding it are halted and the
 * affected attempts are counted into an audit record and an operations alert; attempts are never
 * rewritten.
 */
export async function retireVersion(
  tx: Tx,
  versionId: string,
  input: { reason: string; flagAffectedResults: boolean },
) {
  requireStaff(tx);
  await requireRole(tx, 'administrator');
  const v = await content.findVersion(tx, versionId, { forUpdate: true });
  if (!v) throw notFound('Version');
  if (v.state !== 'published') throw invalidState('Only published versions can be retired.');
  await content.setVersionState(tx, versionId, 'retired', { retired: true });
  await content.setActiveVersion(tx, v.questionId, null);
  if (input.flagAffectedResults) {
    // Staff cannot touch student records; the wrong-key correction runs as a system job that is
    // committed atomically with the retirement.
    await ops.enqueueJob(tx, {
      type: 'content.correction',
      dedupeKey: `correction:${versionId}`,
      payload: { versionId, reason: input.reason },
    });
  }
  const metadata = { flagAffectedResults: input.flagAffectedResults };
  await audit(
    tx,
    'version.retired',
    { type: 'question_version', id: versionId },
    {
      reason: input.reason,
      metadata,
    },
  );
  return { versionId, state: 'retired' as const };
}

/**
 * Wrong-key runbook (system job): halt active sessions still holding the version, count the
 * affected attempts and raise an operations alert. Attempts are never rewritten; any explicit
 * rescoring is a separate, audited decision.
 */
export async function applyCorrection(tx: Tx, versionId: string, reason: string) {
  const haltedSessions = await practice.abandonActiveSessionsForVersion(tx, versionId);
  const affectedAttempts = await practice.flagAttemptsForVersion(tx, versionId);
  await ops.raiseOpsAlert(tx, {
    kind: 'content_correction',
    dedupeKey: `wrong-key:${versionId}`,
    details: { versionId, affectedAttempts, haltedSessions },
  });
  await audit(
    tx,
    'version.correction_applied',
    { type: 'question_version', id: versionId },
    {
      reason,
      metadata: { haltedSessions, affectedAttempts },
    },
  );
}

export async function updateRights(
  tx: Tx,
  questionId: string,
  input: { rightsStatus: string; rightsNotes?: string | undefined },
) {
  requireStaff(tx);
  await requireRole(tx, 'administrator');
  const q = await content.findQuestion(tx, questionId);
  if (!q) throw notFound('Question');
  await content.updateQuestionRights(tx, questionId, input.rightsStatus, input.rightsNotes ?? null);
  await audit(
    tx,
    'question.rights_updated',
    { type: 'question', id: questionId },
    {
      metadata: { from: q.rightsStatus, to: input.rightsStatus },
    },
  );
}

export async function listVersionsForStaff(
  tx: Tx,
  filter: {
    state?: string | undefined;
    grade?: number | undefined;
    topicSlug?: string | undefined;
    reviewable?: 'true' | 'false' | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  const actor = requireStaff(tx);
  const cursor = decodeCursor(filter.cursor, 2);
  const rows = await content.listVersions(tx, {
    state: filter.reviewable === 'true' ? 'in_review' : filter.state,
    grade: filter.grade,
    topicSlug: filter.topicSlug,
    excludeAuthor: filter.reviewable === 'true' ? actor : undefined,
    cursor: cursor ? { updatedAt: cursor[0]!, id: cursor[1]! } : undefined,
    limit: filter.limit + 1,
  });
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toVersionSummary),
    nextCursor: rows.length > filter.limit && last ? encodeCursor([last.updatedAt, last.id]) : null,
  };
}

function toVersionSummary(v: VersionRow & { stemPreview?: string }) {
  return {
    id: v.id,
    questionId: v.questionId,
    versionNumber: v.versionNumber,
    state: v.state,
    grade: v.grade,
    topicSlug: v.topicSlug,
    difficulty: v.difficulty,
    authorId: v.authorId,
    approvedBy: v.approvedBy,
    publishedAt: v.publishedAt ? new Date(v.publishedAt).toISOString() : null,
    updatedAt: new Date(v.updatedAt).toISOString(),
    stemPreview: (v.stemPreview ?? '').slice(0, 140),
  };
}

export async function getVersionForStaff(tx: Tx, storage: StoragePort, versionId: string) {
  requireStaff(tx);
  const v = await content.findVersion(tx, versionId);
  if (!v) throw notFound('Version');
  const question = (await content.findQuestion(tx, v.questionId))!;
  const locs = await content.listLocalizations(tx, versionId);
  const key = await content.staffAnswerKey(tx, versionId);
  const assets: Record<string, { url: string; expiresAt: string }> = {};
  for (const a of await content.listVersionAssets(tx, versionId)) {
    if (a.status !== 'ready') continue;
    const signed = await storage.signedDownloadUrl(a.objectKey, productDefaults.signedUrlSeconds);
    assets[a.assetId] = { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
  const reviews = await content.listReviews(tx, versionId);
  return {
    version: toVersionSummary({
      ...v,
      stemPreview: locs[0]?.stemBlocks[0]?.type === 'text' ? locs[0].stemBlocks[0].text : '',
    }),
    question,
    localizations: locs,
    correctOptionId: key,
    contentHash: v.contentHash,
    reviews: reviews.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })),
    assets,
    publicationIssues:
      v.state === 'published' || v.state === 'retired' ? [] : await publicationIssues(tx, v),
  };
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export async function createTopic(
  tx: Tx,
  input: { slug: string; displayKey: string; parentId?: string | undefined },
) {
  requireStaff(tx);
  await requireRole(tx, 'administrator');
  const topic = await content.insertTopic(tx, {
    slug: input.slug,
    displayKey: input.displayKey,
    parentId: input.parentId ?? null,
  });
  await audit(tx, 'topic.upserted', { type: 'topic', id: topic.id });
  return topic;
}

// ---------------------------------------------------------------------------
// Imports: validated into drafts, never directly into published content.
// ---------------------------------------------------------------------------

export async function createImport(
  tx: Tx,
  body: {
    schemaVersion: 1;
    sourceType: string;
    rightsStatus: string;
    rightsNotes?: string | undefined;
    questions: unknown[];
  },
) {
  const actor = requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  const id = randomUUID();
  await content.insertImport(tx, {
    id,
    createdBy: actor,
    payload: body,
    totalItems: body.questions.length,
  });
  await ops.enqueueJob(tx, {
    type: 'content.import',
    dedupeKey: `import:${id}`,
    payload: { importId: id },
  });
  await audit(
    tx,
    'import.created',
    { type: 'content_import', id },
    {
      metadata: { totalItems: body.questions.length },
    },
  );
  return id;
}

export async function getImport(tx: Tx, importId: string) {
  requireStaff(tx);
  const row = await content.findImport(tx, importId);
  if (!row) throw notFound('Import');
  return {
    importId: row.id,
    status: row.status,
    totalItems: row.totalItems,
    createdCount: row.createdCount,
    duplicateCount: row.duplicateCount,
    errors: row.errors,
  };
}

/** Worker job (system context). Creates drafts authored by the importing staff member. */
export async function processImport(tx: Tx, importId: string) {
  const row = await content.findImport(tx, importId, { forUpdate: true });
  if (!row) return;
  if (row.status === 'completed' || row.status === 'failed') return;
  const payload = row.payload as {
    sourceType: string;
    rightsStatus: string;
    rightsNotes?: string;
    questions: unknown[];
  };
  const errors: Array<{ index: number; code: string; message: string }> = [];
  let created = 0;
  let duplicates = 0;
  for (const [index, raw] of payload.questions.entries()) {
    const parsed = importQuestionSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        index,
        code: 'INVALID_ITEM',
        message: z.prettifyError(parsed.error).slice(0, 500),
      });
      continue;
    }
    const q: ImportQuestion = parsed.data;
    const issues = validateForPublication(
      {
        schemaVersion: CONTENT_SCHEMA_VERSION,
        stemBlocks: q.stemBlocks,
        options: q.options,
        explanationBlocks: q.explanationBlocks,
      },
      q.correctOptionId,
    );
    if (issues.length) {
      errors.push({
        index,
        code: issues[0]!.code,
        message: issues.map((i) => i.message).join(' '),
      });
      continue;
    }
    const topic = await content.findTopicBySlug(tx, q.topicSlug);
    if (!topic) {
      errors.push({ index, code: 'UNKNOWN_TOPIC', message: `Unknown topic "${q.topicSlug}".` });
      continue;
    }
    const loc: LocalizationRow = {
      locale: q.locale,
      stemBlocks: q.stemBlocks,
      options: q.options,
      explanationBlocks: q.explanationBlocks,
    };
    const hash = computeContentHash({
      grade: q.grade,
      topicSlug: q.topicSlug,
      difficulty: q.difficulty,
      correctOptionId: q.correctOptionId,
      localizations: [loc],
    });
    const byRef = q.sourceReference
      ? await content.findQuestionBySourceReference(tx, payload.sourceType, q.sourceReference)
      : null;
    if (byRef || (await content.findVersionsByContentHash(tx, hash)).length > 0) {
      duplicates++;
      errors.push({ index, code: 'DUPLICATE', message: 'Duplicate of existing content; skipped.' });
      continue;
    }
    // Each item is isolated by a savepoint so one bad row cannot abort the batch.
    await tx.query('savepoint import_item');
    try {
      const question = await content.insertQuestion(tx, {
        sourceType: payload.sourceType,
        sourceReference: q.sourceReference ?? null,
        rightsStatus: payload.rightsStatus,
        rightsNotes: payload.rightsNotes ?? null,
        createdBy: row.createdBy,
      });
      const versionId = await content.insertVersion(tx, {
        questionId: question.id,
        grade: q.grade,
        topicId: topic.id,
        difficulty: q.difficulty,
        contentHash: hash,
        authorId: row.createdBy,
      });
      await writeVersionContent(tx, versionId, loc, q.correctOptionId);
      await tx.query('release savepoint import_item');
      created++;
    } catch (err) {
      await tx.query('rollback to savepoint import_item');
      const message = err instanceof DomainError ? err.message : 'Item could not be stored.';
      errors.push({ index, code: 'STORE_FAILED', message });
    }
  }
  const status =
    created === 0 && errors.length > 0 && duplicates < errors.length ? 'failed' : 'completed';
  await content.completeImport(tx, importId, {
    status,
    createdCount: created,
    duplicateCount: duplicates,
    errors,
  });
  if (errors.length) {
    await track(tx, 'import_failed', null, {
      contentVersion: CONTENT_SCHEMA_VERSION,
      errorCode: errors[0]!.code,
      count: errors.length,
    });
  }
  await audit(
    tx,
    'import.processed',
    { type: 'content_import', id: importId },
    {
      metadata: { created, duplicates, errors: errors.length },
    },
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function createUploadIntent(
  tx: Tx,
  storage: StoragePort,
  input: { mime: string; byteSize: number; checksum: string; altText: string },
) {
  const actor = requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  const ext = EXT[input.mime];
  if (!ext)
    throw new DomainError('VALIDATION_FAILED', 'Only PNG, JPEG and WebP images are allowed.');
  const id = randomUUID();
  const objectKey = `content/${id}.${ext}`;
  await content.insertAsset(tx, { id, objectKey, uploadedBy: actor, ...input });
  const signed = await storage.signedUploadUrl(objectKey, {
    mime: input.mime,
    byteSize: input.byteSize,
    ttlSeconds: productDefaults.signedUrlSeconds,
  });
  return {
    assetId: id,
    uploadUrl: signed.url,
    uploadMethod: 'PUT' as const,
    expiresAt: signed.expiresAt.toISOString(),
  };
}

const MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  [
    'image/png',
    (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  [
    'image/webp',
    (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  ],
];

/** Checks declared MIME against file signature so HTML/SVG/executables cannot be smuggled in. */
export function sniffMime(head: Buffer): string | null {
  return MAGIC.find(([, test]) => test(head))?.[0] ?? null;
}

export async function completeAsset(
  tx: Tx,
  storage: StoragePort & { read?: (key: string) => Promise<{ body: Buffer } | null> },
  assetId: string,
) {
  requireStaff(tx);
  await requireRole(tx, 'editor', 'administrator');
  const asset = await content.findAsset(tx, assetId);
  if (!asset) throw notFound('Asset');
  if (asset.status === 'ready') return asset;
  const info = await storage.inspect(asset.objectKey);
  if (!info) throw invalidState('The file has not been uploaded yet.');
  if (info.byteSize !== asset.byteSize || info.sha256 !== asset.checksum) {
    await storage.remove([asset.objectKey]);
    throw new DomainError(
      'VALIDATION_FAILED',
      'Uploaded file does not match the declared size/checksum.',
    );
  }
  if (storage.read) {
    const obj = await storage.read(asset.objectKey);
    if (!obj || sniffMime(obj.body.subarray(0, 16)) !== asset.mime) {
      await storage.remove([asset.objectKey]);
      throw new DomainError('VALIDATION_FAILED', 'File content does not match its declared type.');
    }
  }
  await content.markAssetReady(tx, assetId);
  await audit(tx, 'asset.verified', { type: 'asset', id: assetId });
  return { ...asset, status: 'ready' as const };
}
