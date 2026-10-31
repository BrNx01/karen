import { describe, it, expect } from 'vitest';
import {
  combinedStrength,
  DEFAULT_STABILITY,
  initialStability,
  nextDifficulty,
  nextStability,
  retrievability,
  shouldGoDormant,
  surpriseFromSimilarity,
} from '../server/memory/fsrs.js';

describe('retrievability', () => {
  it('about 0.9 at the stability day', () => {
    expect(retrievability(DEFAULT_STABILITY, DEFAULT_STABILITY)).toBeCloseTo(0.9, 2);
  });

  it('full recall at t=0', () => {
    expect(retrievability(0, 30)).toBeCloseTo(1, 5);
  });

  it('falls over time, monotonically decreasing', () => {
    const values = [0, 10, 30, 90, 365].map((d) => retrievability(d, 30));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThan(values[i - 1]!);
    }
    expect(values[4]!).toBeLessThan(values[3]!);
  });

  it('higher stability decays more slowly', () => {
    expect(retrievability(60, 120)).toBeGreaterThan(retrievability(60, 30));
  });
});

describe('nextStability', () => {
  it('successful recall increases stability', () => {
    const next = nextStability(10, 5, 0.8);
    expect(next).toBeGreaterThan(10);
  });

  it('gains more at low retrievability (desirable difficulty)', () => {
    const easyRecall = nextStability(10, 5, 0.95);
    const hardRecall = nextStability(10, 5, 0.4);
    expect(hardRecall).toBeGreaterThan(easyRecall);
  });

  it('again lowers stability', () => {
    expect(nextStability(10, 5, 0.5, 'again')).toBeLessThan(10);
  });

  it('easy raises it more', () => {
    expect(nextStability(10, 5, 0.7, 'easy')).toBeGreaterThan(nextStability(10, 5, 0.7, 'good'));
  });

  it('does not run to infinity', () => {
    let s = 30;
    for (let i = 0; i < 200; i++) s = nextStability(s, 1, 0.5, 'easy');
    expect(s).toBeLessThanOrEqual(36_500);
  });
});

describe('nextDifficulty', () => {
  it('review makes it easier, correction makes it harder', () => {
    expect(nextDifficulty(5, 'easier')).toBeLessThan(5);
    expect(nextDifficulty(5, 'harder')).toBeGreaterThan(5);
  });

  it('stays within bounds', () => {
    expect(nextDifficulty(1, 'easier')).toBe(1);
    expect(nextDifficulty(10, 'harder')).toBe(10);
  });
});

describe('initialStability', () => {
  it('an important note starts more stable', () => {
    expect(initialStability(0.9)).toBeGreaterThan(initialStability(0.2));
  });

  it('surprise increases stability', () => {
    expect(initialStability(0.5, 1)).toBeGreaterThan(initialStability(0.5, 0));
  });
});

describe('combinedStrength', () => {
  it('storage strength raises the rating', () => {
    const weak = combinedStrength(30, 30, 1);
    const strong = combinedStrength(30, 30, 10);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('the score is between 0 and 1', () => {
    const value = combinedStrength(10_000, 5, 20);
    expect(value.score).toBeGreaterThanOrEqual(0);
    expect(value.score).toBeLessThanOrEqual(1);
  });
});

describe('shouldGoDormant', () => {
  it('below threshold and rarely recalled decays to cold', () => {
    expect(shouldGoDormant(0.1, 1)).toBe(true);
  });

  it('a well-recalled note never goes cold', () => {
    expect(shouldGoDormant(0.05, 3)).toBe(false);
    expect(shouldGoDormant(0.0, 8)).toBe(false);
  });

  it('a fresh note does not go cold', () => {
    expect(shouldGoDormant(0.9, 1)).toBe(false);
  });
});

describe('surpriseFromSimilarity', () => {
  it('similar information gives low surprise', () => {
    expect(surpriseFromSimilarity(0.95)).toBeCloseTo(0.05, 5);
  });
  it('new information gives high surprise', () => {
    expect(surpriseFromSimilarity(0.1)).toBeCloseTo(0.9, 5);
  });
});
