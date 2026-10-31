import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startKarenServer } from '../server/serve.js';
import { SettingsStore } from '../server/settings.js';
import { EventLog } from '../server/store/events.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

const done = (text: string) => [{ type: 'text' as const, text }, { type: 'done' as const, stopReason: 'end' as const }];

function prepare() {
  const dataDir = mkdtempSync(join(tmpdir(), 'karen-wiring-'));
  // autonomy is enabled from the user setting.
  new SettingsStore(dataDir).set({
    autonomy: { enabled: true, idleMinutes: 5, dailyRuns: 24, research: false },
  });
  // the curiosity drive is born from a term that appears in two separate messages.
  const log = new EventLog(join(dataDir, 'events.db'));
  log.append('message', 'user', 'u1', { role: 'user' }, 'kubernetes kurulumu nasıl yapılır');
  log.append('message', 'user', 'u2', { role: 'user' }, 'kubernetes sürümü hangisi');
  log.close();

  // the distiller returns a note citing the first transcript line in the prompt.
  const distiller = vi.fn(async (prompt: string) => {
    const line = prompt.split('\n').find((l) => /^\[#\d+ user\] /.test(l)) ?? '';
    const id = Number(/^\[#(\d+) /.exec(line)?.[1] ?? 0);
    const text = line.replace(/^\[#\d+ [^\]]+\] /, '').split(' ').slice(0, 6).join(' ');
    return JSON.stringify([{ kind: 'semantic', text, concepts: ['otonom'], evidence: [id], importance: 0.6 }]);
  });
  return { dataDir, distiller };
}

describe('autonomous process wiring', () => {
  it('uses the distiller on a real server and leaves a single inbox row', async () => {
    const { dataDir, distiller } = prepare();
    const server = await startKarenServer({
      dataDir,
      provider: new FakeProvider([done('Otonom çıktı satırı')]),
      distiller,
      autonomyIdleMinutes: 0,
    });
    try {
      expect(server.autonomy.tick().ran).toBe(true);
      await vi.waitFor(() => expect(server.autonomy.stats().runsToday).toBe(1), { timeout: 2000 });

      // C1: the distiller is really wired to the DMN; a semantic note is written instead of a prompt summary.
      expect(distiller).toHaveBeenCalled();
      const notes = server.memory.list({ includeDormant: true });
      // the deterministic episodic summary is always written; the semantic note only with a wired distiller.
      expect(notes.some((n) => n.kind === 'semantic')).toBe(true);

      const inbox = (await fetch(`http://127.0.0.1:${server.port()}/api/inbox?token=${server.token}`).then((r) =>
        r.json(),
      )) as { items: { id: number }[] };
      expect(inbox.items).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('no new dmn_run is written after shutdown', async () => {
    const { dataDir, distiller } = prepare();
    const server = await startKarenServer({
      dataDir,
      provider: new FakeProvider([done('ilk tur')]),
      distiller,
      autonomyIdleMinutes: 0,
    });
    expect(server.autonomy.tick().ran).toBe(true);
    await vi.waitFor(() => expect(server.autonomy.stats().runsToday).toBe(1), { timeout: 2000 });
    await server.close();

    const runsBefore = countRuns(dataDir);
    expect(runsBefore).toBe(1);
    expect(server.autonomy.tick().ran).toBe(false);
    // a closed server does not try to write to the log.
    expect(countRuns(dataDir)).toBe(runsBefore);
  });

  it('the autonomous session prompt is marked separately in the log', async () => {
    const { dataDir, distiller } = prepare();
    const server = await startKarenServer({
      dataDir,
      provider: new FakeProvider([done('rapor')]),
      distiller,
      autonomyIdleMinutes: 0,
    });
    try {
      expect(server.autonomy.tick().ran).toBe(true);
      await vi.waitFor(() => expect(server.autonomy.stats().runsToday).toBe(1), { timeout: 2000 });
      const events = readEvents(dataDir);
      // I3: the driver prompt is a user message in the log; the session must carry its autonomous flag.
      const sessionId = events.find((e) => e.kind === 'dmn_run')?.payload['sessionId'];
      const start = events.find((e) => e.kind === 'session_start' && e.sessionId === sessionId)!;
      expect(start.payload['autonomous']).toBe(true);
      expect(events.some((e) => e.kind === 'message' && e.sessionId === sessionId)).toBe(true);
    } finally {
      await server.close();
    }
  });
});

function readEvents(dataDir: string) {
  const log = new EventLog(join(dataDir, 'events.db'));
  try {
    return log.read();
  } finally {
    log.close();
  }
}

function countRuns(dataDir: string): number {
  return readEvents(dataDir).filter((e) => e.kind === 'dmn_run').length;
}
