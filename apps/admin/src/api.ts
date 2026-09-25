import type { ErrorEnvelope } from '@imc/contracts';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;
export function setTokenProvider(fn: () => Promise<string | null>) {
  tokenProvider = fn;
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const token = await tokenProvider();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { data: T } | ErrorEnvelope | null;
  if (!res.ok || !json || 'error' in json) {
    const err =
      json && 'error' in json ? json.error : { code: 'INTERNAL', message: `HTTP ${res.status}` };
    throw new ApiError(
      res.status,
      err.code,
      err.message,
      'details' in err ? err.details : undefined,
      json && 'requestId' in json ? json.requestId : undefined,
    );
  }
  return json.data;
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: Array<{ message: string }> } | undefined)?.issues;
    const extra = Array.isArray(issues) ? ` ${issues.map((i) => i.message).join(' ')}` : '';
    return `${err.message}${extra}${err.requestId ? ` (request ${err.requestId})` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}
