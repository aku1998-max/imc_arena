import {
  adminAuditQuery,
  adminAuditResponse,
  adminMetricsQuery,
  adminMetricsResponse,
  adminQuestionsQuery,
  adminQuestionsResponse,
  adminReportSchema,
  adminReportsQuery,
  adminReportsResponse,
  adminTopicsResponse,
  adminVersionResponse,
  assetResponse,
  createQuestionBody,
  createTopicBody,
  idParams,
  importBody,
  importStatusResponse,
  retireBody,
  reviewBody,
  staffListResponse,
  staffRoleBody,
  STAFF_ROLES,
  updateQuestionRightsBody,
  updateReportBody,
  uploadIntentBody,
  uploadIntentResponse,
  versionContentBody,
  versionStateResponse,
} from '@imc/contracts';
import { content } from '@imc/db';
import { contentService, operationsService } from '@imc/domain';
import { z } from 'zod';
import type { Principal } from '../auth.js';
import { route, type AnyRoute } from '../http.js';

type Staff = Extract<Principal, { type: 'staff' }>;

export const adminRoutes: AnyRoute[] = [
  route({
    method: 'GET',
    url: '/v1/admin/me',
    auth: 'staff',
    summary: 'Signed-in staff member and active roles',
    tags: ['admin'],
    response: z.object({ accountId: z.uuid(), roles: z.array(z.enum(STAFF_ROLES)) }),
    handler: async ({ principal }) => {
      const p = principal as Staff;
      return { accountId: p.accountId, roles: p.roles as Array<(typeof STAFF_ROLES)[number]> };
    },
  }),

  route({
    method: 'GET',
    url: '/v1/admin/topics',
    auth: 'staff',
    summary: 'All topics',
    tags: ['admin'],
    response: adminTopicsResponse,
    handler: async ({ tx }) => ({ topics: await content.listTopics(tx, false) }),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/topics',
    auth: 'staff',
    summary: 'Create or rename a topic (administrator)',
    tags: ['admin'],
    body: createTopicBody,
    response: adminTopicsResponse.shape.topics.element,
    successStatus: 201,
    handler: async ({ body, tx }) => contentService.createTopic(tx, body),
  }),

  route({
    method: 'GET',
    url: '/v1/admin/questions',
    auth: 'staff',
    summary:
      'Question versions list; reviewable=true lists versions awaiting review by someone else',
    tags: ['admin'],
    query: adminQuestionsQuery,
    response: adminQuestionsResponse,
    handler: async ({ query, tx }) => contentService.listVersionsForStaff(tx, query),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/questions',
    auth: 'staff',
    summary: 'Create a question with a first draft version',
    tags: ['admin'],
    body: createQuestionBody,
    response: z.object({ questionId: z.uuid(), versionId: z.uuid() }),
    successStatus: 201,
    idempotency: 'optional',
    handler: async ({ body, tx }) => contentService.createQuestion(tx, body),
  }),

  route({
    method: 'PATCH',
    url: '/v1/admin/questions/:id/rights',
    auth: 'staff',
    summary: 'Update rights status (administrator)',
    tags: ['admin'],
    params: idParams,
    body: updateQuestionRightsBody,
    successStatus: 204,
    handler: async ({ params, body, tx }) => {
      await contentService.updateRights(tx, params.id, body);
      return { status: 204, data: null };
    },
  }),

  route({
    method: 'POST',
    url: '/v1/admin/questions/:id/versions',
    auth: 'staff',
    summary: 'Create a correction draft from the latest published version',
    tags: ['admin'],
    params: idParams,
    response: versionStateResponse,
    successStatus: 201,
    handler: async ({ params, tx }) => contentService.createDraftFromLatest(tx, params.id),
  }),

  route({
    method: 'GET',
    url: '/v1/admin/versions/:id',
    auth: 'staff',
    summary: 'Full staff view of a version including key, reviews and publication issues',
    tags: ['admin'],
    params: idParams,
    response: adminVersionResponse,
    handler: async ({ params, tx, deps }) =>
      contentService.getVersionForStaff(tx, deps.storage, params.id),
  }),

  route({
    method: 'PATCH',
    url: '/v1/admin/versions/:id',
    auth: 'staff',
    summary: 'Edit a draft (edits to reviewed/approved content return it to draft)',
    tags: ['admin'],
    params: idParams,
    body: versionContentBody,
    response: versionStateResponse,
    handler: async ({ params, body, tx }) => contentService.updateVersion(tx, params.id, body),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/versions/:id/submit-review',
    auth: 'staff',
    summary: 'Submit a draft for independent review',
    tags: ['admin'],
    params: idParams,
    response: versionStateResponse,
    handler: async ({ params, tx }) => contentService.submitForReview(tx, params.id),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/versions/:id/review',
    auth: 'staff',
    summary: "Approve or request changes on another editor's version",
    tags: ['admin'],
    params: idParams,
    body: reviewBody,
    response: versionStateResponse,
    handler: async ({ params, body, tx }) => contentService.reviewVersion(tx, params.id, body),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/versions/:id/publish',
    auth: 'staff',
    summary: 'Publish an approved version whose content hash still matches (administrator)',
    tags: ['admin'],
    params: idParams,
    response: versionStateResponse,
    handler: async ({ params, tx }) => contentService.publishVersion(tx, params.id),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/versions/:id/retire',
    auth: 'staff',
    summary: 'Retire a published version from new selection (administrator)',
    tags: ['admin'],
    params: idParams,
    body: retireBody,
    response: versionStateResponse,
    handler: async ({ params, body, tx }) => contentService.retireVersion(tx, params.id, body),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/imports',
    auth: 'staff',
    summary: 'Import questions (JSON) into drafts; validated by a background job',
    tags: ['admin'],
    body: importBody,
    response: z.object({ importId: z.uuid() }),
    successStatus: 202,
    rateLimit: { max: 20, windowSeconds: 3600 },
    handler: async ({ body, tx }) => ({ importId: await contentService.createImport(tx, body) }),
  }),

  route({
    method: 'GET',
    url: '/v1/admin/imports/:id',
    auth: 'staff',
    summary: 'Import status with per-item errors',
    tags: ['admin'],
    params: idParams,
    response: importStatusResponse,
    handler: async ({ params, tx }) => contentService.getImport(tx, params.id),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/assets/upload-intent',
    auth: 'staff',
    summary: 'Declare an image upload and receive a short-lived signed upload URL',
    tags: ['admin'],
    body: uploadIntentBody,
    response: uploadIntentResponse,
    successStatus: 201,
    handler: async ({ body, tx, deps }) =>
      contentService.createUploadIntent(tx, deps.storage, body),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/assets/:id/complete',
    auth: 'staff',
    summary: 'Verify an uploaded image (size, checksum, file signature) and mark it ready',
    tags: ['admin'],
    params: idParams,
    response: assetResponse,
    handler: async ({ params, tx, deps }) => {
      const a = await contentService.completeAsset(tx, deps.storage, params.id);
      return { assetId: a.id, status: a.status, mime: a.mime, byteSize: a.byteSize };
    },
  }),

  route({
    method: 'GET',
    url: '/v1/admin/reports',
    auth: 'staff',
    summary: 'Support reports',
    tags: ['admin'],
    query: adminReportsQuery,
    response: adminReportsResponse,
    handler: async ({ query, tx }) => operationsService.listReports(tx, query),
  }),

  route({
    method: 'PATCH',
    url: '/v1/admin/reports/:id',
    auth: 'staff',
    summary: 'Triage a support report (audited, reason required)',
    tags: ['admin'],
    params: idParams,
    body: updateReportBody,
    response: adminReportSchema,
    handler: async ({ params, body, tx }) => operationsService.updateReport(tx, params.id, body),
  }),

  route({
    method: 'GET',
    url: '/v1/admin/metrics',
    auth: 'staff',
    summary: 'Operational metrics with explicit denominators (administrator)',
    tags: ['admin'],
    query: adminMetricsQuery,
    response: adminMetricsResponse,
    handler: async ({ query, tx }) => operationsService.metrics(tx, query),
  }),

  route({
    method: 'GET',
    url: '/v1/admin/audit',
    auth: 'staff',
    summary: 'Append-only audit history',
    tags: ['admin'],
    query: adminAuditQuery,
    response: adminAuditResponse,
    handler: async ({ query, tx }) => operationsService.listAuditEvents(tx, query),
  }),

  route({
    method: 'GET',
    url: '/v1/admin/staff',
    auth: 'staff',
    summary: 'Staff roles (administrator)',
    tags: ['admin'],
    response: staffListResponse,
    handler: async ({ tx }) => operationsService.listStaff(tx),
  }),

  route({
    method: 'POST',
    url: '/v1/admin/staff',
    auth: 'staff',
    summary: 'Grant or deactivate a staff role (administrator, audited)',
    tags: ['admin'],
    body: staffRoleBody,
    successStatus: 204,
    handler: async ({ body, tx }) => {
      await operationsService.setStaffRole(tx, body);
      return { status: 204, data: null };
    },
  }),

  route({
    method: 'POST',
    url: '/v1/admin/flags',
    auth: 'staff',
    summary: 'Toggle an operational flag (billing, reminders, new_sessions, answer_submissions)',
    tags: ['admin'],
    body: z.strictObject({
      key: z.string().max(40),
      enabled: z.boolean(),
      reason: z.string().trim().min(3).max(500),
    }),
    successStatus: 204,
    handler: async ({ body, tx }) => {
      await operationsService.setFlag(tx, body);
      return { status: 204, data: null };
    },
  }),
];
