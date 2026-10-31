import { describe, it, expect } from 'vitest';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import type { Delta, Provider, StreamRequest } from '../server/engine/types.js';
import type { ServerEvent } from '../server/sessions.js';

/** Fake provider that answers per session: no shared scenario sequence. */
function sessionAwareProvider(): Provider & { calls: StreamRequest[] } {
  const calls: StreamRequest[] = [];
  const spawned = new Set<string>();
  return {
    name: 'session-aware',
    calls,
    async *stream(req: StreamRequest): AsyncIterable<Delta> {
      calls.push(req);
      const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
      const isBrain = system.includes("KAREN's brain");
      const hasToolResult = req.messages.some((m) => m.role === 'tool');
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const sessionKey = system.slice(0, 40) + String(req.messages.length);

      if (isBrain && !hasToolResult && !spawned.has(sessionKey)) {
        spawned.add(sessionKey);
        yield {
          type: 'tool_call',
          call: { id: 'c1', name: 'spawn_session', args: { task: 'raporu üret', cwd: 'C:\\proj', title: 'Rapor' } },
        };
        yield { type: 'done', stopReason: 'tool_use' };
        return;
      }
      if (isBrain && lastUser.startsWith('[background notice]')) {
        yield { type: 'text', text: 'Rapor bitti, özetliyorum.' };
        yield { type: 'done', stopReason: 'end' };
        return;
      }
      if (isBrain) {
        yield { type: 'text', text: 'Arka planda başlattım.' };
        yield { type: 'done', stopReason: 'end' };
        return;
      }
      yield { type: 'text', text: 'rapor.pdf hazır' };
      yield { type: 'done', stopReason: 'end' };
    },
  };
}

describe('brain → session → result', () => {
  it('the brain opens a session, the work finishes, the result is reported to the brain and enters context', async () => {
    const log = new EventLog(':memory:');
    const events: ServerEvent[] = [];
    const provider = sessionAwareProvider();
    const manager = new SessionManager({
      provider,
      model: 'm',
      log,
      approve: async () => true,
      onEvent: (e) => events.push(e),
    });
    const brain = manager.create({ role: 'brain', cwd: 'C:\\proj' });

    await manager.send(brain.id, 'rapor üret');

    const workers = manager.list().filter((s) => s.role === 'worker');
    expect(workers).toHaveLength(1);
    expect(workers[0]?.title).toBe('Rapor');

    await waitFor(() => events.some((e) => e.type === 'notice'));
    const notice = events.find((e) => e.type === 'notice');
    expect(notice && 'text' in notice ? notice.text : '').toContain('rapor.pdf hazır');

    // the notification enters the context on the next brain turn.
    await manager.send(brain.id, 'durum?');
    const lastCall = provider.calls[provider.calls.length - 1];
    const injected = lastCall?.messages.find((m) => m.content.startsWith('[background notice]'));
    expect(injected?.content).toContain('rapor.pdf hazır');
  });

  it('session_status reports running and finished sessions', async () => {
    const log = new EventLog(':memory:');
    const provider = sessionAwareProvider();
    const manager = new SessionManager({
      provider,
      model: 'm',
      log,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = manager.create({ role: 'brain', cwd: 'C:\\proj' });
    const worker = manager.create({ cwd: 'C:\\proj', title: 'Rapor' });
    await manager.send(worker.id, 'yap');

    const tools = (await import('../server/engine/tools/sessions.js')).sessionTools(manager, brain.id);
    const status = tools.find((t) => t.def.name === 'session_status')!;
    const result = await status.run({ sessionId: worker.id }, { cwd: 'C:\\proj', signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('rapor.pdf hazır');
    expect(result.output).toContain('status: idle');
  });

  it('the brain cannot manage its own session', async () => {
    const log = new EventLog(':memory:');
    const manager = new SessionManager({
      provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
      model: 'm',
      log,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = manager.create({ role: 'brain', cwd: 'C:\\proj' });
    const tools = (await import('../server/engine/tools/sessions.js')).sessionTools(manager, brain.id);
    const status = tools.find((t) => t.def.name === 'session_status')!;
    const result = await status.run({ sessionId: brain.id }, { cwd: '.', signal: new AbortController().signal });
    expect(result.ok).toBe(false);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}
