import { seededRandom, shuffle } from './random.js';

export interface SelectionCandidate {
  questionId: string;
  versionId: string;
  topicId: string;
  difficulty: number;
}

export interface SelectionInput {
  candidates: readonly SelectionCandidate[];
  /** Question identities seen recently; avoided where inventory allows. */
  recent: ReadonlySet<string>;
  count: number;
  mix: Record<1 | 2 | 3, number>;
  seed: string;
}

export type SelectionResult =
  | { ok: true; picks: SelectionCandidate[]; relaxed: Array<'difficulty' | 'recent'> }
  | { ok: false; available: number };

/** Difficulty slots for `count` items, scaled from the configured mix. */
export function difficultySlots(count: number, mix: Record<1 | 2 | 3, number>): number[] {
  const total = mix[1] + mix[2] + mix[3];
  const slots: number[] = [];
  let assigned = 0;
  for (const d of [1, 2, 3] as const) {
    const n = d === 3 ? count - assigned : Math.round((mix[d] / total) * count);
    const take = Math.max(0, Math.min(n, count - assigned));
    for (let i = 0; i < take; i++) slots.push(d);
    assigned += take;
  }
  return slots;
}

/**
 * Selects `count` distinct question identities. Preferences, in the order they are relaxed:
 * 1) exact difficulty per slot, 2) not seen recently. Topic spread is preferred throughout.
 * Publication state, rights, grade and locale are hard filters applied before this function and
 * are never relaxed. Never pads with duplicates: fewer eligible identities means failure.
 */
export function selectQuestions(input: SelectionInput): SelectionResult {
  const byQuestion = new Map<string, SelectionCandidate>();
  for (const c of [...input.candidates].sort((a, b) => a.questionId.localeCompare(b.questionId))) {
    if (!byQuestion.has(c.questionId)) byQuestion.set(c.questionId, c);
  }
  const rand = seededRandom(input.seed);
  const pool = shuffle([...byQuestion.values()], rand);
  if (pool.length < input.count) return { ok: false, available: pool.length };

  const picked = new Set<string>();
  const topicCounts = new Map<string, number>();
  const picks: Array<{ c: SelectionCandidate; slot: number }> = [];
  const relaxed = new Set<'difficulty' | 'recent'>();

  const take = (
    slot: number,
    accept: (c: SelectionCandidate) => boolean,
    distance: (c: SelectionCandidate) => number,
  ): boolean => {
    let best: SelectionCandidate | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const c of pool) {
      if (picked.has(c.questionId) || !accept(c)) continue;
      // Lower is better: closeness to the slot difficulty first, then topic spread.
      const score = distance(c) * 100 + (topicCounts.get(c.topicId) ?? 0);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (!best) return false;
    picked.add(best.questionId);
    topicCounts.set(best.topicId, (topicCounts.get(best.topicId) ?? 0) + 1);
    picks.push({ c: best, slot });
    return true;
  };

  const slots = difficultySlots(input.count, input.mix);
  const notRecent = (c: SelectionCandidate) => !input.recent.has(c.questionId);
  const exact = (slot: number) => (c: SelectionCandidate) => c.difficulty === slot;
  const nearest = (slot: number) => (c: SelectionCandidate) => Math.abs(c.difficulty - slot);

  // Pass 1: exact difficulty, not recent.
  const missing: number[] = [];
  for (const slot of slots) {
    if (
      !take(
        slot,
        (c) => exact(slot)(c) && notRecent(c),
        () => 0,
      )
    )
      missing.push(slot);
  }
  // Pass 2: relax difficulty, keep recency preference.
  const stillMissing: number[] = [];
  for (const slot of missing) {
    if (take(slot, notRecent, nearest(slot))) relaxed.add('difficulty');
    else stillMissing.push(slot);
  }
  // Pass 3: relax recency, prefer exact then nearest difficulty.
  for (const slot of stillMissing) {
    if (take(slot, () => true, nearest(slot))) {
      relaxed.add('recent');
      if (picks[picks.length - 1]!.c.difficulty !== slot) relaxed.add('difficulty');
    }
  }
  if (picks.length < input.count) return { ok: false, available: pool.length };

  const ordered = picks
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => a.c.difficulty - b.c.difficulty || a.i - b.i)
    .map((p) => p.c);
  return { ok: true, picks: ordered, relaxed: [...relaxed] };
}
