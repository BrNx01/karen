import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../server/store/events.js';
import { main } from '../server/cli.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { MemoryStore } from '../server/memory/notes.js';

describe('karen sleep', () => {
  it('deterministic sleep runs without a model', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-sleepcli-'));
    const log = new EventLog(join(dataDir, 'events.db'));
    log.append('message', 'user', 's1', { role: 'user' }, 'pdf raporu istiyorum');
    log.close();

    const code = await main(['sleep', '--data', dataDir], { dataDir });
    expect(code).toBe(0);

    const log2 = new EventLog(join(dataDir, 'events.db'));
    const notes = new MemoryStore(log2).list();
    log2.close();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('episodic');
  });

  it('uses the injected provider for distillation', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-sleepcli-'));
    const log = new EventLog(join(dataDir, 'events.db'));
    const userEvent = log.append('message', 'user', 's1', { role: 'user' }, 'pdf raporu istiyorum');
    log.close();

    const provider = new FakeProvider([
      [
        {
          type: 'text',
          text: JSON.stringify([
            { kind: 'semantic', text: 'PDF raporu istendi', concepts: ['pdf'], evidence: [userEvent.id], importance: 0.8 },
          ]),
        },
        { type: 'done', stopReason: 'end' },
      ],
    ]);

    const code = await main(['sleep', '--data', dataDir], { dataDir, provider });
    expect(code).toBe(0);

    const log2 = new EventLog(join(dataDir, 'events.db'));
    const notes = new MemoryStore(log2).list();
    log2.close();
    expect(notes.some((n) => n.kind === 'semantic')).toBe(true);
  });
});
