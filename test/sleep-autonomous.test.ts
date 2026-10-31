import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { sleep, readCheckpoints } from '../server/memory/sleep.js';

describe('sleep and autonomous sessions', () => {
  it('does not distill an autonomous session and advances the checkpoint', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    log.append('session_start', 'brain', 'auto-1', { cwd: 'C:\\p', role: 'worker', autonomous: true });
    log.append('message', 'user', 'auto-1', { role: 'user' }, 'kendi kendine araştırma yapıldı');
    log.append('message', 'session', 'auto-1', { role: 'assistant' }, 'bulundu: bir kütüphane');

    const report = await sleep(log, memory, { now: Date.now() });
    expect(report.skippedAutonomous).toContain('auto-1');
    expect(memory.list({ includeDormant: true })).toHaveLength(0);
    expect(readCheckpoints(log).get('auto-1')).toBeGreaterThan(0);

    // because the checkpoint advanced, the second sleep does not see the same autonomous session again.
    const second = await sleep(log, memory, { now: Date.now() });
    expect(second.skippedAutonomous).toHaveLength(0);
    expect(second.sessionsProcessed).toBe(0);
    expect(memory.list({ includeDormant: true })).toHaveLength(0);
  });

  it('a normal session is still distilled', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    log.append('session_start', 'user', 's1', { cwd: 'C:\\p', role: 'worker' });
    log.append('message', 'user', 's1', { role: 'user' }, 'kullanıcı kısa cevap istiyor');
    const report = await sleep(log, memory, { now: Date.now() });
    expect(report.sessionsProcessed).toBe(1);
    expect(report.skippedAutonomous ?? []).toHaveLength(0);
  });
});
