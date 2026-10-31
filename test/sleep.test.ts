import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { sleep, sleepProgress } from '../server/memory/sleep.js';
import { projectKey } from '../server/project.js';

function seeded() {
  const log = new EventLog(':memory:');
  log.append('message', 'user', 's1', { role: 'user' }, 'PDF raporu istiyorum puppeteer ile');
  log.append('message', 'session', 's1', { role: 'assistant' }, 'tamam');
  log.append('message', 'user', 's2', { role: 'user' }, 'veritabanı yedeği al');
  return { log, memory: new MemoryStore(log) };
}

describe('sleep', () => {
  it('distills sessions and saves progress', async () => {
    const { log, memory } = seeded();
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(report.ran).toBe(true);
    expect(report.sessionsProcessed).toBe(2);
    expect(report.notesAdded).toBeGreaterThanOrEqual(2);
    expect(memory.list().length).toBeGreaterThanOrEqual(2);
    expect(sleepProgress(log).done.map((d) => d.sessionId).sort()).toEqual(['s1', 's2']);
  });

  it('a second run does not reprocess finished sessions', async () => {
    const { log, memory } = seeded();
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-sleep-'));
    await sleep(log, memory, { dataDir });
    const before = memory.list().length;
    const second = await sleep(log, memory, { dataDir });
    expect(second.sessionsProcessed).toBe(0);
    expect(memory.list().length).toBe(before);
  });

  it('a turn added after sleep is processed', async () => {
    const { log, memory } = seeded();
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-sleep-'));
    await sleep(log, memory, { dataDir });
    log.append('message', 'user', 's1', { role: 'user' }, 'yeni konu: docker imajı küçültülsün');
    const second = await sleep(log, memory, { dataDir });
    expect(second.sessionsProcessed).toBe(1);
    expect(second.notesAdded).toBe(1);
  });

  it('linking does not repeat', async () => {
    const { log, memory } = seeded();
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-sleep-'));
    const shared = JSON.stringify([{ kind: 'semantic', text: 'puppeteer ile PDF raporu üretilir', concepts: ['puppeteer', 'pdf'], evidence: [1], importance: 0.7 }]);
    await sleep(log, memory, { dataDir, distiller: async () => shared });
    log.append('message', 'user', 's3', { role: 'user' }, 'puppeteer ile PDF raporu üretilir');
    const second = await sleep(log, memory, { dataDir, distiller: async () => shared });
    expect(second.linksAdded).toBe(0);
  });

  it('does nothing while the lock is held', async () => {
    const { log, memory } = seeded();
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-sleep-'));
    const first = sleep(log, memory, { dataDir, distiller: async () => '[]' });
    const second = await sleep(log, memory, { dataDir });
    await first;
    expect(second.ran).toBe(false);
    expect(second.skipped).toContain('already running');
  });

  it('returns a decay report', async () => {
    const { log, memory } = seeded();
    const old = memory.add({ kind: 'episodic', text: 'çok eski not', evidence: [1], base: 0.2 }, Date.now() - 500 * 86_400_000);
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(report.dormant).toContain(old.id);
  });

  it('runs without a model and writes only episodic', async () => {
    const { log, memory } = seeded();
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(report.llmCalls).toBe(0);
    expect(memory.list().every((n) => n.kind === 'episodic')).toBe(true);
  });

  it('marks a repeated error as trauma and does not rewrite it on the second sleep', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'electron ABI uyumsuzluğu yeniden derleme', evidence: [1], base: 0.5 });
    for (let i = 0; i < 3; i++) {
      log.append('error', 'brain', 'brain', { message: 'electron ABI uyumsuzluğu yeniden derleme' });
    }
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(report.traumaMarked).toContain(note.id);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
    const again = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(again.traumaMarked).toEqual([]);
  });

  it('an error in another project after the note does not mark trauma', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    log.append('session_start', 'session', 'sA', { cwd: 'C:\\a' });
    for (let i = 0; i < 3; i++) {
      log.append('error', 'brain', 'sA', { message: 'permission denied' });
    }
    const note = memory.add({
      kind: 'semantic',
      text: 'permission denied hatası çözümü',
      evidence: [1],
      base: 0.5,
      project: projectKey('C:\\b'),
    });
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(report.traumaMarked).toEqual([]);
    expect(memory.get(note.id)!.isTrauma).toBe(false);
  });

  it('a note that existed in the same project before the error is marked as trauma', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({
      kind: 'semantic',
      text: 'permission denied hatası çözümü',
      evidence: [1],
      base: 0.5,
      project: projectKey('C:\\a'),
    });
    log.append('session_start', 'session', 'sA', { cwd: 'C:\\a' });
    for (let i = 0; i < 3; i++) {
      log.append('error', 'brain', 'sA', { message: 'permission denied' });
    }
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    expect(report.traumaMarked).toContain(note.id);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
  });

  it('a hard correction writes the lesson to the new note, not the old wrong one', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const old = memory.add({ kind: 'semantic', text: 'yanlış eski bilgi', evidence: [1], base: 0.5 });
    memory.correct(old.id, 'yeni doğru bilgi', { cortisol: 0.9 });
    memory.correct(old.id, 'yeni doğru bilgi iki', { cortisol: 0.2 });
    const report = await sleep(log, memory, { dataDir: mkdtempSync(join(tmpdir(), 'karen-sleep-')) });
    const lesson = memory.list({ includeDormant: true }).find((n) => n.text === 'yeni doğru bilgi')!;
    expect(report.traumaMarked).toContain(lesson.id);
    expect(lesson.isTrauma).toBe(true);
    expect(memory.get(old.id)!.isTrauma).toBe(false);
    expect(memory.list({ includeDormant: true }).find((n) => n.text === 'yeni doğru bilgi iki')!.isTrauma).toBe(false);
  });
});
