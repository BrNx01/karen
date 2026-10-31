import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createKarenServer, type EventHub, type KarenServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import type { ServerMsg } from '../server/http/protocol.js';
import type { Delta } from '../server/engine/types.js';

const TOKEN = 'test-token';
const servers: KarenServer[] = [];

function setup(opts: { script?: Delta[][] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-'));
  const log = new EventLog(':memory:');
  const provider = new FakeProvider(opts.script ?? [[{ type: 'text', text: 'merhaba' }, { type: 'done', stopReason: 'end' }]]);
  const repos = new RepoStore(join(dir, 'repos.json'));
  const approvals = new ApprovalBroker();
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider,
    model: 'm',
    log,
    onEvent: (e) => hub.send(e),
    approve: (sessionId, req) => approvals.ask(sessionId, req, (m) => hub.send(m)),
  });
  const server = createKarenServer({ repos, sessions, approvals, hub, token: TOKEN, rootDir: dir });
  servers.push(server);
  return { dir, server, repos, sessions, approvals, provider };
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await server.close();
  }
});

describe('http sunucusu', () => {
  it('api returns 401 without a token, health stays open', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/repos`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/api/repos?token=${TOKEN}`)).status).toBe(200);
  });

  it('adds and lists repositories', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const created = await fetch(`http://127.0.0.1:${port}/api/repos?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\work\\proje' }),
    });
    expect(created.status).toBe(201);
    const list = (await (await fetch(`http://127.0.0.1:${port}/api/repos?token=${TOKEN}`)).json()) as { name: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('proje');
  });

  it('a wrong origin is rejected', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/repos?token=${TOKEN}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('opens a session and publishes the message feed', async () => {
    const { server, sessions } = setup();
    const { port } = await server.listen(0);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    const messages: ServerMsg[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMsg));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const session = sessions.create({ cwd: 'C:\\a' });
    ws.send(JSON.stringify({ type: 'message', sessionId: session.id, text: 'selam' }));

    await waitFor(() => messages.some((m) => m.type === 'done'), 3000);
    expect(messages.some((m) => m.type === 'delta' && m.delta.type === 'text')).toBe(true);
    ws.close();
  });

  it('ws is rejected with a wrong token', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=yanlis`);
    const failed = await new Promise<boolean>((resolve) => {
      ws.once('open', () => resolve(false));
      ws.once('error', () => resolve(true));
    });
    expect(failed).toBe(true);
  });

  it('cannot resolve another session approval request', async () => {
    const { server, sessions, approvals } = setup();
    const { port } = await server.listen(0);
    const session = sessions.create({ cwd: 'C:\\a' });
    const pending = approvals.ask(session.id, { tool: 'run_command', access: 'exec', args: {}, cwd: '.' }, () => undefined);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    const messages: ServerMsg[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMsg));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));

    ws.send(JSON.stringify({ type: 'approval', sessionId: 'baska', requestId: 'yok', allow: true }));
    await waitFor(() => messages.some((m) => m.type === 'error'), 2000);
    expect(approvals.pending(session.id)).toHaveLength(1);

    approvals.cancelSession(session.id);
    await expect(pending).resolves.toBe(false);
    ws.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}
