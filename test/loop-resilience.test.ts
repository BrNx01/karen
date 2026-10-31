import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { allTools } from '../server/engine/tools/index.js';
import { runAgent } from '../server/engine/loop.js';
import { autoApprover } from '../server/engine/permissions.js';
import type { Delta } from '../server/engine/types.js';

const done = (text: string): Delta[] => [{ type: 'text', text }, { type: 'done', stopReason: 'end' }];

describe('error thrown inside a tool', () => {
  it('cancel closes the session as aborted without crashing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-abort-'));
    const log = new EventLog(':memory:');
    const ac = new AbortController();
    // cancelled while the tool runs: it throws and the session must not lock up.
    const aborting = {
      def: { name: 'slow', description: 'x', inputSchema: { type: 'object' } },
      access: 'read' as const,
      run: async () => {
        ac.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    };
    const provider = new FakeProvider([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'slow', args: {} } },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);
    const result = await runAgent(
      {
        provider,
        model: 'm',
        tools: [aborting],
        approver: autoApprover(),
        log,
        sessionId: 's',
        cwd,
        system: 'sys',
        signal: ac.signal,
      },
      [{ role: 'user', content: 'çalıştır' }],
    );
    expect(result.stopReason).toBe('aborted');
    log.close();
  });

  it('a tool error does not lock the session and returns as a result', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-toolerr-'));
    const log = new EventLog(':memory:');
    const throwing = {
      def: { name: 'boom', description: 'x', inputSchema: { type: 'object' } },
      access: 'read' as const,
      run: async () => {
        throw new Error('patladı');
      },
    };
    const provider = new FakeProvider([
      [{ type: 'tool_call', call: { id: 'c1', name: 'boom', args: {} } }, { type: 'done', stopReason: 'tool_use' }],
      done('tamam'),
    ]);
    const result = await runAgent(
      { provider, model: 'm', tools: [throwing], approver: autoApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'dene' }],
    );
    expect(result.stopReason).toBe('end');
    expect(result.messages.some((m) => m.role === 'tool' && m.content.includes('patladı'))).toBe(true);
    log.close();
  });
});

describe('session state leak', () => {
  it('the session does not stay running even if the tool throws', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-leak-'));
    const log = new EventLog(':memory:');
    const manager = new SessionManager({
      provider: new FakeProvider([
        [{ type: 'tool_call', call: { id: 'c1', name: 'boom', args: {} } }, { type: 'done', stopReason: 'tool_use' }],
        done('bitti'),
      ]),
      model: 'm',
      log,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const session = manager.create({ cwd });
    const result = await manager.send(session.id, 'dene');
    expect(result.ok).toBe(true);
    expect(manager.get(session.id)?.status).toBe('idle');
    log.close();
  });
});
