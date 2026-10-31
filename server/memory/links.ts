/**
 * Hebbian link math: a link used together thickens, an unused one thins.
 *
 * Pure arithmetic — no clock, database or imports. `now`/`lastAt` come from the caller.
 * A link is never deleted: decay stops at the `LINK_FLOOR` floor.
 */

/** How much of the link's remaining headroom each repetition closes. */
export const LINK_GAIN = 0.15;

export const LINK_HALF_LIFE_DAYS = 30;

/** The floor where decay stops: a weak link is not deleted, only thinned. */
export const LINK_FLOOR = 0.05;

/** Context preload threshold. */
export const LINK_STRONG = 0.8;

const DAY_MS = 86_400_000;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

/** Hebbian: one repetition together thickens the link, never above 1. */
export function reinforce(weight: number, gain = LINK_GAIN): number {
  const w = clamp01(weight);
  return clamp01(w + clamp01(gain) * (1 - w));
}

/** An unused link thins over time; it never goes below the floor and is never deleted. */
export function decayedWeight(weight: number, lastAt: number, now: number): number {
  // Invalid timestamps and a clock that goes backwards do not count as decay.
  const elapsed = Math.max(0, Number.isFinite(lastAt) && Number.isFinite(now) ? now - lastAt : 0);
  const value = clamp01(weight) * Math.pow(0.5, elapsed / (LINK_HALF_LIFE_DAYS * DAY_MS));
  return Math.max(LINK_FLOOR, Math.min(1, value));
}

/** Is it strong enough for context preload. */
export function isStrong(weight: number): boolean {
  return weight >= LINK_STRONG;
}
