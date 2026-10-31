import { describe, it, expect } from 'vitest';
import { decayedWeight, isStrong, reinforce, LINK_FLOOR, LINK_STRONG } from '../server/memory/links.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

describe('reinforce', () => {
  it('repetition thickens the link and never exceeds 1', () => {
    expect(reinforce(0.5)).toBeCloseTo(0.575, 5);
    expect(reinforce(0.9)).toBeCloseTo(0.915, 5);
    let w = 0.5;
    for (let i = 0; i < 100; i++) w = reinforce(w);
    expect(w).toBeLessThanOrEqual(1);
    expect(w).toBeGreaterThan(0.99);
  });

  it('monoton artar', () => {
    let prev = 0.1;
    for (let i = 0; i < 10; i++) {
      const next = reinforce(prev);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it('invalid input is safe', () => {
    expect(reinforce(Number.NaN)).toBeGreaterThanOrEqual(0);
    expect(reinforce(-5)).toBeGreaterThanOrEqual(0);
    expect(reinforce(5)).toBeLessThanOrEqual(1);
  });
});

describe('decayedWeight', () => {
  it('halves in one half-life', () => {
    expect(decayedWeight(0.9, NOW, NOW + 30 * DAY)).toBeCloseTo(0.45, 2);
  });

  it('does not fall below the floor', () => {
    expect(decayedWeight(0.9, NOW, NOW + 3650 * DAY)).toBeCloseTo(0.05, 5);
    expect(decayedWeight(0.9, NOW, NOW + 3650 * DAY)).toBeGreaterThanOrEqual(0.05);
  });

  it('a fresh link is unchanged', () => {
    expect(decayedWeight(0.7, NOW, NOW)).toBeCloseTo(0.7, 5);
  });

  it('no negative duration when the clock goes back', () => {
    expect(decayedWeight(0.7, NOW, NOW - 10 * DAY)).toBeCloseTo(0.7, 5);
  });

  it('produces no NaN', () => {
    const v = decayedWeight(Number.NaN, NOW, NOW + DAY);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(LINK_FLOOR);
  });
});

describe('isStrong', () => {
  it('strong at and above the threshold', () => {
    expect(isStrong(LINK_STRONG)).toBe(true);
    expect(isStrong(0.95)).toBe(true);
    expect(isStrong(0.79)).toBe(false);
  });
});
