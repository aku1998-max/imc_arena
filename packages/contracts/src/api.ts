import { z } from 'zod';
import {
  blocksSchema,
  contentBlockSchema,
  difficultySchema,
  gradeSchema,
  importQuestionSchema,
  localeSchema,
  optionIdSchema,
  optionSchema,
  QUESTION_STATES,
} from './content.js';

// ---------------------------------------------------------------------------
// Envelope and errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'REAUTH_REQUIRED',
  'FORBIDDEN',
  'ENTITLEMENT_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_STATE',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_KEY_REQUIRED',
  'ANSWER_ALREADY_SUBMITTED',
  'RATE_LIMITED',
  'CONTENT_UNAVAILABLE',
  'SUBMISSIONS_PAUSED',
  'FEATURE_DISABLED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, requestId: z.string() });
}

const uuid = z.uuid();
const isoDateTime = z.iso.datetime({ offset: true });
const localDate = z.iso.date();
const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown IANA timezone' },
  );

export const idParams = z.object({ id: uuid });
export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

export const STAFF_ROLES = ['editor', 'reviewer', 'administrator', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const studentProfileSchema = z.object({
  id: uuid,
  nickname: z.string(),
  avatarKey: z.string(),
  grade: gradeSchema,
  locale: z.string(),
  timezone: z.string(),
  status: z.enum(['active', 'deleting']),
});
export type StudentProfile = z.infer<typeof studentProfileSchema>;

export const meResponse = z.object({
  kind: z.enum(['child', 'adult', 'staff']),
  capabilities: z.array(z.string()),
  account: z.object({ id: uuid, preferredLocale: z.string() }).optional(),
  student: studentProfileSchema.optional(),
  staffRoles: z.array(z.enum(STAFF_ROLES)).optional(),
});

// ---------------------------------------------------------------------------
// Student experience
// ---------------------------------------------------------------------------

export const SESSION_MODES = ['daily', 'topic', 'mistakes'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const topicSummarySchema = z.object({
  id: uuid,
  slug: z.string(),
  displayKey: z.string(),
});

export const homeResponse = z.object({
  student: studentProfileSchema,
  daily: z.object({
    localDate,
    status: z.enum(['not_started', 'in_progress', 'completed']),
    sessionId: uuid.nullable(),
  }),
  activeSessions: z.array(
    z.object({
      sessionId: uuid,
      mode: z.enum(SESSION_MODES),
      topic: topicSummarySchema.nullable(),
      answeredCount: z.number().int(),
      itemCount: z.number().int(),
    }),
  ),
  suggestedTopic: topicSummarySchema.nullable(),
  recentActivity: z.array(
    z.object({
      sessionId: uuid,
      mode: z.enum(SESSION_MODES),
      completedAt: isoDateTime,
      correctCount: z.number().int(),
      itemCount: z.number().int(),
    }),
  ),
  weeklyGoal: z.object({ target: z.number().int(), completed: z.number().int() }),
  access: z.object({ pro: z.boolean(), validUntil: isoDateTime.nullable() }),
});

export const topicsQuery = z.object({ grade: z.coerce.number().pipe(gradeSchema) });
export const topicsResponse = z.object({
  topics: z.array(
    topicSummarySchema.extend({
      parentId: uuid.nullable(),
      inventory: z.enum(['ready', 'limited', 'unavailable']),
    }),
  ),
});

export const startSessionBody = z.strictObject({
  mode: z.enum(SESSION_MODES),
  topicId: uuid.optional(),
});
export const startSessionResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    sessionId: uuid,
    mode: z.enum(SESSION_MODES),
    itemCount: z.number().int(),
    nextItemId: uuid.nullable(),
    created: z.boolean(),
  }),
  z.object({ status: z.literal('empty'), reason: z.literal('NO_MISTAKES') }),
]);

export const completionSummarySchema = z.object({
  correctCount: z.number().int(),
  itemCount: z.number().int(),
  rewards: z.array(z.object({ type: z.string(), value: z.number().int() })),
});

export const sessionStateResponse = z.object({
  sessionId: uuid,
  mode: z.enum(SESSION_MODES),
  topicId: uuid.nullable(),
  status: z.enum(['active', 'completed', 'abandoned']),
  localDate,
  items: z.array(
    z.object({
      itemId: uuid,
      ordinal: z.number().int(),
      answered: z.boolean(),
      correct: z.boolean().nullable(),
    }),
  ),
  nextItemId: uuid.nullable(),
  completion: completionSummarySchema.nullable(),
});

export const signedAssetSchema = z.object({ url: z.string(), expiresAt: isoDateTime });
export const assetMapSchema = z.record(z.string(), signedAssetSchema);

/** Safe DTO for an unanswered item. strict: extra keys are a contract violation. */
export const unansweredItemSchema = z.strictObject({
  itemId: uuid,
  ordinal: z.number().int(),
  total: z.number().int(),
  stemBlocks: z.array(contentBlockSchema),
  options: z.array(optionSchema),
  assets: assetMapSchema,
  answered: z.literal(false),
});

export const answeredItemSchema = z.strictObject({
  itemId: uuid,
  ordinal: z.number().int(),
  total: z.number().int(),
  stemBlocks: z.array(contentBlockSchema),
  options: z.array(optionSchema),
  assets: assetMapSchema,
  answered: z.literal(true),
  selectedOptionId: optionIdSchema,
  correct: z.boolean(),
  correctOptionId: optionIdSchema,
  explanationBlocks: z.array(contentBlockSchema),
});

export const itemResponse = z.union([unansweredItemSchema, answeredItemSchema]);
export type UnansweredItem = z.infer<typeof unansweredItemSchema>;
export type AnsweredItem = z.infer<typeof answeredItemSchema>;

export const answerBody = z.strictObject({
  optionId: optionIdSchema,
  responseMs: z.number().int().min(0).max(3_600_000).optional(),
});
export const answerResponse = z.object({
  attemptId: uuid,
  correct: z.boolean(),
  correctOptionId: optionIdSchema,
  explanationBlocks: z.array(contentBlockSchema),
  assets: assetMapSchema,
  nextItemId: uuid.nullable(),
  completion: completionSummarySchema.nullable(),
});

export const progressQuery = z.object({ from: localDate, to: localDate });
export const progressResponse = z.object({
  from: localDate,
  to: localDate,
  completedSessions: z.number().int(),
  questionsAnswered: z.number().int(),
  firstAttempts: z.object({ count: z.number().int(), correct: z.number().int() }),
  retries: z.object({ count: z.number().int(), correct: z.number().int() }),
  topics: z.array(
    topicSummarySchema.extend({
      firstAttemptCount: z.number().int(),
      firstAttemptCorrect: z.number().int(),
      retryCount: z.number().int(),
    }),
  ),
  weekly: z.array(z.object({ weekStart: localDate, completedSessions: z.number().int() })),
  sufficientData: z.boolean(),
  historyLimited: z.boolean(),
});

export const mistakesResponse = z.object({
  items: z.array(
    z.object({
      questionId: uuid,
      topic: topicSummarySchema,
      dueAt: isoDateTime,
      lastFailedAt: isoDateTime,
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const REPORT_CATEGORIES = [
  'wrong_answer',
  'unclear_question',
  'display_problem',
  'app_problem',
  'other',
] as const;
export const reportBody = z.strictObject({
  category: z.enum(REPORT_CATEGORIES),
  versionId: uuid.optional(),
  /** A child reports the item in front of them; the server resolves its version. */
  itemId: uuid.optional(),
  message: z.string().trim().max(1000).optional(),
});
export const reportResponse = z.object({ reportId: uuid });

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

export const createStudentBody = z.strictObject({
  nickname: z.string().trim().min(1).max(24),
  avatarKey: z.string().regex(/^[a-z0-9-]{1,32}$/),
  grade: gradeSchema,
  timezone: timezoneSchema,
  locale: localeSchema.default('en'),
});
export const updateStudentBody = createStudentBody.partial();
export const studentsResponse = z.object({ students: z.array(studentProfileSchema) });

export const GRANT_ACTIONS = [
  'purchase',
  'export',
  'delete_student',
  'delete_account',
  'update_sensitive',
] as const;
export type GrantAction = (typeof GRANT_ACTIONS)[number];
export const adultGrantBody = z.strictObject({
  action: z.enum(GRANT_ACTIONS),
  targetId: uuid,
});
export const adultGrantResponse = z.object({ grant: z.string(), expiresAt: isoDateTime });

export const createChildSessionBody = z.strictObject({
  deviceLabel: z.string().trim().min(1).max(60),
});
export const childSessionResponse = z.object({
  sessionId: uuid,
  token: z.string(),
  expiresAt: isoDateTime,
});
export const devicesResponse = z.object({
  devices: z.array(
    z.object({
      id: uuid,
      deviceLabel: z.string(),
      createdAt: isoDateTime,
      expiresAt: isoDateTime,
      revokedAt: isoDateTime.nullable(),
    }),
  ),
});

export const CONSENT_PURPOSES = ['core_service', 'parent_reminders', 'product_analytics'] as const;
export const consentBody = z.strictObject({
  studentId: uuid,
  purpose: z.enum(CONSENT_PURPOSES),
  policyVersion: z.string().min(1).max(40),
  granted: z.boolean(),
});
export const consentRecordSchema = z.object({
  id: uuid,
  studentId: uuid,
  purpose: z.enum(CONSENT_PURPOSES),
  policyVersion: z.string(),
  grantedAt: isoDateTime,
  withdrawnAt: isoDateTime.nullable(),
});
export const consentsResponse = z.object({ consents: z.array(consentRecordSchema) });

export const exportBody = z.strictObject({ studentId: uuid });
export const exportResponse = z.object({
  exportId: uuid,
  status: z.enum(['pending', 'ready', 'failed', 'expired']),
  downloadUrl: z.string().nullable(),
  expiresAt: isoDateTime.nullable(),
});
export const deletionBody = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('student'), studentId: uuid }),
  z.strictObject({ scope: z.literal('account'), accountId: uuid }),
]);
export const deletionResponse = z.object({
  requestId: uuid,
  status: z.enum(['pending', 'completed']),
  notice: z.string(),
});

export const purchaseIntentBody = z.strictObject({
  studentId: uuid,
  productId: z.string().min(1).max(100),
});
export const purchaseIntentResponse = z.object({
  intentId: uuid,
  billingCustomerId: z.string(),
  productId: z.string(),
  expiresAt: isoDateTime,
});
export const entitlementSchema = z.object({
  id: uuid,
  studentId: uuid,
  featureSet: z.string(),
  source: z.enum(['purchase', 'pilot', 'support']),
  validFrom: isoDateTime,
  validUntil: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
});
export const entitlementsResponse = z.object({
  billingEnabled: z.boolean(),
  entitlements: z.array(entitlementSchema),
  pendingPurchases: z.number().int(),
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const SOURCE_TYPES = ['original', 'licensed', 'imc_archive'] as const;
export const RIGHTS_STATUSES = ['unknown', 'cleared', 'restricted'] as const;

export const versionContentBody = z.strictObject({
  grade: gradeSchema,
  topicSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  difficulty: difficultySchema,
  locale: localeSchema.default('en'),
  stemBlocks: blocksSchema,
  options: z.array(optionSchema).min(2).max(6),
  correctOptionId: optionIdSchema,
  explanationBlocks: blocksSchema,
});
export type VersionContentBody = z.infer<typeof versionContentBody>;

export const createQuestionBody = z.strictObject({
  sourceType: z.enum(SOURCE_TYPES),
  sourceReference: z.string().min(1).max(200).optional(),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  rightsNotes: z.string().max(2000).optional(),
  version: versionContentBody,
});
export const updateQuestionRightsBody = z.strictObject({
  rightsStatus: z.enum(RIGHTS_STATUSES),
  rightsNotes: z.string().max(2000).optional(),
});

export const versionSummarySchema = z.object({
  id: uuid,
  questionId: uuid,
  versionNumber: z.number().int(),
  state: z.enum(QUESTION_STATES),
  grade: gradeSchema,
  topicSlug: z.string(),
  difficulty: difficultySchema,
  authorId: uuid,
  approvedBy: uuid.nullable(),
  publishedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
  stemPreview: z.string(),
});

export const adminQuestionsQuery = cursorQuery.extend({
  state: z.enum(QUESTION_STATES).optional(),
  grade: z.coerce.number().pipe(gradeSchema).optional(),
  topicSlug: z.string().optional(),
  reviewable: z.enum(['true', 'false']).optional(),
});
export const adminQuestionsResponse = z.object({
  items: z.array(versionSummarySchema),
  nextCursor: z.string().nullable(),
});

export const adminVersionResponse = z.object({
  version: versionSummarySchema,
  question: z.object({
    id: uuid,
    sourceType: z.enum(SOURCE_TYPES),
    sourceReference: z.string().nullable(),
    rightsStatus: z.enum(RIGHTS_STATUSES),
    rightsNotes: z.string().nullable(),
    activeVersionId: uuid.nullable(),
  }),
  localizations: z.array(
    z.object({
      locale: z.string(),
      stemBlocks: z.array(contentBlockSchema),
      options: z.array(optionSchema),
      explanationBlocks: z.array(contentBlockSchema),
    }),
  ),
  correctOptionId: optionIdSchema.nullable(),
  contentHash: z.string(),
  reviews: z.array(
    z.object({
      id: uuid,
      reviewerId: uuid,
      decision: z.enum(['approve', 'request_changes']),
      comments: z.string().nullable(),
      reviewedContentHash: z.string(),
      createdAt: isoDateTime,
    }),
  ),
  assets: assetMapSchema,
  publicationIssues: z.array(z.object({ code: z.string(), message: z.string() })),
});

export const reviewBody = z.strictObject({
  decision: z.enum(['approve', 'request_changes']),
  comments: z.string().trim().max(2000).optional(),
});
export const retireBody = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  flagAffectedResults: z.boolean().default(false),
});
export const versionStateResponse = z.object({
  versionId: uuid,
  state: z.enum(QUESTION_STATES),
});

export const importBody = z.object({
  schemaVersion: z.literal(1),
  sourceType: z.enum(SOURCE_TYPES),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  rightsNotes: z.string().max(2000).optional(),
  questions: z.array(z.unknown()).min(1).max(500),
});
export const importStatusResponse = z.object({
  importId: uuid,
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  totalItems: z.number().int(),
  createdCount: z.number().int(),
  duplicateCount: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), code: z.string(), message: z.string() })),
});

export const ALLOWED_ASSET_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const uploadIntentBody = z.strictObject({
  mime: z.enum(ALLOWED_ASSET_MIME),
  byteSize: z.number().int().min(1).max(MAX_ASSET_BYTES),
  checksum: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a SHA-256 hex digest'),
  altText: z.string().trim().min(1).max(500),
});
export const uploadIntentResponse = z.object({
  assetId: uuid,
  uploadUrl: z.string(),
  uploadMethod: z.literal('PUT'),
  expiresAt: isoDateTime,
});
export const assetResponse = z.object({
  assetId: uuid,
  status: z.enum(['pending', 'ready']),
  mime: z.string(),
  byteSize: z.number().int(),
});

export const REPORT_STATUSES = ['open', 'in_progress', 'resolved', 'dismissed'] as const;
export const adminReportsQuery = cursorQuery.extend({
  status: z.enum(REPORT_STATUSES).optional(),
});
export const adminReportSchema = z.object({
  id: uuid,
  category: z.enum(REPORT_CATEGORIES),
  versionId: uuid.nullable(),
  message: z.string().nullable(),
  status: z.enum(REPORT_STATUSES),
  assignedTo: uuid.nullable(),
  resolution: z.string().nullable(),
  createdAt: isoDateTime,
});
export const adminReportsResponse = z.object({
  items: z.array(adminReportSchema),
  nextCursor: z.string().nullable(),
});
export const updateReportBody = z.strictObject({
  status: z.enum(REPORT_STATUSES).optional(),
  assignToSelf: z.boolean().optional(),
  resolution: z.string().trim().max(2000).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const adminMetricsQuery = z.object({ from: localDate, to: localDate });
export const adminMetricsResponse = z.object({
  from: localDate,
  to: localDate,
  childrenCreated: z.number().int(),
  activated: z.number().int(),
  sessionsCompleted: z.number().int(),
  answersRecorded: z.number().int(),
  openReports: z.number().int(),
  contentInventory: z.array(
    z.object({ grade: gradeSchema, published: z.number().int(), status: z.string() }),
  ),
  jobs: z.object({ pending: z.number().int(), dead: z.number().int() }),
  notes: z.array(z.string()),
});

export const adminAuditQuery = cursorQuery.extend({
  targetType: z.string().max(40).optional(),
  targetId: uuid.optional(),
});
export const adminAuditResponse = z.object({
  items: z.array(
    z.object({
      id: uuid,
      actor: z.string(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string().nullable(),
      reason: z.string().nullable(),
      metadata: z.record(z.string(), z.unknown()),
      occurredAt: isoDateTime,
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const staffRoleBody = z.strictObject({
  accountId: uuid,
  role: z.enum(STAFF_ROLES),
  active: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export const staffListResponse = z.object({
  staff: z.array(z.object({ accountId: uuid, role: z.enum(STAFF_ROLES), active: z.boolean() })),
});

export const adminTopicsResponse = z.object({
  topics: z.array(topicSummarySchema.extend({ parentId: uuid.nullable(), active: z.boolean() })),
});
export const createTopicBody = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  displayKey: z.string().min(1).max(100),
  parentId: uuid.optional(),
});

export { importQuestionSchema };
