import { describe, it, expect, vi } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { InboxStore } from '../server/autonomy/inbox.js';
import { IdleClock } from '../server/autonomy/activity.js';
import { Dmn } from '../server/autonomy/dmn.js';
import { SessionManager } from '../server/sessions.js';
import { MemoryStore } from '../server/memory/notes.js';
import type { StreamRequest } from '../server/engine/types.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup(
  over: {
    enabled?: boolean;
    dailyRuns?: number;
    research?: boolean;
    distiller?: () => Promise<string>;
    providerError?: boolean;
    emptyText?: boolean;
    slow?: () => Promise<void>;
    hang?: boolean;
    timeoutMs?: number;
    driveInputError?: boolean;
  } = {},
) {
  let clock = NOON;
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const inbox = new InboxStore(log, () => clock);
  const idle = new IdleClock(() => clock);
  const requests: StreamRequest[] = [];
  const sessions = new SessionManager({
    provider: {
      name: 'rec',
      async *stream(req: StreamRequest) {
        if (over.providerError) throw new Error('sağlayıcı yok');
        requests.push(req);
        if (over.hang) {
          // produces no delta at all; closes only on a cancel signal (hung provider).
          await new Promise<void>((_, reject) => {
            req.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          });
          return;
        }
        if (over.slow) await over.slow();
        yield {
          type: 'text' as const,
          text: over.emptyText ? '' : 'RISC-V makalesi bulundu: https://example.com/rv',
        };
        yield { type: 'done' as const, stopReason: 'end' as const };
      },
    },
    model: 'm',
    log,
    autonomy: { research: over.research ?? true },
    ...(over.timeoutMs === undefined ? {} : { autonomousTimeoutMs: over.timeoutMs }),
    approve: async () => false,
    onEvent: () => undefined,
  });
  const dmn = new Dmn({
    sessions,
    log,
    inbox,
    idle,
    memory,
    cwd: 'C:\\proje',
    now: () => clock,
    ...(over.distiller ? { distiller: over.distiller } : {}),
    settings: () => ({
      enabled: over.enabled ?? true,
      idleMinutes: 30,
      dailyRuns: over.dailyRuns ?? 24,
    }),
    buildDriveInput: () => {
      if (over.driveInputError) throw new Error('günlük okunamadı');
      return { logOk: true, unknownTerms: ['riscv'], styleSignals: [] };
    },
  });
  return { log, memory, inbox, idle, dmn, sessions, requests, adv: (ms: number) => (clock += ms), clock: () => clock };
}

describe('Dmn', () => {
  it('does nothing when the setting is off', () => {
    const { dmn } = setup({ enabled: false });
    expect(dmn.tick(NOON).ran).toBe(false);
  });

  it('does nothing while the user is active', () => {
    const { dmn } = setup();
    expect(dmn.tick(NOON).reason).toBe('kullanıcı etkin');
  });

  it('opens an autonomous turn when idle with a drive and writes to the inbox', async () => {
    const { dmn, adv, inbox, log } = setup();
    adv(31 * 60_000);
    const result = dmn.tick(NOON + 31 * 60_000);
    expect(result.ran).toBe(true);
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1));
    expect(inbox.list()[0]!.kind).toBe('research');
    expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true);
  });

  it('10 dakika cooldown uygular', async () => {
    const { dmn, adv, log } = setup();
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    // make sure the turn really ends: otherwise the second tick hits "busy" and cooldown is never tested.
    await vi.waitFor(() => expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true));
    adv(5 * 60_000);
    expect(dmn.tick(NOON + 36 * 60_000).reason).toBe('bekleme');
  });

  it('does not exceed the daily limit', () => {
    const { dmn, adv } = setup({ dailyRuns: 0 });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).reason).toBe('günlük sınır');
  });

  it('stop ends the in-flight turn without writing', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const { dmn, adv, inbox, log, sessions } = setup({ slow: () => gate });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);

    // the shutdown arrives while the turn waits on the provider.
    dmn.stop();
    release();
    await vi.waitFor(() => expect(sessions.list().every((s) => s.status === 'idle')).toBe(true));

    expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(false);
    expect(inbox.list()).toHaveLength(0);
  });

  it('tick does nothing after stop', () => {
    const { dmn, adv } = setup();
    dmn.start(60_000);
    dmn.stop();
    dmn.stop();
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(false);
  });

  it('requests no network tool when research is off', async () => {
    const { dmn, adv, requests } = setup({ research: false });
    adv(31 * 60_000);
    dmn.tick(NOON + 31 * 60_000);
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    const tools = requests[0]!.tools.map((t: { name: string }) => t.name);
    expect(tools).not.toContain('web_search');
  });

  it('the turn and inbox row remain even if distillation fails', async () => {
    const { dmn, adv, inbox, log } = setup({
      distiller: async () => {
        throw new Error('model yok');
      },
    });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1));
    const run = log.read().find((e) => e.kind === 'dmn_run');
    expect(run).toBeDefined();
    // a model failure must be distinguishable from "nothing to learn".
    expect(String(run!.payload['distillError'])).toContain('model');
  });

  it('the next turn still runs when create throws', () => {
    const { dmn, adv, sessions } = setup();
    const original = sessions.create.bind(sessions);
    let fail = true;
    sessions.create = ((opts) => {
      if (fail) {
        fail = false;
        throw new Error('db kilitli');
      }
      return original(opts);
    }) as typeof sessions.create;

    adv(31 * 60_000);
    const first = dmn.tick(NOON + 31 * 60_000);
    expect(first.ran).toBe(false);
    // the lock was not left stuck: the turn opens again after cooldown.
    adv(11 * 60_000);
    expect(dmn.tick(NOON + 42 * 60_000).ran).toBe(true);
  });

  it('sessions are pruned at the end of a turn', async () => {
    const { dmn, adv, sessions, log } = setup();
    for (let i = 1; i <= 2; i++) {
      adv(i === 1 ? 31 * 60_000 : 11 * 60_000);
      expect(dmn.tick(NOON + 31 * 60_000 + (i - 1) * 11 * 60_000).ran).toBe(true);
      await vi.waitFor(() => expect(log.read().filter((e) => e.kind === 'dmn_run')).toHaveLength(i));
    }
    // accumulated idle workers must be pruned on the next turn (the transcript stays in the log).
    for (let i = 0; i < 25; i++) sessions.create({ title: `w${i}` });
    adv(11 * 60_000);
    expect(dmn.tick(NOON + 53 * 60_000).ran).toBe(true);
    await vi.waitFor(() => expect(sessions.list().length).toBeLessThanOrEqual(21));
  });

  it('a failed turn does not burn the daily quota and reports via dmn_run', async () => {
    const { dmn, adv, log } = setup({ providerError: true });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    await vi.waitFor(() => expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true));
    const run = log.read().find((e) => e.kind === 'dmn_run')!;
    expect(run.payload['ok']).toBe(false);
    expect(String(run.payload['error'])).toContain('sağlayıcı yok');
    // an autonomous error does not feed the biological state: no error event is written.
    expect(log.read().some((e) => e.kind === 'error')).toBe(false);
    expect(dmn.stats().runsToday).toBe(0);
  });

  it('a failed attempt still waits 10 minutes', async () => {
    const { dmn, adv, log } = setup({ providerError: true });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    await vi.waitFor(() => expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true));
    // a tick one minute later opens no new session: a provider outage must not become a loop.
    adv(60_000);
    expect(dmn.tick(NOON + 32 * 60_000).reason).toBe('bekleme');
  });

  it('a hung provider closes on timeout and leaves a dmn_run error', async () => {
    const { dmn, adv, log, inbox, sessions } = setup({ hang: true, timeoutMs: 50 });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    await vi.waitFor(() => expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true), { timeout: 2000 });
    const run = log.read().find((e) => e.kind === 'dmn_run')!;
    expect(run.payload['ok']).toBe(false);
    expect(String(run.payload['error'])).toContain('zaman aşımı');
    expect(log.read().some((e) => e.kind === 'error')).toBe(false);
    expect(inbox.list()).toHaveLength(0);
    // the lock is released: the session is in error state and not busy.
    expect(sessions.list().every((s) => s.status !== 'running' && s.status !== 'waiting')).toBe(true);
  });

  it('an uncited URL is flagged from the inbox row', async () => {
    const { dmn, adv, inbox } = setup();
    adv(31 * 60_000);
    dmn.tick(NOON + 31 * 60_000);
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1));
    const text = inbox.list()[0]!.text;
    expect(text).not.toContain('https://example.com/rv');
    expect(text).toContain('[kaynak doğrulanamadı]');
  });

  it('a scheduler error does not take the process down and keeps the last error', () => {
    vi.useFakeTimers();
    try {
      const { dmn, adv } = setup({ driveInputError: true });
      adv(31 * 60_000);
      dmn.start(60_000);
      expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
      expect(dmn.stats().lastError).toContain('günlük okunamadı');
      dmn.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes a placeholder row on empty output', async () => {
    const { dmn, adv, inbox } = setup({ emptyText: true });
    adv(31 * 60_000);
    dmn.tick(NOON + 31 * 60_000);
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1));
    expect(inbox.list()[0]!.text).toBe('curiosity: çıktı yok');
  });

  it('restart does not reset the daily count', async () => {
    const { dmn, adv, sessions, inbox, memory, idle, log } = setup();
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    await vi.waitFor(() => expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true));
    const again = new Dmn({
      sessions,
      log,
      inbox,
      idle,
      memory,
      cwd: 'C:\\proje',
      now: () => NOON + 51 * 60_000,
      settings: () => ({ enabled: true, idleMinutes: 30, dailyRuns: 1 }),
      buildDriveInput: () => ({ logOk: true, unknownTerms: ['riscv'], styleSignals: [] }),
    });
    expect(again.stats().runsToday).toBe(1);
    adv(20 * 60_000);
    expect(again.tick(NOON + 51 * 60_000).reason).toBe('günlük sınır');
  });

  it('distills within the turn: the note is written before the morning report', async () => {
    // the distiller returns a candidate citing the URL in the tool result.
    let clock = NOON;
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const inbox = new InboxStore(log, () => clock);
    const idle = new IdleClock(() => clock);
    const sessions = new SessionManager({
      provider: {
        name: 'rec',
        async *stream(req) {
          if (!req.messages.some((m) => m.role === 'tool')) {
            yield { type: 'tool_call' as const, call: { id: 'c1', name: 'web_search', args: { query: 'riscv' } } };
            yield { type: 'done' as const, stopReason: 'tool_use' as const };
            return;
          }
          yield { type: 'text' as const, text: 'RISC-V derleyici notu: https://example.com/rv' };
          yield { type: 'done' as const, stopReason: 'end' as const };
        },
      },
      model: 'm',
      log,
      autonomy: { research: true },
      // Network stub: the tool result is deterministic and carries the URL the candidate cites.
      webFetchImpl: async () =>
        new Response('<a class="result__a" href="https://example.com/rv">RISC-V derleyici notu</a>', {
          status: 200,
        }),
      approve: async () => false,
      onEvent: () => undefined,
    });
    const dmn = new Dmn({
      sessions,
      log,
      inbox,
      idle,
      memory,
      cwd: 'C:\\proje',
      now: () => clock,
      // single candidate: it names the tool result event as evidence.
      distiller: async () => {
        const toolEvent = log.read().find((e) => e.kind === 'tool_result');
        return JSON.stringify([
          {
            kind: 'semantic',
            text: 'RISC-V derleyici optimizasyonu https://example.com/rv faydalı',
            concepts: ['riscv'],
            evidence: [toolEvent?.id ?? 1],
            importance: 0.5,
          },
        ]);
      },
      settings: () => ({ enabled: true, idleMinutes: 30, dailyRuns: 24 }),
      buildDriveInput: () => ({ logOk: true, unknownTerms: ['riscv'], styleSignals: [] }),
    });

    clock = NOON + 31 * 60_000;
    expect(dmn.tick(clock).ran).toBe(true);
    // the note must be in memory before the inbox row is written (distillation in the same turn).
    await vi.waitFor(() => expect(memory.list({ includeDormant: true }).length).toBeGreaterThan(0));
    expect(memory.list({ includeDormant: true }).some((n) => n.text.includes('https://example.com/rv'))).toBe(true);
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1));
    const noteEvent = log.read().find((e) => e.kind === 'memory_note' && e.payload['kind'] === 'semantic');
    const inboxEvent = log.read().find((e) => e.kind === 'inbox_note');
    expect(noteEvent!.id).toBeLessThan(inboxEvent!.id);
  });
});
