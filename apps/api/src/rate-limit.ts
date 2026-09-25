/**
 * In-process fixed-window limiter. Adequate for the single API instance of V1; replace with a
 * shared store before running multiple instances (docs/decisions.md, D-018).
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /** Records a hit; returns null when allowed or the Retry-After seconds when limited. */
  hit(key: string, limit: { max: number; windowSeconds: number }, now = Date.now()): number | null {
    const windowMs = limit.windowSeconds * 1000;
    const w = this.windows.get(key);
    if (!w || now - w.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.sweep(now, windowMs);
      return null;
    }
    w.count++;
    if (w.count <= limit.max) return null;
    return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
  }

  private sweep(now: number, windowMs: number) {
    for (const [k, w] of this.windows) if (now - w.start >= windowMs) this.windows.delete(k);
  }
}
