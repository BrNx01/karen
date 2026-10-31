import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKarenServer, type EventHub, type KarenServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { StateStore } from '../server/brain/store.js';

const TOKEN = 't';
const servers: KarenServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function setup(withState = true) {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-state-'));
  const log = new EventLog(':memory:');
  const state = new StateStore(log);
  // derived signal: comes from the log event and is not recorded separately.
  log.append('error', 'system', 's1', { message: 'boom' });
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm',
    log,
    state,
    approve: async () => true,
    onEvent: (e) => hub.send(e),
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')),
    sessions,
    approvals: new ApprovalBroker(),
    hub,
    token: TOKEN,
    rootDir: dir,
    ...(withState
      ? {
          state: {
            current: () => state.current(),
            history: (limit) => state.history(limit),
            temperature: () => state.temperature(),
          },
        }
      : {}),
  });
  servers.push(server);
  return { server, state };
}

describe('GET /api/state', () => {
  it('token ister', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when state is off', async () => {
    const { server } = setup(false);
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/state?token=${TOKEN}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('state disabled');
  });

  it('returns the vector, temperature and history', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/state?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { cortisol: number }; temperature: number; history: unknown[] };
    expect(body.state.cortisol).toBeGreaterThan(0.3);
    expect(body.temperature).toBeLessThanOrEqual(1);
    expect(Array.isArray(body.history)).toBe(true);
  });
});
