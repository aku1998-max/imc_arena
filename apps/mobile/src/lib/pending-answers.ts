import { ApiError, NetworkError, type ApiClient } from './api-client';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PendingAnswer {
  sessionId: string;
  itemId: string;
  optionId: string;
  idempotencyKey: string;
  responseMs?: number;
  queuedAt: string;
}

export type SubmitOutcome<R> =
  | { kind: 'graded'; result: R }
  | { kind: 'waiting'; pending: PendingAnswer }
  | { kind: 'conflict' }
  | { kind: 'error'; error: ApiError };

/**
 * Online-first answer submission. The app never grades locally: if the network fails, the answer
 * is kept with its idempotency key and resent later, and the UI shows "Waiting to sync" instead
 * of awarding anything. A resend with the same key returns the original server result.
 */
export class PendingAnswerQueue {
  constructor(
    private readonly store: KeyValueStore,
    private readonly scope: string,
  ) {}

  private get key() {
    return `imc.pending.${this.scope}`;
  }

  async get(): Promise<PendingAnswer | null> {
    const raw = await this.store.getItem(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingAnswer;
    } catch {
      await this.store.removeItem(this.key);
      return null;
    }
  }

  async clear() {
    await this.store.removeItem(this.key);
  }

  async submit<R>(client: ApiClient, answer: PendingAnswer): Promise<SubmitOutcome<R>> {
    const existing = await this.get();
    if (existing && existing.itemId !== answer.itemId) {
      // Resolve the queued request before permitting another answer.
      const flushed = await this.flush<R>(client);
      if (flushed?.kind === 'waiting') return flushed;
    }
    const same = existing && existing.itemId === answer.itemId ? existing : answer;
    await this.store.setItem(this.key, JSON.stringify(same));
    return this.send<R>(client, same);
  }

  /** Resends a queued answer (e.g. on reconnect or app start). */
  async flush<R>(client: ApiClient): Promise<SubmitOutcome<R> | null> {
    const pending = await this.get();
    if (!pending) return null;
    return this.send<R>(client, pending);
  }

  private async send<R>(client: ApiClient, p: PendingAnswer): Promise<SubmitOutcome<R>> {
    try {
      const result = await client.request<R>(
        'POST',
        `/v1/sessions/${p.sessionId}/items/${p.itemId}/answer`,
        {
          body: {
            optionId: p.optionId,
            ...(p.responseMs !== undefined ? { responseMs: p.responseMs } : {}),
          },
          idempotencyKey: p.idempotencyKey,
        },
      );
      await this.clear();
      return { kind: 'graded', result };
    } catch (err) {
      if (err instanceof NetworkError) return { kind: 'waiting', pending: p };
      if (err instanceof ApiError && err.status >= 500 && err.code !== 'SUBMISSIONS_PAUSED') {
        return { kind: 'waiting', pending: p };
      }
      await this.clear();
      if (err instanceof ApiError && err.code === 'ANSWER_ALREADY_SUBMITTED')
        return { kind: 'conflict' };
      if (err instanceof ApiError) return { kind: 'error', error: err };
      throw err;
    }
  }
}
