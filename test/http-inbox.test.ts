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
import { InboxStore } from '../server/autonomy/inbox.js';

const TOKEN = 't';
const servers: KarenServer[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

function setup(extra: { onActivity?: () => void } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'karen-inbox-'));
  const log = new EventLog(':memory:');
  const inbox = new InboxStore(log);
  inbox.add({ kind: 'research', text: 'RISC-V makalesi' });
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm', log, approve: async () => true, onEvent: (e) => hub.send(e),
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')), sessions,
    approvals: new ApprovalBroker(), hub, token: TOKEN, rootDir: dir,
    inbox: { list: (o) => inbox.list(o), markRead: (id) => inbox.markRead(id), unreadCount: () => inbox.unreadCount() },
    ...(extra.onActivity ? { onActivity: extra.onActivity } : {}),
  });
  servers.push(server);
  return { server, inbox };
}

describe('/api/inbox', () => {
  it('token ister', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/inbox`)).status).toBe(401);
  });

  it('returns rows and the unread count', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/inbox?token=${TOKEN}`)).json()) as {
      items: { id: number; text: string }[]; unread: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.unread).toBe(1);
  });

  it('marks as read', async () => {
    const { server, inbox } = setup();
    const { port } = await server.listen(0);
    const id = inbox.list()[0]!.id;
    const res = await fetch(`http://127.0.0.1:${port}/api/inbox/${id}/read?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(inbox.unreadCount()).toBe(0);
  });

  it('404 when the inbox is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-inbox-off-'));
    const hub: EventHub = { send: () => undefined };
    const sessions = new SessionManager({
      provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
      model: 'm', log: new EventLog(':memory:'), approve: async () => true, onEvent: (e) => hub.send(e),
    });
    const server = createKarenServer({
      repos: new RepoStore(join(dir, 'r.json')), sessions, approvals: new ApprovalBroker(),
      hub, token: TOKEN, rootDir: dir,
    });
    servers.push(server);
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/inbox?token=${TOKEN}`)).status).toBe(404);
  });
});

describe('onActivity', () => {
  it('the request does not fail when the hook throws', async () => {
    const { server, inbox } = setup({
      onActivity: () => {
        throw new Error('kanca bozuk');
      },
    });
    const { port } = await server.listen(0);
    const id = inbox.list()[0]!.id;
    const res = await fetch(`http://127.0.0.1:${port}/api/inbox/${id}/read?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(inbox.unreadCount()).toBe(0);
  });

  it('GET does not count, POST does', async () => {
    let calls = 0;
    const { server, inbox } = setup({ onActivity: () => { calls += 1; } });
    const { port } = await server.listen(0);
    const base = `http://127.0.0.1:${port}`;
    await fetch(`${base}/api/dashboard?token=${TOKEN}`);
    await fetch(`${base}/api/sessions?token=${TOKEN}`);
    await fetch(`${base}/api/inbox?token=${TOKEN}`);
    expect(calls).toBe(0);

    const id = inbox.list()[0]!.id;
    await fetch(`${base}/api/inbox/${id}/read?token=${TOKEN}`, { method: 'POST' });
    expect(calls).toBe(1);
  });
});
