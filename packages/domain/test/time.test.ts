import { describe, expect, it } from 'vitest';
import { canonicalJson, constantTimeEqual, randomToken } from '../src/crypto.js';
import { addDays, daysBetween, localDateIn, weekStart } from '../src/time.js';

describe('time', () => {
  it('computes the local date in the child timezone', () => {
    const at = new Date('2026-09-25T23:30:00Z');
    expect(localDateIn('Europe/London', at)).toBe('2026-09-26');
    expect(localDateIn('America/Los_Angeles', at)).toBe('2026-09-25');
    expect(localDateIn('Asia/Tokyo', at)).toBe('2026-09-26');
  });
  it('handles weeks and ranges', () => {
    expect(weekStart('2026-09-27')).toBe('2026-09-21');
    expect(weekStart('2026-09-21')).toBe('2026-09-21');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });
});

describe('crypto', () => {
  it('issues 256-bit tokens and refuses shorter ones', () => {
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32);
    expect(() => randomToken(16)).toThrow();
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
  it('constant-time comparison', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
