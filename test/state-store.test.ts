import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { StateStore } from '../server/brain/store.js';
import { initialState } from '../server/brain/state.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  let clock = NOON;
  const log = new EventLog(':memory:');
  const state = new StateStore(log, () => clock);
  return { log, state, setClock: (t: number) => (clock = t) };
}

describe('StateStore', () => {
  it('returns the default vector for an empty log', () => {
    const { state } = setup();
    const s = state.current();
    expect(s.cortisol).toBeCloseTo(0.1, 2);
    expect(s.phase).toBe('gunduz');
  });

  it('the read path writes no events to the log', () => {
    const { log, state } = setup();
    const before = log.read().length;
    state.current();
    state.current();
    expect(log.read().length).toBe(before);
  });

  it('record writes and applies a signal that cannot be derived', () => {
    const { log, state } = setup();
    state.record({ kind: 'context_bloat' });
    expect(state.current().fatigue).toBeGreaterThan(0.14);
    expect(log.read().some((e) => e.kind === 'state_signal')).toBe(true);
  });

  it('live state and log replay agree', () => {
    const { log, state, setClock } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'acil, sistem çöktü');
    const live = state.current();
    setClock(NOON + 5 * 60_000);
    expect(state.replay()).toEqual(state.current());
    expect(live.cortisol).toBeGreaterThan(0.35);
  });

  it('the same message is not counted twice (derived signal is the single source)', () => {
    const { log, state } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'acil');
    const first = state.current().cortisol;
    const second = state.current().cortisol;
    expect(second).toBeCloseTo(first, 5);
    expect(first).toBeCloseTo(0.40, 2);
  });

  it('the same values after the table is dropped and rebuilt from the log', () => {
    const { log, state, setClock } = setup();
    log.append('error', 'system', 's1', { message: 'boom' });
    log.append('tool_result', 'system', 's1', { tool: 'tsc', ok: true }, 'ok');
    state.record({ kind: 'feel', emotion: 'dopamine', delta: 0.05 });
    setClock(NOON + 30 * 60_000);

    const before = state.current();
    const rebuilt = state.replay();
    expect(rebuilt.cortisol).toBeCloseTo(before.cortisol, 5);
    expect(rebuilt.dopamine).toBeCloseTo(before.dopamine, 5);
    expect(rebuilt.serotonin).toBeCloseTo(before.serotonin, 5);
    expect(state.current()).toEqual(before);
  });

  it('state_change is not counted on replay (no double counting)', () => {
    const { log, state } = setup();
    log.append('error', 'system', 's1', { message: 'boom' });
    const once = state.replay();
    state.snapshot(); // denetim olayı
    const twice = state.replay();
    expect(twice.cortisol).toBeCloseTo(once.cortisol, 5);
    expect(log.read().some((e) => e.kind === 'state_change')).toBe(true);
  });

  it('replaying the same log twice yields identical results', () => {
    const { log, state } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'acil, sistem çöktü');
    log.append('error', 'system', 's1', { message: 'x' });
    expect(state.replay()).toEqual(state.replay());
  });

  it('migration runs silently on an old database', () => {
    const log = new EventLog(':memory:');
    log.database.exec('DROP TABLE IF EXISTS state_vector');
    expect(() => new StateStore(log)).not.toThrow();
  });

  it('history returns a bounded number of rows', () => {
    const { state } = setup();
    state.snapshot();
    state.snapshot();
    expect(state.history(1)).toHaveLength(1);
  });

  it('temperature is derived from the vector', () => {
    const { log, state } = setup();
    log.append('error', 'system', 's1', { message: 'x' });
    expect(state.temperature()).toBeLessThan(0.7);
  });

  it('a read-only tool gives no reward', () => {
    const { log, state } = setup();
    log.append('tool_result', 'system', 's1', { tool: 'read_file', ok: true }, 'içerik');
    const s = state.current();
    expect(s.serotonin).toBeCloseTo(0.50, 5);
    expect(s.dopamine).toBeCloseTo(0.35, 5);
  });

  it('a test command adds serotonin and dopamine', () => {
    const { log, state } = setup();
    log.append('tool_result', 'system', 's1', { tool: 'run_command', ok: true, command: 'npm test' }, 'ok');
    const s = state.current();
    expect(s.serotonin).toBeCloseTo(0.62, 5);
    expect(s.dopamine).toBeCloseTo(0.43, 5);
  });

  it('a command without verification produces no signal', () => {
    const { log, state } = setup();
    log.append('tool_result', 'system', 's1', { tool: 'run_command', ok: true, command: 'dir' }, 'ok');
    const s = state.current();
    expect(s.serotonin).toBeCloseTo(0.50, 5);
    expect(s.dopamine).toBeCloseTo(0.35, 5);
  });

  it('an empty log at night applies the fatigue floor', () => {
    const log = new EventLog(':memory:');
    const night = new Date(2026, 2, 10, 2, 0, 0).getTime();
    const state = new StateStore(log, () => night);
    expect(state.current().fatigue).toBeGreaterThanOrEqual(0.20);
  });

  it('redaction preserves the signal on replay (no body, flag present)', () => {
    const { log, state } = setup();
    log.append('message', 'user', 's1', { role: 'user', crisis: true });
    expect(state.current().cortisol).toBeGreaterThan(0.35);
    expect(state.replay().cortisol).toBeGreaterThan(0.35);
  });

  it('a plain message without the flag is classified from its body (fallback)', () => {
    const { log, state } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'acil');
    expect(state.current().cortisol).toBeGreaterThan(0.35);
  });
});
