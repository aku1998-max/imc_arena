/** Platform-independent API client (no React Native imports) so it can be unit tested. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never reached the server or the response was lost: safe to retry with the same key. */
export class NetworkError extends Error {
  constructor(message = 'No connection') {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  adultGrant?: string;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: RequestOptions,
  ): Promise<T>;
}

export function createApiClient(deps: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  onUnauthenticated?: () => void;
  timeoutMs?: number;
}): ApiClient {
  const f = deps.fetchImpl ?? fetch;
  return {
    async request<T>(
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      path: string,
      opts: RequestOptions = {},
    ) {
      const token = await deps.getToken();
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
      if (opts.adultGrant) headers['x-adult-grant'] = opts.adultGrant;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
      let res: Response;
      try {
        res = await f(`${deps.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: opts.signal ?? controller.signal,
        });
      } catch {
        throw new NetworkError();
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 204) return undefined as T;
      type Envelope = { data?: T; error?: { code: string; message: string } };
      const json = await res.json().then(
        (v) => v as Envelope,
        () => null,
      );
      if (json === null && res.ok) throw new NetworkError('Incomplete response');
      if (!res.ok || !json || json.error) {
        const code = json?.error?.code ?? 'INTERNAL';
        if (res.status === 401) deps.onUnauthenticated?.();
        const retry = res.headers.get('retry-after');
        throw new ApiError(
          res.status,
          code,
          json?.error?.message ?? `Request failed (${res.status})`,
          retry ? Number(retry) : null,
        );
      }
      return json.data as T;
    },
  };
}

/** Messages suitable for children: short, calm, no technical detail. */
export function friendlyMessage(err: unknown): string {
  if (err instanceof NetworkError)
    return 'No connection. We will try again when you are back online.';
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'CONTENT_UNAVAILABLE':
        return 'Practice is not ready yet. Please try again later.';
      case 'ENTITLEMENT_REQUIRED':
        return 'Ask a parent about unlocking this practice.';
      case 'UNAUTHENTICATED':
        return 'Please ask a parent to sign in again.';
      case 'RATE_LIMITED':
        return 'Too fast! Please wait a moment.';
      case 'SUBMISSIONS_PAUSED':
      case 'FEATURE_DISABLED':
        return err.message;
      default:
        return err.status >= 500 ? 'Something went wrong. Please try again.' : err.message;
    }
  }
  return 'Something went wrong. Please try again.';
}
