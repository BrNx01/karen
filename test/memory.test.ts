import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore, strength, noteId, DORMANT_THRESHOLD } from '../server/memory/notes.js';

const setup = () => {
  const log = new EventLog(':memory:');
  log.append('message', 'user', 's1', { role: 'user' }, 'kullanıcı pdf raporu istiyor');
  return { log, memory: new MemoryStore(log) };
};

const DAY = 86_400_000;

describe('strength', () => {
  it('repetition strengthens and correction is the strongest signal', () => {
    const now = Date.now();
    const base = {
      id: 'x',
      kind: 'semantic' as const,
      text: 't',
      project: null,
      concepts: [],
      evidence: [],
      base: 0.5,
      createdAt: now,
      lastRecalledAt: null,
      recallCount: 0,
      corrected: false,
      forgotten: false,
      dormant: false,
      conflict: false,
      isTrauma: false,
      stability: 2,
      difficulty: 5,
      storage: 1,
      lastReview: null,
      surprise: 0,
    };
    const fresh = strength(base, now);
    const recalled = strength({ ...base, recallCount: 10, storage: 3 }, now);
    const corrected = strength({ ...base, corrected: true }, now);
    expect(recalled).toBeGreaterThan(fresh);
    expect(corrected).toBeGreaterThan(fresh);
    expect(strength({ ...base, createdAt: now - 300 * DAY }, now)).toBeLessThan(DORMANT_THRESHOLD);
  });
});

describe('MemoryStore', () => {
  it('adds and reads a note', () => {
    const { memory, log } = setup();
    const note = memory.add({ kind: 'semantic', text: 'Kullanıcı Türkçe konuşmayı sever', evidence: [1], base: 0.7 });
    expect(memory.get(note.id)?.text).toContain('Türkçe');
    expect(memory.list()).toHaveLength(1);
    expect(log.read().some((e) => e.kind === 'memory_note')).toBe(true);
  });

  it('does not add the same text twice, counts a repeat', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'Aynı bilgi', evidence: [1], base: 0.5 });
    const b = memory.add({ kind: 'semantic', text: 'Aynı bilgi', evidence: [1], base: 0.5 });
    expect(b.id).toBe(a.id);
    expect(memory.list()).toHaveLength(1);
    expect(memory.get(a.id)?.recallCount).toBe(1);
  });

  it('different text stands side by side as a conflict and is not overwritten', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanır', evidence: [1], base: 0.6 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmaz', evidence: [1], base: 0.6 });
    expect(memory.list()).toHaveLength(2);
  });

  it('correction changes the text and weakens the old note', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'semantic', text: 'Renk mavi', evidence: [1], base: 0.8 });
    memory.correct(note.id, 'Renk kırmızı');
    const notes = memory.list();
    expect(notes.map((n) => n.text).sort()).toEqual(['Renk kırmızı', 'Renk mavi']);
    expect(notes.find((n) => n.text === 'Renk mavi')?.base).toBeLessThanOrEqual(0.2);
    expect(notes.find((n) => n.text === 'Renk kırmızı')?.base).toBeGreaterThan(0.5);
  });

  it('a forgotten note appears in neither the list nor recall', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'episodic', text: 'PDF raporu üretildi', evidence: [1], base: 0.9 });
    memory.forget(note.id);
    expect(memory.list()).toEqual([]);
    expect(memory.recall('pdf raporu')).toEqual([]);
    expect(memory.list({ includeForgotten: true })).toHaveLength(1);
  });

  it('the left lobe finds the word match', () => {
    const { memory } = setup();
    memory.add({ kind: 'episodic', text: 'PDF raporu şablonu hazırlandı', evidence: [1], base: 0.7 });
    memory.add({ kind: 'episodic', text: 'Veritabanı yedeği alındı', evidence: [1], base: 0.7 });
    const hits = memory.recall('rapor');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.lobes).toContain('left');
    expect(hits[0]?.text).toContain('PDF');
  });

  it('the right lobe associates through links', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'PDF üretimi için puppeteer kullanılır', evidence: [1], base: 0.7 });
    const b = memory.add({ kind: 'episodic', text: 'Puppeteer sürümü 21e yükseltildi', evidence: [1], base: 0.5 });
    memory.link(a.id, b.id, 0.9);
    const hits = memory.recall('pdf');
    const viaGraph = hits.find((h) => h.id === b.id);
    expect(viaGraph).toBeDefined();
    expect(viaGraph?.lobes).toContain('right');
  });

  it('strength affects ranking', () => {
    const { memory } = setup();
    const weak = memory.add({ kind: 'episodic', text: 'eski rapor notu bir', evidence: [1], base: 0.1 });
    memory.add({ kind: 'episodic', text: 'güçlü rapor notu iki', evidence: [1], base: 0.9 });
    for (let i = 0; i < 8; i++) memory.recordRecall([weak.id]);
    const hits = memory.recall('rapor');
    expect(hits.length).toBe(2);
  });

  it('decay moves sub-threshold notes to cold without deleting them', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'episodic', text: 'solacak not', evidence: [1], base: 0.3 }, Date.now() - 400 * DAY);
    const result = memory.decay();
    expect(result.dormant).toContain(note.id);
    expect(memory.list({ includeDormant: true })).toHaveLength(1);
    expect(memory.list()).toEqual([]);
    expect(memory.recall('solacak')).toEqual([]);
  });

  it('the same text becomes a separate note in another project', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'aynı bilgi', evidence: [1], base: 0.5, project: 'p1' });
    const b = memory.add({ kind: 'semantic', text: 'aynı bilgi', evidence: [1], base: 0.5, project: 'p2' });
    expect(a.id).not.toBe(b.id);
    expect(memory.list()).toHaveLength(2);
    expect(memory.list({ project: 'p1' })).toHaveLength(1);
  });

  it('a cold note does not immediately decay again after restore', () => {
    const { memory } = setup();
    const old = memory.add({ kind: 'episodic', text: 'eski not', evidence: [1], base: 0.2 }, Date.now() - 500 * DAY);
    memory.decay();
    expect(memory.get(old.id)?.dormant).toBe(true);
    memory.restore(old.id);
    expect(memory.get(old.id)?.dormant).toBe(false);
    expect(memory.decay().dormant).not.toContain(old.id);
  });

  it('rebuild leaves the projection unchanged', () => {
    const { memory, log } = setup();
    const note = memory.add({ kind: 'semantic', text: 'kalıcı bilgi', evidence: [1], base: 0.9 });
    memory.recordRecall([note.id]);
    memory.link(note.id, note.id, 1);
    const before = memory.list();
    memory.rebuild();
    expect(memory.list()).toEqual(before);
    expect(log.read().length).toBeGreaterThan(0);
  });
});
