import { describe, it, expect } from 'vitest';
import {
  applySignal, circadianAt, decay, gatesOf, initialState, phaseAt,
  statePromptBlock, temperatureOf, MAX_MODEL_DELTA,
} from '../server/brain/state.js';

const DAY = 86_400_000;
// 2026-03-10 12:00 yerel saat (gunduz)
const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();
const NIGHT = new Date(2026, 2, 10, 2, 0, 0).getTime();

describe('phaseAt / circadianAt', () => {
  it('returns the phases of the day in local time', () => {
    expect(phaseAt(new Date(2026, 2, 10, 2, 0).getTime())).toBe('gece');
    expect(phaseAt(new Date(2026, 2, 10, 8, 0).getTime())).toBe('sabah');
    expect(phaseAt(new Date(2026, 2, 10, 14, 0).getTime())).toBe('gunduz');
    expect(phaseAt(new Date(2026, 2, 10, 21, 0).getTime())).toBe('aksam');
  });

  it('phase boundaries: 06 and 11 and 18', () => {
    expect(phaseAt(new Date(2026, 2, 10, 5, 59).getTime())).toBe('gece');
    expect(phaseAt(new Date(2026, 2, 10, 6, 0).getTime())).toBe('sabah');
    expect(phaseAt(new Date(2026, 2, 10, 10, 59).getTime())).toBe('sabah');
    expect(phaseAt(new Date(2026, 2, 10, 11, 0).getTime())).toBe('gunduz');
    expect(phaseAt(new Date(2026, 2, 10, 17, 59).getTime())).toBe('gunduz');
    expect(phaseAt(new Date(2026, 2, 10, 18, 0).getTime())).toBe('aksam');
  });

  it('circadian stays between 0 and 1 and peaks at noon', () => {
    expect(circadianAt(NOON)).toBeCloseTo(1, 1);
    expect(circadianAt(NIGHT)).toBeGreaterThanOrEqual(0);
    expect(circadianAt(NIGHT)).toBeLessThan(0.2);
  });
});

describe('decay', () => {
  it('decays toward the floor by half-life', () => {
    const s = { ...initialState(NOON), cortisol: 0.9 };
    const after = decay(s, NOON + 15 * 60_000); // 1 yarılanma
    expect(after.cortisol).toBeCloseTo(0.10 + (0.9 - 0.10) / 2, 2);
  });

  it('negative duration and forward jumps produce no NaN', () => {
    const s = initialState(NOON);
    for (const t of [NOON - 5 * DAY, NOON + 400 * DAY]) {
      const out = decay(s, t);
      for (const key of ['cortisol', 'dopamine', 'serotonin', 'fatigue'] as const) {
        expect(Number.isFinite(out[key])).toBe(true);
        expect(out[key]).toBeGreaterThanOrEqual(0);
        expect(out[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the fatigue floor rises at night', () => {
    const out = decay({ ...initialState(NOON), fatigue: 0.05 }, NIGHT);
    expect(out.phase).toBe('gece');
    expect(out.fatigue).toBeGreaterThan(0.05);
  });
});

describe('applySignal', () => {
  it('an error spikes cortisol and the value never exceeds 1', () => {
    const out = applySignal(initialState(NOON), { kind: 'error' }, NOON);
    expect(out.cortisol).toBeCloseTo(0.45, 2);
    expect(applySignal(out, { kind: 'error' }, NOON).cortisol).toBeLessThanOrEqual(1);
  });

  it('the urgency keyword adds cortisol and fatigue', () => {
    const out = applySignal(initialState(NOON), { kind: 'crisis_words' }, NOON);
    expect(out.cortisol).toBeCloseTo(0.40, 2);
    expect(out.fatigue).toBeCloseTo(0.10, 2);
  });

  it('a successful tool adds serotonin and dopamine', () => {
    const out = applySignal(initialState(NOON), { kind: 'tool_ok' }, NOON);
    expect(out.serotonin).toBeCloseTo(0.62, 2);
    expect(out.dopamine).toBeCloseTo(0.43, 2);
  });

  it('a model delta cannot leave the range', () => {
    const out = applySignal(initialState(NOON), { kind: 'feel', emotion: 'cortisol', delta: 0.9 }, NOON);
    expect(out.cortisol).toBeCloseTo(0.10 + MAX_MODEL_DELTA, 2);
  });

  it('a non-numeric delta is ignored', () => {
    const out = applySignal(initialState(NOON), { kind: 'feel', emotion: 'dopamine', delta: Number.NaN }, NOON);
    expect(out.dopamine).toBeCloseTo(0.35, 5);
  });

  it('an infinite delta is ignored', () => {
    for (const delta of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = applySignal(initialState(NOON), { kind: 'feel', emotion: 'dopamine', delta }, NOON);
      expect(out.dopamine).toBeCloseTo(0.35, 5);
    }
  });

  it('a negative model delta cannot fall below 0', () => {
    const out = applySignal(initialState(NOON), { kind: 'feel', emotion: 'fatigue', delta: -0.9 }, NOON);
    expect(out.fatigue).toBe(0);
  });

  it('NaN does not poison the clock vector', () => {
    const s = initialState(NOON);
    const candidates = [decay(s, Number.NaN), applySignal(s, { kind: 'turn' }, Number.NaN)];
    for (const out of candidates) {
      for (const key of ['at', 'circadian', 'cortisol', 'dopamine', 'serotonin', 'fatigue'] as const) {
        expect(Number.isFinite(out[key])).toBe(true);
      }
      expect(out.at).toBe(s.at);
      expect(out.phase).toBe(s.phase);
    }
  });

  it('the same signal sequence gives the same vector (determinism)', () => {
    const run = () => {
      let s = initialState(NOON);
      for (const sig of [{ kind: 'turn' }, { kind: 'error' }, { kind: 'tool_ok' }] as const) s = applySignal(s, sig, NOON);
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe('temperatureOf', () => {
  it('falls during a crisis', () => {
    const s = { ...initialState(NOON), cortisol: 0.95, dopamine: 0.1, fatigue: 0.1 };
    expect(temperatureOf(s)).toBeLessThanOrEqual(0.35);
  });

  it('rises with high dopamine and never exceeds 1', () => {
    const s = { ...initialState(NOON), cortisol: 0, dopamine: 1, fatigue: 0 };
    expect(temperatureOf(s)).toBeGreaterThanOrEqual(0.95);
    expect(temperatureOf(s)).toBeLessThanOrEqual(1);
  });

  it('does not fall below 0.10', () => {
    const s = { ...initialState(NOON), cortisol: 1, dopamine: 0, fatigue: 1 };
    expect(temperatureOf(s)).toBeGreaterThanOrEqual(0.1);
  });
});

describe('gatesOf / statePromptBlock', () => {
  it('thresholds open the right gate', () => {
    const crisis = gatesOf({ ...initialState(NOON), cortisol: 0.71 });
    expect(crisis.crisis).toBe(true);
    expect(gatesOf({ ...initialState(NOON), dopamine: 0.7 }).creative).toBe(true);
    expect(gatesOf({ ...initialState(NOON), serotonin: 0.7 }).consolidate).toBe(true);
    expect(gatesOf({ ...initialState(NOON), fatigue: 0.75 }).tired).toBe(true);
    expect(gatesOf({ ...initialState(NIGHT), fatigue: 0.6 }).nightQuiet).toBe(true);
  });

  it('crisis is absolute: no other gate opens in the same turn', () => {
    const all = gatesOf({ ...initialState(NOON), cortisol: 0.9, dopamine: 0.9, serotonin: 0.9 });
    expect(all).toEqual({
      crisis: true,
      creative: false,
      consolidate: false,
      tired: false,
      nightQuiet: false,
    });
    const text = statePromptBlock({ ...initialState(NOON), cortisol: 0.9, dopamine: 0.9, serotonin: 0.9 });
    expect(text).toContain('CRISIS');
    expect(text).not.toContain('R&D');
  });

  it('the crisis block has a no-jokes rule and a crisis label', () => {
    const text = statePromptBlock({ ...initialState(NOON), cortisol: 0.9 });
    expect(text).toContain('Internal state');
    expect(text).toContain('CRISIS');
    expect(text).toContain('No jokes');
    expect(text).not.toContain('proactive');
  });

  it('the tired block suggests sleep', () => {
    expect(statePromptBlock({ ...initialState(NOON), fatigue: 0.8 })).toContain('sleep');
  });

  it('a calm state has no gate sentence, only numbers', () => {
    const text = statePromptBlock(initialState(NOON));
    expect(text).toContain('cortisol');
    expect(text).not.toContain('CRISIS');
  });
});

// the gate thresholds are fixed in spec §7.1: both sides of the boundary are pinned.
describe('gatesOf threshold boundaries', () => {
  it('crisis: cortisol 0.70 opens, 0.699 does not', () => {
    expect(gatesOf({ ...initialState(NOON), cortisol: 0.70 }).crisis).toBe(true);
    expect(gatesOf({ ...initialState(NOON), cortisol: 0.699 }).crisis).toBe(false);
  });

  it('creative: dopamine 0.70 opens, 0.699 does not', () => {
    expect(gatesOf({ ...initialState(NOON), dopamine: 0.70 }).creative).toBe(true);
    expect(gatesOf({ ...initialState(NOON), dopamine: 0.699 }).creative).toBe(false);
  });

  it('consolidate: serotonin 0.70 opens, 0.699 does not', () => {
    expect(gatesOf({ ...initialState(NOON), serotonin: 0.70 }).consolidate).toBe(true);
    expect(gatesOf({ ...initialState(NOON), serotonin: 0.699 }).consolidate).toBe(false);
  });

  it('tired: fatigue 0.75 opens, 0.749 does not', () => {
    expect(gatesOf({ ...initialState(NOON), fatigue: 0.75 }).tired).toBe(true);
    expect(gatesOf({ ...initialState(NOON), fatigue: 0.749 }).tired).toBe(false);
  });

  it('nightQuiet: night and fatigue 0.60 opens, 0.599 does not', () => {
    expect(gatesOf({ ...initialState(NIGHT), fatigue: 0.60 }).nightQuiet).toBe(true);
    expect(gatesOf({ ...initialState(NIGHT), fatigue: 0.599 }).nightQuiet).toBe(false);
    expect(gatesOf({ ...initialState(NOON), fatigue: 0.60 }).nightQuiet).toBe(false);
  });
});
