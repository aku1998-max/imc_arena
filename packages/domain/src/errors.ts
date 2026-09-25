import type { ErrorCode } from '@imc/contracts';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 403,
  FORBIDDEN: 403,
  ENTITLEMENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  ANSWER_ALREADY_SUBMITTED: 409,
  RATE_LIMITED: 429,
  CONTENT_UNAVAILABLE: 503,
  SUBMISSIONS_PAUSED: 503,
  FEATURE_DISABLED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** An expected, user-safe failure. Messages must never contain SQL, tokens or stack traces. */
export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Resource') => new DomainError('NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'This action is not allowed.') =>
  new DomainError('FORBIDDEN', message);
export const invalidState = (message: string) => new DomainError('INVALID_STATE', message);
export const validation = (message: string, details?: unknown) =>
  new DomainError('VALIDATION_FAILED', message, details);
