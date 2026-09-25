import { constantTimeEqual } from '../crypto.js';

export function verifyAuthorizationHeader(expected: string, header: string | undefined): boolean {
  if (!expected || !header) return false;
  const value = header.startsWith('Bearer ') ? header.slice(7) : header;
  return constantTimeEqual(value, expected);
}

/** Parses the RevenueCat webhook envelope: {"api_version": "...", "event": {...}}. */
export function parseRevenueCatWebhook(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const event = (payload as { event?: Record<string, unknown> }).event;
  if (!event || typeof event !== 'object') return null;
  const id = event.id;
  const type = event.type;
  if (typeof id !== 'string' || typeof type !== 'string' || id.length > 200) return null;
  const ids = new Set<string>();
  for (const key of ['app_user_id', 'original_app_user_id']) {
    const v = event[key];
    if (typeof v === 'string') ids.add(v);
  }
  for (const key of ['aliases', 'transferred_from', 'transferred_to']) {
    const v = event[key];
    if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') ids.add(x);
  }
  return {
    eventId: id,
    eventType: type,
    // Only our own opaque customer ids are meaningful; anonymous RevenueCat ids are ignored.
    billingCustomerIds: [...ids].filter((x) => x.startsWith('bc_')),
  };
}
