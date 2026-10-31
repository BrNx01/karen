import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { autoApprover } from '../server/engine/permissions.js';
import type { ServerEvent } from '../server/sessions.js';

const setup = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'karen-sess-'));
  const log = new EventLog(':memory:');
  const provider = new FakeProvider([
    [{ type: 'text', text: 'merhaba' }, { type: 'done', stopReason: 'end' }],
    [{ type: 'text', text: 'ikinci' }, { type: 'done', stopReason: 'end' }],
  ]);
  const events: ServerEvent[] = [];
  const sessions = new SessionManager({
    provider,
    model: 'm',
    log,
    approve: (_sessionId, req) => autoApprover().ask(req),
    onEvent: (e) => events.push(e),
  });
  return { cwd, log, sessions, events, provider };
};

describe('SessionManager', () => {
  it('creates and lists sessions', () => {
    const { sessions } = setup();
    const a = sessions.create({ cwd: 'C:\\a' });
    const b = sessions.create({ cwd: 'C:\\b' });
    expect(a.title).toBe('Oturum 1');
    expect(b.title).toBe('Oturum 2');
    expect(sessions.list()).toHaveLength(2);
    expect(sessions.get(a.id)?.cwd).toBe('C:\\a');
  });

  it('sends a message and emits delta and done', async () => {
    const { sessions, events } = setup();
    const s = sessions.create({ cwd: 'C:\\a' });
    const r = await sessions.send(s.id, 'selam');
    expect(r.ok).toBe(true);
    expect(events.some((e) => e.type === 'delta' && e.delta.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(sessions.get(s.id)?.status).toBe('idle');
    expect(sessions.history(s.id).some((m) => m.content === 'merhaba')).toBe(true);
  });

  it('rejects a second message to a running session', async () => {
    const { sessions } = setup();
    const s = sessions.create({ cwd: 'C:\\a' });
    const first = sessions.send(s.id, 'bir');
    const second = await sessions.send(s.id, 'iki');
    expect(second).toEqual({ ok: false, error: 'busy' });
    await first;
  });

  it('returns an error for an unknown session', async () => {
    const { sessions } = setup();
    expect(await sessions.send('yok', 'x')).toEqual({ ok: false, error: 'unknown session' });
  });
});
