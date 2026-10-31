import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import { autonomousVerdict } from '../server/engine/permissions.js';
import { fetchUrlTool } from '../server/engine/tools/web.js';
import type { StreamRequest, Delta } from '../server/engine/types.js';

/** Network stub: autonomous tests never reach the real network. */
const emptyHtml = (): typeof fetch =>
  (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch;

function recording(script?: (req: StreamRequest) => Delta[]) {
  const requests: StreamRequest[] = [];
  return {
    requests,
    p: {
      name: 'rec',
      async *stream(req: StreamRequest) {
        requests.push(req);
        for (const d of script?.(req) ?? [{ type: 'text' as const, text: 'ok' }, { type: 'done' as const, stopReason: 'end' as const }]) yield d;
      },
    },
  };
}

function setup(opts: { research?: boolean; approve?: () => Promise<boolean> } = {}) {
  const log = new EventLog(':memory:');
  const rec = recording();
  let approveCalls = 0;
  const sessions = new SessionManager({
    provider: rec.p,
    model: 'm',
    log,
    autonomy: { research: opts.research ?? true },
    webFetchImpl: emptyHtml(),
    approve: async () => {
      approveCalls++;
      return opts.approve ? opts.approve() : true;
    },
    onEvent: () => undefined,
  });
  return { log, sessions, rec, approveCalls: () => approveCalls };
}

const names = (req: StreamRequest) => req.tools.map((t: { name: string }) => t.name);

describe('otonom oturum', () => {
  it('write/exec tools are not registered', async () => {
    const { sessions, rec } = setup();
    const s = sessions.create({ role: 'worker', autonomous: true });
    await sessions.send(s.id, 'araştır');
    const tools = names(rec.requests[0]!);
    for (const banned of ['write_file', 'run_command', 'open_app', 'spawn_session', 'propose_change', 'feel']) {
      expect(tools).not.toContain(banned);
    }
    expect(tools).toContain('read_file');
    expect(tools).toContain('web_search');
  });

  it('network tools are not registered when research is off', async () => {
    const { sessions, rec } = setup({ research: false });
    const s = sessions.create({ role: 'worker', autonomous: true });
    await sessions.send(s.id, 'araştır');
    const tools = names(rec.requests[0]!);
    expect(tools).not.toContain('web_search');
    expect(tools).not.toContain('fetch_url');
  });

  it('a network call passes without waiting for approval', async () => {
    const log = new EventLog(':memory:');
    const rec = recording((req) =>
      req.messages.some((m) => m.role === 'tool')
        ? [{ type: 'text' as const, text: 'bitti' }, { type: 'done' as const, stopReason: 'end' as const }]
        : [
            { type: 'tool_call' as const, call: { id: 'c1', name: 'web_search', args: { query: 'x' } } },
            { type: 'done' as const, stopReason: 'tool_use' as const },
          ],
    );
    const sessions = new SessionManager({
      provider: rec.p,
      model: 'm',
      log,
      autonomy: { research: true },
      webFetchImpl: emptyHtml(),
      // autonomous network reads must not ask for approval: if they do, this throws and the test fails.
      approve: async () => {
        throw new Error('sorulmamalı');
      },
      onEvent: () => undefined,
    });
    const s = sessions.create({ role: 'worker', autonomous: true });
    const result = await sessions.send(s.id, 'araştır');
    expect(result.ok).toBe(true);
    expect(log.read().some((e) => e.kind === 'permission' && e.payload['decision'] === 'auto-autonomous')).toBe(true);
  });

  it('a non-network approval request is rejected immediately (pure decision)', () => {
    expect(autonomousVerdict('run_command', true)).toEqual({ allow: false, decision: 'denied-autonomous' });
    expect(autonomousVerdict('write_file', true)).toEqual({ allow: false, decision: 'denied-autonomous' });
  });

  it('the network tool depends on research permission', () => {
    expect(autonomousVerdict('web_search', true)).toEqual({ allow: true, decision: 'auto-autonomous' });
    expect(autonomousVerdict('fetch_url', true)).toEqual({ allow: true, decision: 'auto-autonomous' });
    expect(autonomousVerdict('web_search', false)).toEqual({ allow: false, decision: 'denied-autonomous' });
  });

  it('an autonomous turn never enters the waiting state', async () => {
    const log = new EventLog(':memory:');
    const rec = recording((req) =>
      req.messages.some((m) => m.role === 'tool')
        ? [{ type: 'text' as const, text: 'tamam' }, { type: 'done' as const, stopReason: 'end' as const }]
        : [
            { type: 'tool_call' as const, call: { id: 'c1', name: 'fetch_url', args: { url: 'https://example.com' } } },
            { type: 'done' as const, stopReason: 'tool_use' as const },
          ],
    );
    const statuses: string[] = [];
    const sessions = new SessionManager({
      provider: rec.p,
      model: 'm',
      log,
      autonomy: { research: true },
      webFetchImpl: emptyHtml(),
      approve: async () => {
        throw new Error('sorulmamalı');
      },
      onEvent: (e) => {
        if (e.type === 'status') statuses.push(e.status);
      },
    });
    const s = sessions.create({ role: 'worker', autonomous: true });
    const result = await sessions.send(s.id, 'araştır');
    expect(result.ok).toBe(true);
    expect(statuses).not.toContain('waiting');
  });

  it('normal oturum etkilenmez', async () => {
    const { sessions, rec } = setup();
    const s = sessions.create({ role: 'worker' });
    await sessions.send(s.id, 'selam');
    const tools = names(rec.requests[0]!);
    expect(tools).toContain('write_file');
    expect(tools).toContain('run_command');
  });
});

describe('fetch_url read restriction', () => {
  const ctx = { cwd: '.', signal: new AbortController().signal };

  it('POST is rejected in autonomous mode without touching the network', async () => {
    let calls = 0;
    const spy = (async () => {
      calls++;
      throw new Error('ağa çıkılmamalı');
    }) as unknown as typeof fetch;
    const out = await fetchUrlTool({ readOnly: true, fetchImpl: spy }).run(
      { url: 'https://x', method: 'POST', body: 'a' },
      ctx,
    );
    expect(out.ok).toBe(false);
    expect(out.output).toContain('read-only');
    expect(calls).toBe(0);
  });

  it('readOnly yokken POST reddedilmez', async () => {
    const seen: RequestInit[] = [];
    const spy = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchUrlTool({ fetchImpl: spy }).run({ url: 'https://x', method: 'POST', body: 'a' }, ctx);
    expect(out.ok).toBe(true);
    expect(seen[0]?.method).toBe('POST');
  });
});
