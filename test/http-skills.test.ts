import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKarenServer, type EventHub, type KarenServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SkillStore } from '../server/skills.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';

const TOKEN = 't';
const servers: KarenServer[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-skills-'));
  const approvals = new ApprovalBroker();
  const hub: EventHub = { send: () => undefined };
  const skills = new SkillStore(join(dir, 'skills'));
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm',
    log: new EventLog(':memory:'),
    approve: async () => true,
    onEvent: (e) => hub.send(e),
    skills,
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')),
    sessions,
    approvals,
    hub,
    token: TOKEN,
    skills,
    rootDir: dir,
  });
  servers.push(server);
  return { dir, server, skills };
}

function skillRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'karen-skillrepo-'));
  mkdirSync(join(repo, 'a'), { recursive: true });
  writeFileSync(join(repo, 'a', 'SKILL.md'), '---\nname: Rapor\ndescription: Rapor üretir\n---\nGövde');
  return repo;
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

const api = (port: number, path: string) => `http://127.0.0.1:${port}${path}?token=${TOKEN}`;

describe('skill endpoints', () => {
  it('401 without a token', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/skills`)).status).toBe(401);
  });

  it('installs from a folder, lists, disables and deletes', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);

    const created = await fetch(api(port, '/api/skills'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: skillRepo() }),
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as unknown[]).length).toBe(1);

    const list = (await (await fetch(api(port, '/api/skills'))).json()) as { id: string; enabled: boolean }[];
    expect(list[0]).toMatchObject({ id: 'rapor', enabled: true });

    const patched = await fetch(api(port, '/api/skills/rapor'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patched.status).toBe(200);

    const removed = await fetch(api(port, '/api/skills/rapor'), { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(((await (await fetch(api(port, '/api/skills'))).json()) as unknown[]).length).toBe(0);
  });

  it('returns 400 when the folder has no skill', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(api(port, '/api/skills'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: mkdtempSync(join(tmpdir(), 'karen-bos-')) }),
    });
    expect(res.status).toBe(400);
  });
});
