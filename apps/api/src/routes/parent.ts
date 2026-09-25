import {
  adultGrantBody,
  adultGrantResponse,
  childSessionResponse,
  consentBody,
  consentsResponse,
  createChildSessionBody,
  createStudentBody,
  deletionBody,
  deletionResponse,
  devicesResponse,
  entitlementsResponse,
  exportBody,
  exportResponse,
  idParams,
  purchaseIntentBody,
  purchaseIntentResponse,
  studentProfileSchema,
  studentsResponse,
  updateStudentBody,
} from '@imc/contracts';
import { withTx } from '@imc/db';
import {
  accountsService,
  billingService,
  DomainError,
  identity,
  productDefaults,
} from '@imc/domain';
import { z } from 'zod';
import { isFreshAdultAuth, type Principal } from '../auth.js';
import { route, type AnyRoute } from '../http.js';

type Adult = Extract<Principal, { type: 'adult' }>;
const GRANT_HEADER = 'x-adult-grant';

export const parentRoutes: AnyRoute[] = [
  route({
    method: 'POST',
    url: '/v1/students',
    auth: 'adult',
    summary: 'Create a child profile owned by the signed-in adult',
    tags: ['parent'],
    body: createStudentBody,
    response: studentProfileSchema,
    successStatus: 201,
    idempotency: 'optional',
    handler: async ({ body, tx }) => accountsService.createStudent(tx, body),
  }),

  route({
    method: 'GET',
    url: '/v1/students',
    auth: 'adult',
    summary: 'List child profiles managed by the signed-in adult',
    tags: ['parent'],
    response: studentsResponse,
    handler: async ({ tx }) => ({ students: await accountsService.listStudents(tx) }),
  }),

  route({
    method: 'PATCH',
    url: '/v1/students/:id',
    auth: 'adult',
    summary: 'Update a child profile (grade/timezone are parent-mode settings)',
    tags: ['parent'],
    params: idParams,
    body: updateStudentBody,
    response: studentProfileSchema,
    handler: async ({ params, body, tx }) => accountsService.updateStudent(tx, params.id, body),
  }),

  route({
    method: 'POST',
    url: '/v1/adult-grants',
    auth: 'adult',
    summary: 'Exchange a fresh OTP sign-in for a short-lived, single-use, action-scoped grant',
    tags: ['parent'],
    body: adultGrantBody,
    response: adultGrantResponse,
    successStatus: 201,
    rateLimit: { max: 10, windowSeconds: 900 },
    handler: async ({ principal, body, tx }) => {
      const claims = (principal as Adult).claims;
      if (!isFreshAdultAuth(claims, productDefaults.adultGrantMinutes * 60)) {
        throw new DomainError(
          'REAUTH_REQUIRED',
          'Please verify your email code again to continue.',
        );
      }
      return identity.createAdultGrant(tx, body);
    },
  }),

  route({
    method: 'POST',
    url: '/v1/students/:id/child-sessions',
    auth: 'adult',
    summary: 'Issue a child-mode session token for one device (shown once)',
    tags: ['parent'],
    params: idParams,
    body: createChildSessionBody,
    response: childSessionResponse,
    successStatus: 201,
    rateLimit: { max: 10, windowSeconds: 3600 },
    handler: async ({ params, body, tx }) =>
      identity.createChildSession(tx, { studentId: params.id, deviceLabel: body.deviceLabel }),
  }),

  route({
    method: 'GET',
    url: '/v1/students/:id/devices',
    auth: 'adult',
    summary: 'Child-mode device sessions for a child profile',
    tags: ['parent'],
    params: idParams,
    response: devicesResponse,
    handler: async ({ params, tx }) => ({ devices: await identity.listDevices(tx, params.id) }),
  }),

  route({
    method: 'DELETE',
    url: '/v1/child-sessions/:id',
    auth: 'adult',
    summary: 'Revoke a child-mode device session immediately',
    tags: ['parent'],
    params: idParams,
    successStatus: 204,
    handler: async ({ params, tx }) => {
      await identity.revokeChildSession(tx, params.id);
      return { status: 204, data: null };
    },
  }),

  route({
    method: 'POST',
    url: '/v1/consents',
    auth: 'adult',
    summary: 'Grant or withdraw consent for a purpose',
    tags: ['parent'],
    body: consentBody,
    response: consentsResponse,
    successStatus: 201,
    handler: async ({ body, tx }) => ({ consents: await accountsService.recordConsent(tx, body) }),
  }),

  route({
    method: 'GET',
    url: '/v1/consents',
    auth: 'adult',
    summary: 'Consent records for the signed-in adult',
    tags: ['parent'],
    response: consentsResponse,
    handler: async ({ tx }) => ({ consents: await accountsService.listConsents(tx) }),
  }),

  route({
    method: 'POST',
    url: '/v1/exports',
    auth: 'adult',
    summary: "Request an export of a child's data (requires X-Adult-Grant)",
    tags: ['parent'],
    body: exportBody,
    response: exportResponse,
    successStatus: 202,
    requestHeaders: [GRANT_HEADER],
    handler: async ({ body, tx, header }) =>
      accountsService.requestExport(tx, { studentId: body.studentId, grant: header(GRANT_HEADER) }),
  }),

  route({
    method: 'GET',
    url: '/v1/exports/:id',
    auth: 'adult',
    summary: 'Export status and a short-lived download URL when ready',
    tags: ['parent'],
    params: idParams,
    response: exportResponse,
    handler: async ({ params, tx, deps }) =>
      accountsService.getExport(tx, params.id, (key) =>
        deps.storage.signedDownloadUrl(key, productDefaults.signedUrlSeconds),
      ),
  }),

  route({
    method: 'POST',
    url: '/v1/deletion-requests',
    auth: 'adult',
    summary: 'Delete a child profile or the whole account (requires X-Adult-Grant)',
    tags: ['parent'],
    body: deletionBody,
    response: deletionResponse,
    successStatus: 202,
    requestHeaders: [GRANT_HEADER],
    handler: async ({ body, tx, header }) =>
      accountsService.requestDeletion(
        tx,
        body.scope === 'student'
          ? { scope: 'student', studentId: body.studentId, grant: header(GRANT_HEADER) }
          : { scope: 'account', accountId: body.accountId, grant: header(GRANT_HEADER) },
      ),
  }),

  route({
    method: 'POST',
    url: '/v1/billing/purchase-intents',
    auth: 'adult',
    summary: 'Bind adult, child and product before a store purchase (requires X-Adult-Grant)',
    tags: ['billing'],
    body: purchaseIntentBody,
    response: purchaseIntentResponse,
    successStatus: 201,
    requestHeaders: [GRANT_HEADER],
    handler: async ({ body, tx, deps, config, header }) =>
      billingService.createPurchaseIntent(tx, deps.billing, config.BILLING_PRODUCT_IDS, {
        studentId: body.studentId,
        productId: body.productId,
        grant: header(GRANT_HEADER),
      }),
  }),

  route({
    method: 'POST',
    url: '/v1/billing/restore',
    auth: 'adult',
    summary: 'Re-verify provider state and restore original entitlement bindings',
    tags: ['billing'],
    body: z.object({}).strict(),
    response: entitlementsResponse,
    transaction: false,
    rateLimit: { max: 10, windowSeconds: 600 },
    handler: async ({ principal, deps }) => {
      const p = principal as Adult;
      const ctx = { type: 'adult' as const, accountId: p.accountId };
      const enabled = await withTx(
        deps.pool,
        ctx,
        async (tx) => (await billingService.listEntitlements(tx, deps.billing)).billingEnabled,
      );
      if (!enabled) throw new DomainError('FEATURE_DISABLED', 'Purchases are not available yet.');
      await billingService.restorePurchases(deps.pool, deps.billing, p.accountId);
      return withTx(deps.pool, ctx, (tx) => billingService.listEntitlements(tx, deps.billing));
    },
  }),

  route({
    method: 'GET',
    url: '/v1/billing/entitlements',
    auth: 'adult',
    summary: 'Entitlements for child profiles managed by the adult',
    tags: ['billing'],
    response: entitlementsResponse,
    handler: async ({ tx, deps }) => billingService.listEntitlements(tx, deps.billing),
  }),
];
