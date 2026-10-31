import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import { StateStore } from '../server/brain/store.js';
import type { StreamRequest } from '../server/engine/types.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function provider() {
  const requests: StreamRequest[] = [];
  return {
    requests,
    p: {
      name: 'rec',
      async *stream(req: StreamRequest) {
        requests.push(req);
        yield { type: 'text' as const, text: 'tamam' };
        yield { type: 'done' as const, stopReason: 'end' as const };
      },
    },
  };
}

function setup() {
  const log = new EventLog(':memory:');
  const state = new StateStore(log, () => NOON);
  const rec = provider();
  const sessions = new SessionManager({
    provider: rec.p,
    model: 'm',
    log,
    state,
    approve: async () => true,
    onEvent: () => undefined,
  });
  const brain = sessions.create({ role: 'brain' });
  return { log, state, sessions, brain, rec };
}

describe('durum enjeksiyonu', () => {
  it('the system prompt has an inner state block', async () => {
    const { sessions, brain, rec } = setup();
    await sessions.send(brain.id, 'selam');
    const system = rec.requests[0]!.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('Internal state');
    expect(system).toContain('cortisol');
  });

  it('otonom tur biyolojik durumu beslemez', async () => {
    const { sessions, log, state } = setup();
    const worker = sessions.create({ autonomous: true, title: 'otonom' });
    await sessions.send(worker.id, 'arka plan işi');
    expect(log.read().some((e) => e.kind === 'state_change')).toBe(false);
    expect(state.current().serotonin).toBeCloseTo(0.5, 2);
  });

  it('temperature reaches the request and stays within 0.10-1.00', async () => {
    const { sessions, brain, rec } = setup();
    await sessions.send(brain.id, 'selam');
    const t = rec.requests[0]!.temperature;
    expect(typeof t).toBe('number');
    expect(t!).toBeGreaterThanOrEqual(0.1);
    expect(t!).toBeLessThanOrEqual(1);
  });

  it('an urgent message raises cortisol above the floor', async () => {
    const { sessions, brain, rec, state } = setup();
    await sessions.send(brain.id, 'acil, sistem çöktü');
    const system = rec.requests.at(-1)!.messages.find((m) => m.role === 'system')!.content;
    expect(state.current().cortisol).toBeGreaterThan(0.35);
    // the prompt number line reflects the real vector.
    expect(system).toMatch(/cortisol 0\.[3-9]\d/);
  });

  it('an urgent message plus an error event opens the crisis gate', async () => {
    const { sessions, brain, rec, log } = setup();
    // realistic path: urgency (0.10 + 0.30) and a failure (0.35) together cross the threshold.
    log.append('error', 'system', brain.id, { message: 'bağlantı koptu' });
    await sessions.send(brain.id, 'acil çöktü');
    const system = rec.requests.at(-1)!.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('CRISIS');
  });

  it('urgent message plus error produce a crisis prompt and low temperature in the same request', async () => {
    const { sessions, brain, rec, log } = setup();
    log.append('error', 'system', brain.id, { message: 'bağlantı koptu' });
    await sessions.send(brain.id, 'acil çöktü');
    const req = rec.requests.at(-1)!;
    const system = req.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('CRISIS');
    expect(req.temperature!).toBeLessThan(0.70);
  });

  it('a failed turn does not corrupt state and the session stays usable (error path)', async () => {
    const log = new EventLog(':memory:');
    const state = new StateStore(log, () => NOON);
    let fail = true;
    const sessions = new SessionManager({
      provider: {
        name: 'boom',
        async *stream() {
          if (fail) throw new Error('ağ yok');
          yield { type: 'text' as const, text: 'tamam' };
          yield { type: 'done' as const, stopReason: 'end' as const };
        },
      },
      model: 'm',
      log,
      state,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = sessions.create({ role: 'brain' });
    const result = await sessions.send(brain.id, 'selam');
    expect(result.ok).toBe(false);
    expect(Number.isFinite(state.current().cortisol)).toBe(true);

    fail = false;
    expect(await sessions.send(brain.id, 'selam')).toEqual({ ok: true });
  });

  it('a cancelled turn grants no serotonin and the snapshot is still taken', async () => {
    const log = new EventLog(':memory:');
    const state = new StateStore(log, () => NOON);
    let brainId = '';
    const sessions = new SessionManager({
      provider: {
        name: 'abort',
        // eslint-disable-next-line require-yield
        async *stream() {
          sessions.abort(brainId);
          throw new Error('iptal');
        },
      },
      model: 'm',
      log,
      state,
      approve: async () => true,
      onEvent: () => undefined,
    });
    brainId = sessions.create({ role: 'brain' }).id;
    const result = await sessions.send(brainId, 'selam');
    expect(result.ok).toBe(true);
    expect(state.current().serotonin).toBeCloseTo(0.50, 2);
    expect(log.read().some((e) => e.kind === 'state_change')).toBe(true);
  });

  it('the turn still succeeds when state write/read throws', async () => {
    const log = new EventLog(':memory:');
    const rec = provider();
    const broken = {
      current: () => {
        throw new Error('projeksiyon bozuk');
      },
      record: () => {
        throw new Error('projeksiyon bozuk');
      },
      snapshot: () => {
        throw new Error('projeksiyon bozuk');
      },
    } as unknown as StateStore;
    const sessions = new SessionManager({
      provider: rec.p,
      model: 'm',
      log,
      state: broken,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = sessions.create({ role: 'brain' });
    expect(await sessions.send(brain.id, 'selam')).toEqual({ ok: true });
    const system = rec.requests[0]!.messages.find((m) => m.role === 'system')!.content;
    expect(system).not.toContain('Internal state');
    expect(rec.requests[0]!.temperature).toBeUndefined();
    // no error event is written: it would also feed state derivation.
    expect(log.read().some((e) => e.kind === 'error')).toBe(false);
  });

  it('context_bloat is written once per session', async () => {
    const { sessions, brain, log } = setup();
    const big = 'x'.repeat(250_000);
    await sessions.send(brain.id, big);
    await sessions.send(brain.id, big);
    const bloat = log
      .read()
      .filter(
        (e) =>
          e.kind === 'state_signal' &&
          (e.payload['signal'] as { kind?: string } | undefined)?.kind === 'context_bloat',
      );
    expect(bloat).toHaveLength(1);
  });
});
