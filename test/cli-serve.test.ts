import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../server/cli.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

describe('karen serve', () => {
  it('starts the server and health responds', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-serve-'));
    const provider = new FakeProvider([[{ type: 'text', text: 'ok' }, { type: 'done', stopReason: 'end' }]]);
    let health = 0;

    const code = await main(['serve', '--port', '0'], {
      provider,
      dataDir,
      onReady: async (server) => {
        health = (await fetch(`http://127.0.0.1:${server.port()}/api/health`)).status;
      },
    });

    expect(health).toBe(200);
    expect(code).toBe(0);
  });

  it('returns 1 on an invalid port', async () => {
    expect(await main(['serve', '--port', 'abc'], {})).toBe(1);
  });
});
