import type { ApiClient } from '../lib/api-client';

export type StartResult =
  | {
      status: 'ready';
      sessionId: string;
      itemCount: number;
      nextItemId: string | null;
      created: boolean;
    }
  | { status: 'empty'; reason: 'NO_MISTAKES' };

export function startSession(
  api: ApiClient,
  studentId: string,
  idempotencyKey: string,
  body: { mode: 'daily' | 'topic' | 'mistakes'; topicId?: string },
) {
  return api.request<StartResult>('POST', `/v1/students/${studentId}/sessions`, {
    body,
    idempotencyKey,
  });
}
