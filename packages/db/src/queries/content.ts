import type { ContentBlock, QuestionOption } from '@imc/contracts';
import type { Tx } from '../context.js';

export interface TopicRow {
  id: string;
  slug: string;
  displayKey: string;
  parentId: string | null;
  active: boolean;
}

const TOPIC_COLS = `id, slug, display_key as "displayKey", parent_id as "parentId", active`;

export async function listTopics(tx: Tx, activeOnly = true): Promise<TopicRow[]> {
  const { rows } = await tx.query<TopicRow>(
    `select ${TOPIC_COLS} from app.topics ${activeOnly ? 'where active' : ''} order by slug`,
  );
  return rows;
}

export async function findTopicBySlug(tx: Tx, slug: string): Promise<TopicRow | null> {
  const { rows } = await tx.query<TopicRow>(
    `select ${TOPIC_COLS} from app.topics where slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function findTopic(tx: Tx, id: string): Promise<TopicRow | null> {
  const { rows } = await tx.query<TopicRow>(`select ${TOPIC_COLS} from app.topics where id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function insertTopic(
  tx: Tx,
  input: { slug: string; displayKey: string; parentId: string | null },
): Promise<TopicRow> {
  const { rows } = await tx.query<TopicRow>(
    `insert into app.topics (slug, display_key, parent_id) values ($1, $2, $3)
     on conflict (slug) do update set display_key = excluded.display_key
     returning ${TOPIC_COLS}`,
    [input.slug, input.displayKey, input.parentId],
  );
  return rows[0]!;
}

/** Published inventory per topic for a grade/locale (rights must be cleared). */
export async function topicInventory(
  tx: Tx,
  grade: number,
  locale: string,
): Promise<Array<{ topicId: string; published: number }>> {
  const { rows } = await tx.query<{ topicId: string; published: number }>(
    `select v.topic_id as "topicId", count(*)::int as published
       from app.question_versions v
       join app.questions q on q.id = v.question_id
       join app.question_localizations l on l.version_id = v.id and l.locale = $2
      where v.state = 'published' and v.grade = $1 and q.rights_status = 'cleared'
      group by v.topic_id`,
    [grade, locale],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Questions and versions
// ---------------------------------------------------------------------------

export interface QuestionRow {
  id: string;
  sourceType: 'original' | 'licensed' | 'imc_archive';
  sourceReference: string | null;
  rightsStatus: 'unknown' | 'cleared' | 'restricted';
  rightsNotes: string | null;
  activeVersionId: string | null;
}

const QUESTION_COLS = `id, source_type as "sourceType", source_reference as "sourceReference",
  rights_status as "rightsStatus", rights_notes as "rightsNotes",
  active_version_id as "activeVersionId"`;

export async function insertQuestion(
  tx: Tx,
  input: {
    sourceType: string;
    sourceReference: string | null;
    rightsStatus: string;
    rightsNotes: string | null;
    createdBy: string;
  },
): Promise<QuestionRow> {
  const { rows } = await tx.query<QuestionRow>(
    `insert into app.questions (source_type, source_reference, rights_status, rights_notes, created_by)
     values ($1, $2, $3, $4, $5) returning ${QUESTION_COLS}`,
    [
      input.sourceType,
      input.sourceReference,
      input.rightsStatus,
      input.rightsNotes,
      input.createdBy,
    ],
  );
  return rows[0]!;
}

export async function findQuestion(tx: Tx, id: string): Promise<QuestionRow | null> {
  const { rows } = await tx.query<QuestionRow>(
    `select ${QUESTION_COLS} from app.questions where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findQuestionBySourceReference(
  tx: Tx,
  sourceType: string,
  sourceReference: string,
): Promise<QuestionRow | null> {
  const { rows } = await tx.query<QuestionRow>(
    `select ${QUESTION_COLS} from app.questions where source_type = $1 and source_reference = $2`,
    [sourceType, sourceReference],
  );
  return rows[0] ?? null;
}

export async function updateQuestionRights(
  tx: Tx,
  id: string,
  rightsStatus: string,
  rightsNotes: string | null,
): Promise<void> {
  await tx.query(`update app.questions set rights_status = $2, rights_notes = $3 where id = $1`, [
    id,
    rightsStatus,
    rightsNotes,
  ]);
}

export async function setActiveVersion(tx: Tx, questionId: string, versionId: string | null) {
  await tx.query(`update app.questions set active_version_id = $2 where id = $1`, [
    questionId,
    versionId,
  ]);
}

export interface VersionRow {
  id: string;
  questionId: string;
  versionNumber: number;
  grade: number;
  topicId: string;
  topicSlug: string;
  difficulty: number;
  state: 'draft' | 'in_review' | 'approved' | 'published' | 'retired';
  contentHash: string;
  authorId: string;
  approvedBy: string | null;
  approvedContentHash: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

const VERSION_COLS = `v.id, v.question_id as "questionId", v.version_number as "versionNumber",
  v.grade, v.topic_id as "topicId", t.slug as "topicSlug", v.difficulty, v.state,
  v.content_hash as "contentHash", v.author_id as "authorId", v.approved_by as "approvedBy",
  v.approved_content_hash as "approvedContentHash", v.published_at as "publishedAt",
  v.updated_at as "updatedAt"`;

export async function insertVersion(
  tx: Tx,
  input: {
    questionId: string;
    grade: number;
    topicId: string;
    difficulty: number;
    contentHash: string;
    authorId: string;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into app.question_versions
       (question_id, version_number, grade, topic_id, difficulty, content_hash, author_id)
     select $1, coalesce(max(version_number), 0) + 1, $2, $3, $4, $5, $6
       from app.question_versions where question_id = $1
     returning id`,
    [
      input.questionId,
      input.grade,
      input.topicId,
      input.difficulty,
      input.contentHash,
      input.authorId,
    ],
  );
  return rows[0]!.id;
}

export async function findVersion(
  tx: Tx,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<VersionRow | null> {
  const { rows } = await tx.query<VersionRow>(
    `select ${VERSION_COLS} from app.question_versions v join app.topics t on t.id = v.topic_id
      where v.id = $1 ${opts.forUpdate ? 'for update of v' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function latestVersionOf(tx: Tx, questionId: string): Promise<VersionRow | null> {
  const { rows } = await tx.query<VersionRow>(
    `select ${VERSION_COLS} from app.question_versions v join app.topics t on t.id = v.topic_id
      where v.question_id = $1 order by v.version_number desc limit 1`,
    [questionId],
  );
  return rows[0] ?? null;
}

export async function updateVersionAttributes(
  tx: Tx,
  id: string,
  input: { grade: number; topicId: string; difficulty: number; contentHash: string },
): Promise<void> {
  await tx.query(
    `update app.question_versions
        set grade = $2, topic_id = $3, difficulty = $4, content_hash = $5
      where id = $1`,
    [id, input.grade, input.topicId, input.difficulty, input.contentHash],
  );
}

export async function setVersionState(
  tx: Tx,
  id: string,
  state: VersionRow['state'],
  extra: {
    approvedBy?: string | null;
    approvedContentHash?: string | null;
    published?: boolean;
    retired?: boolean;
  } = {},
): Promise<void> {
  await tx.query(
    `update app.question_versions set
        state = $2,
        approved_by = case when $3::boolean then $4::uuid else approved_by end,
        approved_content_hash = case when $3::boolean then $5 else approved_content_hash end,
        published_at = case when $6::boolean then now() else published_at end,
        retired_at = case when $7::boolean then now() else retired_at end
      where id = $1`,
    [
      id,
      state,
      extra.approvedBy !== undefined,
      extra.approvedBy ?? null,
      extra.approvedContentHash ?? null,
      extra.published ?? false,
      extra.retired ?? false,
    ],
  );
}

export interface LocalizationRow {
  locale: string;
  stemBlocks: ContentBlock[];
  options: QuestionOption[];
  explanationBlocks: ContentBlock[];
}

export async function upsertLocalization(
  tx: Tx,
  versionId: string,
  loc: LocalizationRow,
): Promise<void> {
  await tx.query(
    `insert into app.question_localizations (version_id, locale, stem_blocks, options, explanation_blocks)
     values ($1, $2, $3, $4, $5)
     on conflict (version_id, locale) do update set
       stem_blocks = excluded.stem_blocks, options = excluded.options,
       explanation_blocks = excluded.explanation_blocks`,
    [
      versionId,
      loc.locale,
      JSON.stringify(loc.stemBlocks),
      JSON.stringify(loc.options),
      JSON.stringify(loc.explanationBlocks),
    ],
  );
}

export async function listLocalizations(tx: Tx, versionId: string): Promise<LocalizationRow[]> {
  const { rows } = await tx.query<LocalizationRow>(
    `select locale, stem_blocks as "stemBlocks", options, explanation_blocks as "explanationBlocks"
       from app.question_localizations where version_id = $1 order by locale`,
    [versionId],
  );
  return rows;
}

export async function findLocalization(
  tx: Tx,
  versionId: string,
  locale: string,
): Promise<LocalizationRow | null> {
  const { rows } = await tx.query<LocalizationRow>(
    `select locale, stem_blocks as "stemBlocks", options, explanation_blocks as "explanationBlocks"
       from app.question_localizations where version_id = $1 and locale = $2`,
    [versionId, locale],
  );
  return rows[0] ?? null;
}

export async function staffAnswerKey(tx: Tx, versionId: string): Promise<string | null> {
  const { rows } = await tx.query<{ key: string | null }>(
    `select app.staff_answer_key($1) as key`,
    [versionId],
  );
  return rows[0]?.key ?? null;
}

export async function staffSetAnswerKey(tx: Tx, versionId: string, optionId: string) {
  await tx.query(`select app.staff_set_answer_key($1, $2)`, [versionId, optionId]);
}

export async function replaceVersionAssets(
  tx: Tx,
  versionId: string,
  assets: { stem: string[]; solution: string[] },
): Promise<void> {
  await tx.query(`delete from app.version_assets where version_id = $1`, [versionId]);
  const pairs = [
    ...[...new Set(assets.stem)].map((id) => [id, 'stem'] as const),
    ...[...new Set(assets.solution)].map((id) => [id, 'solution'] as const),
  ];
  for (const [assetId, usage] of pairs) {
    await tx.query(
      `insert into app.version_assets (version_id, asset_id, usage) values ($1, $2, $3)`,
      [versionId, assetId, usage],
    );
  }
}

export interface VersionAssetRow {
  assetId: string;
  usage: 'stem' | 'solution';
  objectKey: string;
  status: 'pending' | 'ready';
  altText: string;
}

export async function listVersionAssets(tx: Tx, versionId: string): Promise<VersionAssetRow[]> {
  const { rows } = await tx.query<VersionAssetRow>(
    `select a.id as "assetId", va.usage, a.object_key as "objectKey", a.status,
            a.alt_text as "altText"
       from app.version_assets va join app.assets a on a.id = va.asset_id
      where va.version_id = $1`,
    [versionId],
  );
  return rows;
}

export interface VersionListRow extends VersionRow {
  stemPreview: string;
}

export async function listVersions(
  tx: Tx,
  filter: {
    state?: string;
    grade?: number;
    topicSlug?: string;
    excludeAuthor?: string;
    cursor?: { updatedAt: string; id: string };
    limit: number;
  },
): Promise<VersionListRow[]> {
  const { rows } = await tx.query<VersionListRow>(
    `select ${VERSION_COLS},
            coalesce((select l.stem_blocks->0->>'text' from app.question_localizations l
                       where l.version_id = v.id order by l.locale = 'en' desc limit 1), '') as "stemPreview"
       from app.question_versions v join app.topics t on t.id = v.topic_id
      where ($1::text is null or v.state = $1)
        and ($2::smallint is null or v.grade = $2)
        and ($3::text is null or t.slug = $3)
        and ($4::uuid is null or v.author_id <> $4)
        and ($5::timestamptz is null or (v.updated_at, v.id) < ($5, $6::uuid))
      order by v.updated_at desc, v.id desc
      limit $7`,
    [
      filter.state ?? null,
      filter.grade ?? null,
      filter.topicSlug ?? null,
      filter.excludeAuthor ?? null,
      filter.cursor?.updatedAt ?? null,
      filter.cursor?.id ?? null,
      filter.limit,
    ],
  );
  return rows;
}

export async function findVersionsByContentHash(tx: Tx, hash: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `select id from app.question_versions where content_hash = $1`,
    [hash],
  );
  return rows.map((r) => r.id);
}

export async function publishedVersionOf(tx: Tx, questionId: string): Promise<VersionRow | null> {
  const { rows } = await tx.query<VersionRow>(
    `select ${VERSION_COLS} from app.question_versions v join app.topics t on t.id = v.topic_id
      where v.question_id = $1 and v.state = 'published'`,
    [questionId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface ReviewRow {
  id: string;
  reviewerId: string;
  decision: 'approve' | 'request_changes';
  comments: string | null;
  reviewedContentHash: string;
  createdAt: string;
}

export async function insertReview(
  tx: Tx,
  input: {
    versionId: string;
    reviewerId: string;
    decision: string;
    comments: string | null;
    contentHash: string;
  },
): Promise<void> {
  await tx.query(
    `insert into app.content_reviews (version_id, reviewer_id, decision, comments, reviewed_content_hash)
     values ($1, $2, $3, $4, $5)`,
    [input.versionId, input.reviewerId, input.decision, input.comments, input.contentHash],
  );
}

export async function listReviews(tx: Tx, versionId: string): Promise<ReviewRow[]> {
  const { rows } = await tx.query<ReviewRow>(
    `select id, reviewer_id as "reviewerId", decision, comments,
            reviewed_content_hash as "reviewedContentHash", created_at as "createdAt"
       from app.content_reviews where version_id = $1 order by created_at desc, id`,
    [versionId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetRow {
  id: string;
  objectKey: string;
  mime: string;
  byteSize: number;
  checksum: string;
  altText: string;
  status: 'pending' | 'ready';
}

const ASSET_COLS = `id, object_key as "objectKey", mime, byte_size as "byteSize", checksum,
  alt_text as "altText", status`;

export async function insertAsset(
  tx: Tx,
  input: {
    id: string;
    objectKey: string;
    mime: string;
    byteSize: number;
    checksum: string;
    altText: string;
    uploadedBy: string;
  },
): Promise<void> {
  await tx.query(
    `insert into app.assets (id, object_key, mime, byte_size, checksum, alt_text, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.objectKey,
      input.mime,
      input.byteSize,
      input.checksum,
      input.altText,
      input.uploadedBy,
    ],
  );
}

export async function findAsset(tx: Tx, id: string): Promise<AssetRow | null> {
  const { rows } = await tx.query<AssetRow>(`select ${ASSET_COLS} from app.assets where id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function findAssets(tx: Tx, ids: string[]): Promise<AssetRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await tx.query<AssetRow>(
    `select ${ASSET_COLS} from app.assets where id = any($1::uuid[])`,
    [ids],
  );
  return rows;
}

export async function markAssetReady(tx: Tx, id: string): Promise<void> {
  await tx.query(`update app.assets set status = 'ready' where id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export interface ImportRow {
  id: string;
  createdBy: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payload: unknown;
  totalItems: number;
  createdCount: number;
  duplicateCount: number;
  errors: Array<{ index: number; code: string; message: string }>;
}

const IMPORT_COLS = `id, created_by as "createdBy", status, payload, total_items as "totalItems",
  created_count as "createdCount", duplicate_count as "duplicateCount", errors`;

export async function insertImport(
  tx: Tx,
  input: { id: string; createdBy: string; payload: unknown; totalItems: number },
): Promise<void> {
  await tx.query(
    `insert into app.content_imports (id, created_by, payload, total_items) values ($1, $2, $3, $4)`,
    [input.id, input.createdBy, JSON.stringify(input.payload), input.totalItems],
  );
}

export async function findImport(
  tx: Tx,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ImportRow | null> {
  const { rows } = await tx.query<ImportRow>(
    `select ${IMPORT_COLS} from app.content_imports where id = $1 ${opts.forUpdate ? 'for update' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function completeImport(
  tx: Tx,
  id: string,
  result: {
    status: 'completed' | 'failed';
    createdCount: number;
    duplicateCount: number;
    errors: unknown[];
  },
): Promise<void> {
  await tx.query(
    `update app.content_imports set status = $2, created_count = $3, duplicate_count = $4,
            errors = $5, completed_at = now()
      where id = $1`,
    [id, result.status, result.createdCount, result.duplicateCount, JSON.stringify(result.errors)],
  );
}
