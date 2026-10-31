import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';

function setup(opts: { withMemory?: boolean } = {}) {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const provider = new FakeProvider([[{ type: 'done', stopReason: 'end' }], [{ type: 'done', stopReason: 'end' }]]);
  const sessions = new SessionManager({
    provider,
    model: 'm',
    log,
    approve: async () => true,
    onEvent: () => undefined,
    identity: () => 'SEN KARENSUN',
    ...(opts.withMemory === false ? {} : { memory }),
  });
  return { log, memory, provider, sessions };
}

const systemOf = (provider: FakeProvider, index = 0): string =>
  provider.calls[index]?.messages.find((m) => m.role === 'system')?.content ?? '';

describe('bellek entegrasyonu', () => {
  it('places the relevant memory in the system context with its source', async () => {
    const { log, memory, provider, sessions } = setup();
    const source = log.append('message', 'user', 'old', { role: 'user' }, 'pdf raporu puppeteer').id;
    memory.add({ kind: 'episodic', text: 'PDF raporu puppeteer ile üretildi', evidence: [source], base: 0.9 });

    const session = sessions.create({ cwd: '.' });
    await sessions.send(session.id, 'geçen sefer pdf raporunu nasıl yapmıştık?');

    const system = systemOf(provider);
    expect(system).toContain('SEN KARENSUN');
    expect(system).toContain('## Related memories');
    expect(system).toContain('puppeteer');
    expect(system).toContain(`kaynak: ${source}`);
  });

  it('recall increments the usage counter of the note', async () => {
    const { log, memory, sessions } = setup();
    const source = log.append('message', 'user', 'old', { role: 'user' }, 'veritabanı yedeği').id;
    const note = memory.add({ kind: 'episodic', text: 'veritabanı yedeği alındı', evidence: [source], base: 0.9 });
    const session = sessions.create({ cwd: '.' });
    await sessions.send(session.id, 'veritabanı yedeği nasıl alınıyordu?');
    expect(memory.get(note.id)?.recallCount).toBe(1);
  });

  it('no memory section is added for an unrelated question', async () => {
    const { memory, provider, sessions } = setup();
    memory.add({ kind: 'episodic', text: 'tamamen alakasız bilgi', evidence: [1], base: 0.5 });
    const session = sessions.create({ cwd: '.' });
    await sessions.send(session.id, 'merhaba');
    expect(systemOf(provider)).not.toContain('## Related memories');
  });

  it('identity still loads without memory', async () => {
    const { provider, sessions } = setup({ withMemory: false });
    const session = sessions.create({ cwd: '.' });
    await sessions.send(session.id, 'selam');
    const system = systemOf(provider);
    expect(system).toContain('SEN KARENSUN');
    expect(system).not.toContain('## Related memories');
  });
});

void mkdtempSync;
void tmpdir;
void join;
