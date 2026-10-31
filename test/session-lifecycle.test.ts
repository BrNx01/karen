import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { startKarenServer } from '../server/serve.js';

const done = (text: string) => [{ type: 'text' as const, text }, { type: 'done' as const, stopReason: 'end' as const }];

describe('session lifecycle', () => {
  it('a finished worker transcript is not kept in memory and stays in the log', async () => {
    const log = new EventLog(':memory:');
    const manager = new SessionManager({
      provider: new FakeProvider([done('iş bitti')]),
      model: 'm',
      log,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const worker = manager.create({ cwd: 'C:\\p', title: 'W' });
    await manager.send(worker.id, 'yap');
    expect(log.read(worker.id).some((e) => e.kind === 'message')).toBe(true);
    expect(manager.history(worker.id).length).toBeGreaterThan(0);
  });

  it('pruneWorkers removes surplus finished sessions', async () => {
    const log = new EventLog(':memory:');
    const manager = new SessionManager({
      provider: new FakeProvider(Array.from({ length: 5 }, () => done('x'))),
      model: 'm',
      log,
      approve: async () => true,
      onEvent: () => undefined,
    });
    for (let i = 0; i < 5; i++) {
      const w = manager.create({ cwd: 'C:\\p', title: `W${i}` });
      await manager.send(w.id, 'iş');
    }
    const removed = manager.pruneWorkers(2);
    expect(removed).toBe(3);
    expect(manager.list().filter((s) => s.role === 'worker')).toHaveLength(2);
  });

  it('pruneWorkers also prunes workers in error state', async () => {
    const log = new EventLog(':memory:');
    const manager = new SessionManager({
      provider: {
        name: 'boom',
        async *stream() {
          throw new Error('sağlayıcı yok');
        },
      },
      model: 'm',
      log,
      approve: async () => true,
      onEvent: () => undefined,
    });
    for (let i = 0; i < 3; i++) {
      const w = manager.create({ cwd: 'C:\\p', title: `E${i}` });
      await manager.send(w.id, 'iş');
      expect(manager.get(w.id)?.status).toBe('error');
    }
    expect(manager.pruneWorkers(1)).toBe(2);
    expect(manager.list().filter((s) => s.role === 'worker')).toHaveLength(1);
  });

  it('on restart the brain returns with the same id and history', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-restart-'));
    const cwd = mkdtempSync(join(tmpdir(), 'karen-cwd-'));

    const first = await startKarenServer({
      dataDir,
      cwd,
      provider: new FakeProvider([done('ilk cevap')]),
    });
    const brainId = first.memory ? (await first.memory.list()) : [];
    void brainId;
    const sessionsBefore = await fetch(`http://127.0.0.1:${first.port()}/api/sessions?token=${first.token}`).then(
      (r) => r.json() as Promise<{ id: string; role: string }[]>,
    );
    const brainIdBefore = sessionsBefore.find((s) => s.role === 'brain')?.id;
    expect(brainIdBefore).toBeDefined();

    // send a message to the brain, then close the server.
    await fetch(`http://127.0.0.1:${first.port()}/api/sessions?token=${first.token}`);
    const wsUrl = `ws://127.0.0.1:${first.port()}/ws?token=${first.token}`;
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'message', sessionId: brainIdBefore, text: 'merhaba' }));
    await new Promise((r) => setTimeout(r, 300));
    ws.close();
    await first.close();

    const second = await startKarenServer({ dataDir, cwd, provider: new FakeProvider([done('ikinci')]) });
    const sessionsAfter = await fetch(`http://127.0.0.1:${second.port()}/api/sessions?token=${second.token}`).then(
      (r) => r.json() as Promise<{ id: string; role: string }[]>,
    );
    expect(sessionsAfter.find((s) => s.role === 'brain')?.id).toBe(brainIdBefore);
    await second.close();
  });
});
