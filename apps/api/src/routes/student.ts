import {
  answerBody,
  answerResponse,
  CAPABILITIES,
  cursorQuery,
  homeResponse,
  idParams,
  itemResponse,
  meResponse,
  mistakesResponse,
  progressQuery,
  progressResponse,
  reportBody,
  reportResponse,
  sessionStateResponse,
  startSessionBody,
  startSessionResponse,
  topicsQuery,
  topicsResponse,
} from '@imc/contracts';
import { accounts } from '@imc/db';
import {
  accountsService,
  notFound,
  operationsService,
  practiceService,
  progressService,
} from '@imc/domain';
import { z } from 'zod';
import type { Principal } from '../auth.js';
import { route, type AnyRoute } from '../http.js';

const itemParams = z.object({ sid: z.uuid(), iid: z.uuid() });

/** A child token may only address its own student id. */
function assertOwnStudent(principal: Principal | null, studentId: string) {
  if (principal?.type === 'child' && principal.studentId !== studentId)
    throw notFound('Child profile');
}

export const studentRoutes: AnyRoute[] = [
  route({
    method: 'GET',
    url: '/v1/me',
    auth: 'childOrAdult',
    summary: 'Current principal, capabilities and own safe profile',
    tags: ['student'],
    response: meResponse,
    handler: async ({ principal, tx }) => {
      if (principal!.type === 'child') {
        const student = await accounts.findStudent(tx, principal!.studentId);
        if (!student) throw notFound('Child profile');
        const pro = await practiceService.hasPro(tx, student.id);
        const caps: string[] = [
          CAPABILITIES.practiceDaily,
          CAPABILITIES.progressBasic,
          CAPABILITIES.reportsCreate,
        ];
        if (pro)
          caps.push(
            CAPABILITIES.practiceTopic,
            CAPABILITIES.practiceMistakes,
            CAPABILITIES.progressHistory,
          );
        return {
          kind: 'child' as const,
          capabilities: caps,
          student: accountsService.toStudentProfile(student),
        };
      }
      const p = principal as Extract<Principal, { type: 'adult' }>;
      const account = await accounts.findAccount(tx, p.accountId);
      return {
        kind: 'adult' as const,
        capabilities: [
          CAPABILITIES.parentProfiles,
          CAPABILITIES.parentDevices,
          CAPABILITIES.parentConsent,
          CAPABILITIES.parentBilling,
          CAPABILITIES.reportsCreate,
        ],
        account: { id: p.accountId, preferredLocale: account?.preferredLocale ?? 'en' },
      };
    },
  }),

  route({
    method: 'GET',
    url: '/v1/students/:id/home',
    auth: 'childOrAdult',
    summary: 'Daily status, active sessions, suggested topic and recent activity',
    tags: ['student'],
    params: idParams,
    response: homeResponse,
    handler: async ({ principal, params, tx }) => {
      assertOwnStudent(principal, params.id);
      return progressService.getHome(tx, params.id);
    },
  }),

  route({
    method: 'GET',
    url: '/v1/topics',
    auth: 'childOrAdult',
    summary: 'Topics for a grade with eligible inventory state',
    tags: ['student'],
    query: topicsQuery,
    response: topicsResponse,
    handler: async ({ principal, query, tx }) => {
      let locale = 'en';
      if (principal?.type === 'child') {
        locale = (await accounts.findStudent(tx, principal.studentId))?.locale ?? 'en';
      }
      return { topics: await progressService.listTopicsForGrade(tx, query.grade, locale) };
    },
  }),

  route({
    method: 'POST',
    url: '/v1/students/:id/sessions',
    auth: 'child',
    summary: 'Start (or resume) a practice session',
    tags: ['student'],
    params: idParams,
    body: startSessionBody,
    response: startSessionResponse,
    idempotency: 'required',
    rateLimit: { max: 30, windowSeconds: 60 },
    handler: async ({ principal, params, body, tx, deps }) => {
      assertOwnStudent(principal, params.id);
      const result = await practiceService.startSession(tx, deps, body);
      return { status: result.status === 'ready' && result.created ? 201 : 200, data: result };
    },
  }),

  route({
    method: 'GET',
    url: '/v1/sessions/:id',
    auth: 'childOrAdult',
    summary: 'Owned session state, ordered items, submitted results and next item',
    tags: ['student'],
    params: idParams,
    response: sessionStateResponse,
    handler: async ({ params, tx }) => practiceService.getSessionState(tx, params.id),
  }),

  route({
    method: 'GET',
    url: '/v1/sessions/:sid/items/:iid',
    auth: 'childOrAdult',
    summary: 'Safe question DTO; solution only after an answer is recorded',
    tags: ['student'],
    params: itemParams,
    response: itemResponse,
    handler: async ({ params, tx, deps }) =>
      practiceService.getItem(tx, deps.storage, params.sid, params.iid),
  }),

  route({
    method: 'POST',
    url: '/v1/sessions/:sid/items/:iid/answer',
    auth: 'child',
    summary: 'Submit an answer (idempotent)',
    tags: ['student'],
    params: itemParams,
    body: answerBody,
    response: answerResponse,
    idempotency: 'optional',
    rateLimit: { max: 60, windowSeconds: 60 },
    handler: async ({ params, body, tx, deps }) =>
      practiceService.submitAnswer(tx, deps.storage, {
        sessionId: params.sid,
        itemId: params.iid,
        optionId: body.optionId,
        responseMs: body.responseMs,
      }),
  }),

  route({
    method: 'GET',
    url: '/v1/students/:id/progress',
    auth: 'childOrAdult',
    summary: 'Bounded progress summary with first attempts and separate retries',
    tags: ['student'],
    params: idParams,
    query: progressQuery,
    response: progressResponse,
    handler: async ({ principal, params, query, tx }) => {
      assertOwnStudent(principal, params.id);
      return progressService.getProgress(tx, {
        studentId: params.id,
        from: query.from,
        to: query.to,
      });
    },
  }),

  route({
    method: 'GET',
    url: '/v1/students/:id/mistakes',
    auth: 'childOrAdult',
    summary: 'Unresolved mistakes (cursor pagination); no answer keys',
    tags: ['student'],
    params: idParams,
    query: cursorQuery,
    response: mistakesResponse,
    handler: async ({ principal, params, query, tx }) => {
      assertOwnStudent(principal, params.id);
      return practiceService.listMistakes(tx, {
        studentId: params.id,
        cursor: query.cursor,
        limit: query.limit,
      });
    },
  }),

  route({
    method: 'POST',
    url: '/v1/reports',
    auth: 'childOrAdult',
    summary: 'Report a problem with a question or the app',
    tags: ['student'],
    body: reportBody,
    response: reportResponse,
    successStatus: 201,
    rateLimit: { max: 10, windowSeconds: 3600 },
    handler: async ({ body, tx }) => operationsService.createReport(tx, body),
  }),
];
