import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../server/engine/loop.js';
import { FakeProvider } from '../../server/engine/providers/fake.js';
import { EventLog } from '../../server/store/events.js';
import { allTools } from '../../server/engine/tools/index.js';
import { autoApprover, denyApprover } from '../../server/engine/permissions.js';
import type { Delta } from '../../server/engine/types.js';

const setup = (script: Delta[][]) => {
  const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
  const log = new EventLog(':memory:');
  const provider = new FakeProvider(script);
  return { cwd, log, provider };
};

describe('runAgent', () => {
  it('streams text and finishes', async () => {
    const { cwd, log, provider } = setup([[{ type: 'text', text: 'selam' }, { type: 'done', stopReason: 'end' }]]);
    const text: string[] = [];
    const r = await runAgent(
      {
        provider,
        model: 'm',
        tools: allTools(cwd),
        approver: autoApprover(),
        log,
        sessionId: 's',
        cwd,
        system: 'sys',
        onDelta: (d) => {
          if (d.type === 'text') text.push(d.text);
        },
      },
      [{ role: 'user', content: 'merhaba' }],
    );
    expect(text).toEqual(['selam']);
    expect(r.stopReason).toBe('end');
    log.close();
  });

  it('auto-approves and runs a simple tool call', async () => {
    const { cwd, log, provider } = setup([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'write_file', args: { path: 'out.txt', content: 'merhaba' } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'bitti' }, { type: 'done', stopReason: 'end' }],
    ]);
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: denyApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'yaz' }],
    );
    expect(r.stopReason).toBe('end');
    expect(r.messages.some((m) => m.role === 'tool' && m.content.includes('wrote out.txt'))).toBe(true);
    expect(log.read('s').some((e) => e.kind === 'permission' && e.payload['decision'] === 'auto')).toBe(true);
    log.close();
  });

  it('a stream without a finish event counts as an error', async () => {
    const { cwd, log } = setup([]);
    const provider = {
      name: 'truncated',
      async *stream() {
        yield { type: 'text' as const, text: 'yarım' };
      },
    };
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: autoApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'x' }],
    );
    expect(r.stopReason).toBe('error');
    log.close();
  });

  it('trims history that exceeds the context budget', async () => {
    const { cwd, log, provider } = setup([[{ type: 'done', stopReason: 'end' }]]);
    await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: autoApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [
        { role: 'user', content: 'a'.repeat(300_000) },
        { role: 'assistant', content: 'b'.repeat(1000) },
        { role: 'user', content: 'son' },
      ],
    );
    const sent = (provider.calls[0]?.messages ?? []).reduce((n, m) => n + m.content.length, 0);
    expect(sent).toBeLessThan(210_000);
    log.close();
  });

  it('an important tool call does not run when rejected', async () => {
    const { cwd, log, provider } = setup([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'run_command', args: { command: 'rm -rf /' } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'done', stopReason: 'end' }],
    ]);
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: denyApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'sil' }],
    );
    expect(r.messages.some((m) => m.role === 'tool' && m.content === 'denied by user')).toBe(true);
    log.close();
  });

  it('a mid-stream error does not run a partial tool call', async () => {
    const { cwd, log } = setup([]);
    const provider = {
      name: 'boom',
      async *stream() {
        yield { type: 'tool_call' as const, call: { id: 'c1', name: 'run_command', args: { command: 'node -e "console.log(1)"' } } };
        throw new Error('bağlantı koptu');
      },
    };
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: autoApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'x' }],
    );
    expect(r.stopReason).toBe('error');
    expect(r.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(log.read('s').some((e) => e.kind === 'error')).toBe(true);
    log.close();
  });

  it('the tool does not run when cancelled while awaiting approval', async () => {
    const { cwd, log, provider } = setup([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'run_command', args: { command: 'rm -rf dist' } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);
    const ac = new AbortController();
    const approver = {
      ask: async () => {
        ac.abort();
        return true;
      },
    };
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver, log, sessionId: 's', cwd, system: 'sys', signal: ac.signal },
      [{ role: 'user', content: 'sil' }],
    );
    expect(r.stopReason).toBe('aborted');
    // the cancel path answers the call too: an unanswered tool_call would break the next turn.
    expect(r.messages.some((m) => m.role === 'tool' && m.toolCallId === 'c1')).toBe(true);
    // an unanswered call also closes in the log: no orphan tool_call remains.
    expect(
      log.read('s').some((e) => e.kind === 'tool_result' && e.body === 'aborted/reflex' && e.payload['ok'] === false),
    ).toBe(true);
    log.close();
  });

  it('two tools with the same name appear once in the provider request', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
    const log = new EventLog(':memory:');
    const provider = new FakeProvider([[{ type: 'done', stopReason: 'end' }]]);
    const tool = (description: string) => ({
      def: { name: 'dup', description, inputSchema: {} },
      access: 'read' as const,
      run: async () => ({ ok: true, output: '' }),
    });
    await runAgent(
      {
        provider,
        model: 'm',
        tools: [tool('ilk'), tool('son')],
        approver: autoApprover(),
        log,
        sessionId: 's',
        cwd,
        system: 'sys',
      },
      [{ role: 'user', content: 'x' }],
    );
    const defs = provider.calls[0]?.tools ?? [];
    expect(defs).toHaveLength(1);
    // the first definition wins: runAgent also uses the first match when looking up tools.
    expect(defs[0]?.description).toBe('ilk');
    log.close();
  });
});
