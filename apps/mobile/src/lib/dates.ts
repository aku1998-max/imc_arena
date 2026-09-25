/** YYYY-MM-DD in the device's local calendar (display only; the server owns daily dates). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function lastNDays(n: number, now = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - (n - 1));
  return { from: isoDate(from), to: isoDate(now) };
}

export function percent(numerator: number, denominator: number): string | null {
  if (denominator === 0) return null;
  return `${Math.round((numerator / denominator) * 100)}%`;
}
