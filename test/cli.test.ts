import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../server/cli.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

describe('cli', () => {
  it('runs the task and closes the session', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
    const logPath = join(cwd, 'events.db');
    const provider = new FakeProvider([[{ type: 'text', text: 'tamam' }, { type: 'done', stopReason: 'end' }]]);
    const code = await main(['run', 'merhaba', '--cwd', cwd, '--log', logPath], {
      provider,
      cwd,
      readline: async () => 'e',
    });
    expect(code).toBe(0);
  });

  it('returns 1 on a provider error', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
    const provider = {
      name: 'boom',
      async *stream() {
        throw new Error('yok');
      },
    };
    const code = await main(['run', 'x', '--cwd', cwd, '--log', join(cwd, 'e.db')], {
      provider,
      cwd,
      readline: async () => 'e',
    });
    expect(code).toBe(1);
  });
});
