import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { memoryTools } from '../server/engine/tools/memory.js';
import { retrievability } from '../server/memory/fsrs.js';

const ctx = { cwd: '.', signal: new AbortController().signal };

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const tools = memoryTools(memory);
  const find = (name: string) => tools.find((t) => t.def.name === name)!;
  return { log, memory, find };
}

const DAY = 86_400_000;

describe('FSRS memory behaviour', () => {
  it('review raises storage strength and never lowers it', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'semantic', text: 'kullanıcı Türkçe sever', evidence: [1], base: 0.6 });
    expect(memory.get(note.id)?.storage).toBe(1);

    memory.review(note.id, 'good');
    const once = memory.get(note.id)!;
    expect(once.storage).toBe(2);
    expect(once.stability).toBeGreaterThan(note.stability);

    memory.review(note.id, 'again');
    const afterAgain = memory.get(note.id)!;
    // "again" does not lower storage (persistence), it only lowers stability.
    expect(afterAgain.storage).toBe(2);
    expect(afterAgain.stability).toBeLessThan(once.stability);
  });

  it('a note reviewed three times does not go cold', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'semantic', text: 'önemli kalıcı bilgi', evidence: [1], base: 0.6 }, Date.now() - 2000 * DAY);
    for (let i = 0; i < 3; i++) memory.review(note.id, 'good');

    const result = memory.decay(Date.now() + 20_000 * DAY);
    expect(result.dormant).not.toContain(note.id);
    expect(memory.get(note.id)?.dormant).toBe(false);
  });

  it('an unreviewed note eventually goes cold', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'episodic', text: 'unutulacak ayrıntı', evidence: [1], base: 0.2 });
    const result = memory.decay(Date.now() + 400 * DAY);
    expect(result.dormant).toContain(note.id);
    // it is not deleted: it stays in cold storage.
    expect(memory.list({ includeDormant: true })).toHaveLength(1);
  });

  it('automatic recall alone does not make a note immortal', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'episodic', text: 'sık bağlama giren not', evidence: [1], base: 0.2 });
    memory.recordRecall([note.id], Date.now());
    memory.recordRecall([note.id], Date.now());
    expect(memory.get(note.id)?.storage).toBe(1);
    const result = memory.decay(Date.now() + 400 * DAY);
    expect(result.dormant).toContain(note.id);
  });

  it('retrievability rises after review', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'semantic', text: 'süresi geçen bilgi', evidence: [1], base: 0.5 }, Date.now() - 300 * DAY);
    const before = retrievability(300, note.stability);
    memory.review(note.id, 'good');
    expect(memory.get(note.id)!.stability).toBeGreaterThan(note.stability);
    expect(before).toBeLessThan(retrievability(0, 1));
  });

  it('rebuild keeps the FSRS state', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'semantic', text: 'yeniden inşa sınavı', evidence: [1], base: 0.7 });
    memory.review(note.id, 'easy');
    memory.review(note.id, 'good');
    const before = memory.get(note.id)!;
    memory.rebuild();
    const after = memory.get(note.id)!;
    expect(after.stability).toBeCloseTo(before.stability, 6);
    expect(after.storage).toBe(before.storage);
    expect(after.difficulty).toBeCloseTo(before.difficulty, 6);
  });
});

describe('memory tools', () => {
  it('memory_review strengthens the note', async () => {
    const { memory, find } = setup();
    const note = memory.add({ kind: 'semantic', text: 'araçla incelenecek', evidence: [1], base: 0.5 });
    const result = await find('memory_review').run({ noteId: note.id, grade: 'good' }, ctx);
    expect(result.ok).toBe(true);
    expect(memory.get(note.id)?.storage).toBe(2);
  });

  it('error for an unknown note', async () => {
    const { find } = setup();
    const result = await find('memory_review').run({ noteId: 'yok' }, ctx);
    expect(result.ok).toBe(false);
  });

  it('memory_search cites sources', async () => {
    const { memory, find } = setup();
    memory.add({ kind: 'episodic', text: 'PDF raporu puppeteer ile üretildi', evidence: [7], base: 0.8 });
    const result = await find('memory_search').run({ query: 'pdf raporu' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('kaynak: #7');
  });
});
