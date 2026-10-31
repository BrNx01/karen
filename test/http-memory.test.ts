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

const TOKEN = 't';
const servers: KarenServer[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-mem-'));
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
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
    runSleep: async () => ({ ran: true, sessionsProcessed: 0, notesAdded: 0, rejected: [], dormant: [], woke: [], llmCalls: 0 }),
    rootDir: dir,
  });
  servers.push(server);
  return { server, memory, log };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

const api = (port: number, path: string) =>
  `http://127.0.0.1:${port}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;

describe('memory endpoints', () => {
  it('lists, searches, forgets and restores', async () => {
    const { server, log, memory } = setup();
    const { port } = await server.listen(0);
    const source = log.append('message', 'user', 's1', { role: 'user' }, 'pdf raporu').id;
    const note = memory.add({ kind: 'episodic', text: 'PDF raporu üretildi', evidence: [source], base: 0.9 });

    const list = (await (await fetch(api(port, '/api/memory'))).json()) as { id: string }[];
    expect(list).toHaveLength(1);

    const search = (await (await fetch(api(port, '/api/memory?q=pdf'))).json()) as { id: string }[];
    expect(search[0]?.id).toBe(note.id);

    expect((await fetch(api(port, `/api/memory/${note.id}/forget`), { method: 'POST' })).status).toBe(200);
    expect(((await (await fetch(api(port, '/api/memory'))).json()) as unknown[]).length).toBe(0);

    const forgotten = (await (await fetch(api(port, '/api/memory?forgotten=1'))).json()) as { id: string }[];
    expect(forgotten).toHaveLength(1);

    expect((await fetch(api(port, `/api/memory/${note.id}/restore`), { method: 'POST' })).status).toBe(200);
    expect(((await (await fetch(api(port, '/api/memory'))).json()) as unknown[]).length).toBe(1);
  });

  it('a correction writes new text', async () => {
    const { server, log, memory } = setup();
    const { port } = await server.listen(0);
    const source = log.append('message', 'user', 's1', { role: 'user' }, 'renk mavi').id;
    const note = memory.add({ kind: 'semantic', text: 'Renk mavi', evidence: [source], base: 0.8 });

    const res = await fetch(api(port, `/api/memory/${note.id}/correct`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Renk kırmızı' }),
    });
    expect(res.status).toBe(200);
    const list = (await (await fetch(api(port, '/api/memory'))).json()) as { text: string }[];
    expect(list.map((n) => n.text)).toContain('Renk kırmızı');
  });

  it('sleep can be triggered and requires a token', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/memory`)).status).toBe(401);
    const res = await fetch(api(port, '/api/memory/sleep'), { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ran: boolean }).ran).toBe(true);
  });
});
