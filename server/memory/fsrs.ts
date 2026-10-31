/**
 * FSRS-based memory strength (the power-law curve Anki trains).
 *
 * Two strengths are kept apart (Bjork & Bjork, 1992):
 * - `storage`: never decreases; the true measure of persistence.
 * - `retrieval`: falls over time, reset on every recall.
 *
 * `surprise`: unexpected information decays more slowly (plast-mem).
 */

/**
 * FSRS curve (power law). Same shape as the Anki/FSRS family:
 *   R(S) = 0.9, R(9S) = 0.5
 * We use a fixed half-life instead of weights: without trained parameters
 * this is the most conservative and predictable behavior.
 */
export const FSRS_DECAY = -1;
export const FSRS_FACTOR = 1 / 9;

export const DEFAULT_STABILITY = 30; // days
export const DEFAULT_DIFFICULTY = 5; // 1..10
export const DEFAULT_STORAGE = 1;
export const MAX_STORAGE = 20;

/** Probability of recall after t days. R(S) = 0.9, R(9S) = 0.5. */
export function retrievability(elapsedDays: number, stability: number): number {
  const s = Math.max(0.1, stability);
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (FSRS_FACTOR * t) / s, FSRS_DECAY);
}

/**
 * New stability after a successful recall.
 * Hard notes (high D) and those recalled at low R gain more.
 */
export function nextStability(
  stability: number,
  difficulty: number,
  r: number,
  grade: 'again' | 'hard' | 'good' | 'easy' = 'good',
): number {
  const s = Math.max(0.1, stability);
  const d = Math.min(10, Math.max(1, difficulty));
  const computed = 1 + 0.5 * (11 - d) * Math.pow(s, -0.2) * (Math.exp(0.2 * (1 - r)) - 1);
  // Keep the gain from dropping to 0 on same-day reviews: every successful review grows it a little.
  const gain = Math.max(1.05, computed);
  const gradeFactor = grade === 'easy' ? 1.3 : grade === 'hard' ? 1 : grade === 'again' ? 0 : 1;
  if (gradeFactor === 0) return Math.max(1, s * 0.5);
  return Math.min(36_500, Math.max(1, s * gain * gradeFactor));
}

/** A successful review lowers difficulty; correction/rejection raises it. */
export function nextDifficulty(difficulty: number, direction: 'easier' | 'harder'): number {
  const d = Math.min(10, Math.max(1, difficulty));
  return direction === 'easier' ? Math.max(1, d - 0.5) : Math.min(10, d + 1);
}

/** Initial stability of a new note (days): importance + surprise. */
export function initialStability(base: number, surprise = 0): number {
  const importance = 0.5 + Math.min(1, Math.max(0, base)) * 2.5;
  return importance * (1 + Math.min(1, Math.max(0, surprise)) * 0.5);
}

export type MemoryStrength = {
  /** 0..1 — current probability of recall. */
  retrieval: number;
  /** 1..20 — storage strength that never decreases. */
  storage: number;
  /** Combined score for ranking (0..1). */
  score: number;
};

/** Combined score used in search ranking: 0.7 retrieval + 0.3 storage. */
export function combinedStrength(elapsedDays: number, stability: number, storage: number): MemoryStrength {
  const retrieval = retrievability(elapsedDays, stability);
  const storageShare = Math.min(1, Math.max(0, storage) / 10);
  return {
    retrieval,
    storage,
    score: 0.7 * retrieval + 0.3 * storageShare,
  };
}

/**
 * Rule for descending into cold storage: retrieval has fallen AND it has not
 * been repeated enough. A note with `storage >= 3` never goes cold — heavily
 * recalled things are permanent.
 */
export function shouldGoDormant(retrieval: number, storage: number): boolean {
  return retrieval < 0.15 && storage < 3;
}

/** Surprise from 0..1 similarity: the more different the new information, the higher. */
export function surpriseFromSimilarity(bestSimilarity: number): number {
  return Math.min(1, Math.max(0, 1 - bestSimilarity));
}
