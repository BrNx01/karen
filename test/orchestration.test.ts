import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../server/sessions.js';
import { sessionTools } from '../server/engine/tools/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import type { ServerEvent } from '../server/sessions.js';
import type { Delta } from '../server/engine/types.js';

function setup(script: Delta[][]) {
  const log = new EventLog(':memory:');
  const events: ServerEvent[] = [];
  const provider = new FakeProvider(script);
  const manager = new SessionManager({
    provider,
    model: 'm',
    log,
    approve: async () => true,
    onEvent: (e) => events.push(e),
    maxBackground: 2,
  });
  return { log, events, provider, manager };
}

const done = (text: string): Delta[] => [{ type: 'text', text }, { type: 'done', stopReason: 'end' }];

describe('brain role', () => {
  it('only one brain exists and the default role is worker', () => {
    const { manager } = setup([done('a'), done('b')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    const second = manager.create({ role: 'brain' });
    expect(second.id).toBe(brain.id);
    expect(manager.brain()?.id).toBe(brain.id);
    expect(manager.create().role).toBe('worker');
  });

  it('the brain gets orchestration instructions in the system context', async () => {
    const { manager, provider } = setup([done('selam')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    await manager.send(brain.id, 'merhaba');
    const system = provider.calls[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain("You are KAREN's brain");
    expect(provider.calls[0]?.tools.map((t) => t.name)).toContain('spawn_session');
  });

  it('a worker has no brain instructions or session tools in its system context', async () => {
    const { manager, provider } = setup([done('iş')]);
    const worker = manager.create({ cwd: 'C:\\p' });
    await manager.send(worker.id, 'yap');
    const system = provider.calls[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).not.toContain('beynisin');
    expect(provider.calls[0]?.tools.map((t) => t.name)).not.toContain('spawn_session');
  });
});

describe('background sessions', () => {
  it('leaves a notification for the brain on completion', async () => {
    const { manager, events } = setup([done('rapor hazır')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    const worker = manager.create({ cwd: 'C:\\p', title: 'Rapor' });

    manager.startBackground(worker.id, 'rapor üret', brain.id);
    await waitFor(() => manager.get(worker.id)?.status === 'idle');

    const notice = events.find((e) => e.type === 'notice' && e.sessionId === brain.id);
    expect(notice).toBeDefined();
    expect(events.some((e) => e.type === 'notice' && e.text.includes('rapor hazır'))).toBe(true);
  });

  it('a pending notification enters the start of the brain turn', async () => {
    const { manager, provider } = setup([done('tamam')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    manager.notify(brain.id, 'Rapor oturumu bitti: dosya hazır');
    await manager.send(brain.id, 'durum ne?');

    const messages = provider.calls[0]?.messages ?? [];
    const injected = messages.find((m) => m.content.startsWith('[background notice]'));
    expect(injected?.content).toContain('Rapor oturumu bitti');
  });

  it('spawn_session opens no session when the limit is full', async () => {
    const { manager, events } = setup([done('a'), done('b'), done('c')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    const w1 = manager.create({ cwd: 'C:\\p', title: 'W1' });
    const w2 = manager.create({ cwd: 'C:\\p', title: 'W2' });

    manager.startBackground(w1.id, 'iş 1', brain.id);
    manager.startBackground(w2.id, 'iş 2', brain.id);

    const tools = sessionTools(manager, brain.id);
    const spawn = tools.find((t) => t.def.name === 'spawn_session')!;
    const before = manager.list().length;
    const result = await spawn.run({ task: 'iş 3', cwd: 'C:\\p' }, { cwd: 'C:\\p', signal: new AbortController().signal });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('limit reached');
    expect(manager.list().length).toBe(before); // hayalet oturum açılmadı
    expect(events.some((e) => e.type === 'notice' && e.text.includes('sınırı'))).toBe(false);
    await waitFor(() => manager.activeBackground() === 0);
  });

  it('spawn_session rejects a folder outside the project', async () => {
    const { manager } = setup([done('a')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\proj' });
    const tools = sessionTools(manager, brain.id);
    const spawn = tools.find((t) => t.def.name === 'spawn_session')!;
    const result = await spawn.run(
      { task: 'x', cwd: 'C:\\Windows\\System32' },
      { cwd: 'C:\\proj', signal: new AbortController().signal },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain('cwd not allowed');
  });

  it('beyin kendini iptal edemez', async () => {
    const { manager } = setup([done('a')]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    const tools = sessionTools(manager, brain.id);
    const cancel = tools.find((t) => t.def.name === 'session_cancel')!;
    const result = await cancel.run({ sessionId: brain.id }, { cwd: '.', signal: new AbortController().signal });
    expect(result.ok).toBe(false);
  });

  it('a background session notifies the brain and turns waiting when it needs approval', async () => {
    const log = new EventLog(':memory:');
    const events: ServerEvent[] = [];
    let release: ((value: boolean) => void) | undefined;
    const manager = new SessionManager({
      provider: new FakeProvider([
        [
          { type: 'tool_call', call: { id: 'c1', name: 'run_command', args: { command: 'rm -rf dist' } } },
          { type: 'done', stopReason: 'tool_use' },
        ],
        done('bitti'),
      ]),
      model: 'm',
      log,
      approve: (sessionId, req) => {
        // Beyin oturumu otomatik; worker onay bekler.
        if (manager.get(sessionId)?.role === 'brain') return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      },
      onEvent: (e) => events.push(e),
    });
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    const worker = manager.create({ cwd: 'C:\\p', title: 'Temizlik' });

    manager.startBackground(worker.id, 'dist sil', brain.id);

    await waitFor(() => manager.get(worker.id)?.status === 'waiting');
    expect(events.some((e) => e.type === 'notice' && e.text.includes('onay bekliyor'))).toBe(true);

    release?.(false);
    await waitFor(() => manager.get(worker.id)?.status === 'idle');
  });

  it('a cancelled background session produces no error notification', async () => {
    const { manager, events } = setup([
      [{ type: 'text', text: 'x' }, { type: 'done', stopReason: 'end' }],
    ]);
    const brain = manager.create({ role: 'brain', cwd: 'C:\\p' });
    const worker = manager.create({ cwd: 'C:\\p', title: 'Uzun' });
    manager.startBackground(worker.id, 'uzun iş', brain.id);
    manager.abort(worker.id);
    await waitFor(() => manager.activeBackground() === 0);
    expect(events.some((e) => e.type === 'notice' && e.text.includes('başarısız'))).toBe(false);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

void mkdtempSync;
void tmpdir;
void join;
