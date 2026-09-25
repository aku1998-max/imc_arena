import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit cryptographically random opaque token, base64url encoded. */
export function randomToken(bytes = 32): string {
  if (bytes < 32) throw new Error('tokens must carry at least 256 bits');
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against itself to keep timing independent of where the mismatch is.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Deterministic JSON (sorted keys) for hashing request bodies and content. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
