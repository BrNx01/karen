import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createKarenServer, type EventHub, type KarenServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { SettingsStore } from '../server/settings.js';

const TOKEN = 't';
const servers: KarenServer[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-settings-'));
  const settings = new SettingsStore(dir, {});
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm',
    log: new EventLog(':memory:'),
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
    settings: {
      get: () => settings.public(),
      patch: (patch) => {
        settings.set(patch);
        return settings.public();
      },
      secrets: (patch) => {
        settings.setSecrets(patch);
        return settings.public();
      },
      providerInfo: () => ({ label: 'test', active: 'fake', model: 'm' }),
    },
  });
  servers.push(server);
  return { server, settings };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

const api = (port: number, path: string) => `http://127.0.0.1:${port}${path}?token=${TOKEN}`;

describe('settings endpoints', () => {
  it('requires a token and returns masked settings', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/settings`)).status).toBe(401);

    const res = await fetch(api(port, '/api/settings'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['provider']).toBe('ollama');
    expect((body['secrets'] as Record<string, boolean>).anthropic).toBe(false);
    expect((body['providerInfo'] as Record<string, string>).active).toBe('fake');
  });

  it('settings are updated', async () => {
    const { server, settings } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(api(port, '/api/settings'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5', speakReplies: false, maxBackground: 5 }),
    });
    expect(res.status).toBe(200);
    expect(settings.get().model).toBe('qwen2.5');
    expect(settings.get().speakReplies).toBe(false);
    expect(settings.get().maxBackground).toBe(5);
  });

  it('the secret is written and masked', async () => {
    const { server, settings } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(api(port, '/api/settings/secrets'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anthropic: 'sk-abc' }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['secrets'] as Record<string, boolean>).anthropic).toBe(true);
    expect(JSON.stringify(body)).not.toContain('sk-abc');
    expect(settings.apiKey('anthropic')).toBe('sk-abc');
  });
});
