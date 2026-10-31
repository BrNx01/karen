import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKarenServer, type EventHub, type KarenServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import type { ServerMsg } from '../server/http/protocol.js';
import WebSocket from 'ws';

const TOKEN = 't';
const servers: KarenServer[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-orch-'));
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([
      [{ type: 'text', text: 'beyin cevabı' }, { type: 'done', stopReason: 'end' }],
      [{ type: 'text', text: 'iş bitti' }, { type: 'done', stopReason: 'end' }],
    ]),
    model: 'm',
    log,
    approve: async () => true,
    onEvent: (e) => hub.send(e),
    memory,
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')),
    sessions,
    approvals: new ApprovalBroker(),
    hub,
    token: TOKEN,
    memory,
    rootDir: dir,
  });
  servers.push(server);
  return { server, sessions, memory, log };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

const api = (port: number, path: string) =>
  `http://127.0.0.1:${port}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;

describe('orchestration endpoints', () => {
  it('the brain role is opened via POST and is unique', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const post = (body: unknown) =>
      fetch(api(port, '/api/sessions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const first = (await (await post({ role: 'brain' })).json()) as { id: string; role: string };
    const second = (await (await post({ role: 'brain' })).json()) as { id: string };
    expect(first.role).toBe('brain');
    expect(second.id).toBe(first.id);
  });

  it('conflicts are listed and can be resolved', async () => {
    const { server, memory, log } = setup();
    const { port } = await server.listen(0);
    const s1 = log.append('message', 'user', 's1', { role: 'user' }, 'TypeScript kullanıyorum').id;
    const s2 = log.append('message', 'user', 's2', { role: 'user' }, 'TypeScript kullanmıyorum').id;
    const a = memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [s1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [s2], base: 0.8 });

    const conflicts = (await (await fetch(api(port, '/api/memory/conflicts'))).json()) as unknown[];
    expect(conflicts).toHaveLength(1);

    expect((await fetch(api(port, `/api/memory/${a.id}/resolve`), { method: 'POST' })).status).toBe(200);
  });

  it('the background notification is published over WS', async () => {
    const { server, sessions } = setup();
    const { port } = await server.listen(0);
    const brain = sessions.create({ role: 'brain', cwd: 'C:\\p' });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    const messages: ServerMsg[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMsg));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));

    sessions.notify(brain.id, 'test bildirimi');
    await waitFor(() => messages.some((m) => m.type === 'notice'));
    const notice = messages.find((m) => m.type === 'notice') as { text: string } | undefined;
    expect(notice?.text).toContain('test bildirimi');
    ws.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}
