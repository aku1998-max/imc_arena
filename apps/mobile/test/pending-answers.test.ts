import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  friendlyMessage,
  NetworkError,
  type ApiClient,
} from '../src/lib/api-client';
import { PendingAnswerQueue, type KeyValueStore } from '../src/lib/pending-answers';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

const answer = (itemId = 'i1') => ({
  sessionId: 's1',
  itemId,
  optionId: 'b',
  idempotencyKey: `key-${itemId}-123456`,
  queuedAt: '2026-09-25T10:00:00Z',
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('api client', () => {
  it('sends bearer, idempotency and grant headers and unwraps the envelope', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const h = init!.headers as Record<string, string>;
      expect(h.authorization).toBe('Bearer tok');
      expect(h['idempotency-key']).toBe('k-12345678');
      expect(h['x-adult-grant']).toBe('g');
      return jsonResponse(200, { data: { ok: true }, requestId: 'r' });
    });
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(
      client.request('POST', '/x', { body: {}, idempotencyKey: 'k-12345678', adultGrant: 'g' }),
    ).resolves.toEqual({ ok: true });
  });

  it('maps errors, retry-after and unauthenticated callbacks', async () => {
    const onUnauth = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => null,
      onUnauthenticated: onUnauth,
      fetchImpl: (async () =>
        jsonResponse(401, {
          error: { code: 'UNAUTHENTICATED', message: 'x' },
          requestId: 'r',
        })) as typeof fetch,
    });
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalled();
    const limited = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => null,
      fetchImpl: (async () =>
        jsonResponse(
          429,
          { error: { code: 'RATE_LIMITED', message: 'slow' }, requestId: 'r' },
          { 'retry-after': '7' },
        )) as typeof fetch,
    });
    const err = (await limited.request('GET', '/x').catch((e: unknown) => e)) as ApiError;
    expect(err.retryAfterSeconds).toBe(7);
    expect(friendlyMessage(err)).toMatch(/wait/);
  });

  it('turns transport failures into NetworkError', async () => {
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => null,
      fetchImpl: (async () => {
        throw new TypeError('offline');
      }) as typeof fetch,
    });
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('pending answer queue', () => {
  it('keeps the answer and its key while offline, then resends with the same key', async () => {
    const store = memoryStore();
    const keys: string[] = [];
    let online = false;
    const client = {
      request: vi.fn(async (_m: string, _p: string, opts?: { idempotencyKey?: string }) => {
        keys.push(opts!.idempotencyKey!);
        if (!online) throw new NetworkError();
        return { correct: true };
      }),
    } as unknown as ApiClient;
    const q = new PendingAnswerQueue(store, 'student-1');
    const first = await q.submit(client, answer());
    expect(first.kind).toBe('waiting');
    expect(await q.get()).toMatchObject({ itemId: 'i1', idempotencyKey: 'key-i1-123456' });
    online = true;
    const flushed = await q.flush(client);
    expect(flushed).toEqual({ kind: 'graded', result: { correct: true } });
    expect(new Set(keys)).toEqual(new Set(['key-i1-123456']));
    expect(await q.get()).toBeNull();
  });

  it('resolves a queued answer before permitting an answer to another item', async () => {
    const store = memoryStore();
    const client = {
      request: vi.fn(async () => {
        throw new NetworkError();
      }),
    };
    const q = new PendingAnswerQueue(store, 'student-1');
    await q.submit(client, answer('i1'));
    const second = await q.submit(client, answer('i2'));
    expect(second).toMatchObject({ kind: 'waiting', pending: { itemId: 'i1' } });
  });

  it('drops the queue on a definitive conflict or client error', async () => {
    const store = memoryStore();
    const q = new PendingAnswerQueue(store, 'student-1');
    const conflict = {
      request: vi.fn(async () => {
        throw new ApiError(409, 'ANSWER_ALREADY_SUBMITTED', 'x');
      }),
    };
    expect((await q.submit(conflict, answer())).kind).toBe('conflict');
    expect(await q.get()).toBeNull();
    const server = {
      request: vi.fn(async () => {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'x');
      }),
    };
    expect((await q.submit(server, answer())).kind).toBe('waiting');
    expect(await q.get()).not.toBeNull();
  });

  it('scopes pending answers per child profile', async () => {
    const store = memoryStore();
    const client = {
      request: vi.fn(async () => {
        throw new NetworkError();
      }),
    };
    await new PendingAnswerQueue(store, 'a').submit(client, answer());
    expect(await new PendingAnswerQueue(store, 'b').get()).toBeNull();
  });
});
