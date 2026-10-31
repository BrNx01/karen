import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { StateStore } from '../server/brain/store.js';
import { stateTools } from '../server/engine/tools/state.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();
const ctx = { cwd: '.', signal: new AbortController().signal };

function setup() {
  const log = new EventLog(':memory:');
  const state = new StateStore(log, () => NOON);
  const feel = stateTools(state).find((t) => t.def.name === 'feel')!;
  return { log, state, feel };
}

describe('feel tool', () => {
  it('requires no approval (read class)', () => {
    expect(setup().feel.access).toBe('read');
  });

  it('updates emotion with a rationale', async () => {
    const { state, feel } = setup();
    const out = await feel.run({ emotion: 'dopamine', delta: 0.05, reason: 'yeni fikir ilgi çekici' }, ctx);
    expect(out.ok).toBe(true);
    expect(state.current().dopamine).toBeGreaterThan(0.35);
  });

  it('an out-of-range delta is clamped', async () => {
    const { state, feel } = setup();
    await feel.run({ emotion: 'cortisol', delta: 5, reason: 'aşırı' }, ctx);
    expect(state.current().cortisol).toBeCloseTo(0.2, 2);
  });

  it('a call without a rationale is rejected', async () => {
    const { feel } = setup();
    const out = await feel.run({ emotion: 'dopamine', delta: 0.05 }, ctx);
    expect(out.ok).toBe(false);
  });

  it('a non-numeric delta is rejected', async () => {
    const { feel } = setup();
    const out = await feel.run({ emotion: 'dopamine', delta: 'çok', reason: 'x' }, ctx);
    expect(out.ok).toBe(false);
  });

  it('bilinmeyen duygu reddedilir', async () => {
    const { feel } = setup();
    const out = await feel.run({ emotion: 'öfke', delta: 0.05, reason: 'x' }, ctx);
    expect(out.ok).toBe(false);
  });

  it('one call per turn is allowed', async () => {
    const { state, feel } = setup();
    await feel.run({ emotion: 'dopamine', delta: 0.05, reason: 'bir' }, ctx);
    const second = await feel.run({ emotion: 'dopamine', delta: 0.05, reason: 'iki' }, ctx);
    expect(second.ok).toBe(false);
    expect(state.current().dopamine).toBeCloseTo(0.40, 2);
  });

  it('the event is logged as state_feel', async () => {
    const { log, feel } = setup();
    await feel.run({ emotion: 'serotonin', delta: 0.03, reason: 'iyi iş' }, ctx);
    expect(log.read().some((e) => e.kind === 'state_feel')).toBe(true);
  });
});
