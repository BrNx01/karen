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
import { MemoryStore } from '../server/memory/notes.js';

const TOKEN = 't';
const servers: KarenServer[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-trauma-'));
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const note = memory.add({ kind: 'semantic', text: 'asla unutulmayacak', evidence: [1], base: 0.5 });
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm', log, approve: async () => true, onEvent: (e) => hub.send(e),
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')), sessions, approvals: new ApprovalBroker(),
    hub, token: TOKEN, rootDir: dir, memory,
  });
  servers.push(server);
  return { server, memory, note };
}

describe('POST /api/memory/:id/trauma', () => {
  it('token ister', async () => {
    const { server, note } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/${note.id}/trauma`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('marks the note as trauma', async () => {
    const { server, memory, note } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/${note.id}/trauma?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
  });

  it('bilinmeyen kimlikte 404', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/yok/trauma?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('a second mark returns 200 and the note stays trauma', async () => {
    const { server, memory, note } = setup();
    const { port } = await server.listen(0);
    const url = `http://127.0.0.1:${port}/api/memory/${note.id}/trauma?token=${TOKEN}`;
    expect((await fetch(url, { method: 'POST' })).status).toBe(200);
    expect((await fetch(url, { method: 'POST' })).status).toBe(200);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
  });
});
