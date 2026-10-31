import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';

const setup = () => {
  const log = new EventLog(':memory:');
  return { log, memory: new MemoryStore(log) };
};

describe('conflict detection', () => {
  it('opposite negation on the same topic is flagged and both notes remain', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8 });
    const b = memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [2], base: 0.8 });

    expect(memory.list()).toHaveLength(2);
    expect(memory.get(a.id)?.conflict).toBe(true);
    expect(memory.get(b.id)?.conflict).toBe(true);

    const pairs = memory.conflicts();
    expect(pairs).toHaveLength(1);
    expect([pairs[0]?.a.id, pairs[0]?.b.id].sort()).toEqual([a.id, b.id].sort());
  });

  it('different topics are not a conflict', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Veritabanı yedeği gece alınmıyor', evidence: [2], base: 0.8 });
    expect(memory.conflicts()).toHaveLength(0);
  });

  it('opposite notes in different projects are not a conflict', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8, project: 'p1' });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [2], base: 0.8, project: 'p2' });
    expect(memory.conflicts()).toHaveLength(0);
  });

  it('resolving a conflict removes only that pair', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'Renk mavi tercih ediliyor', evidence: [1], base: 0.8 });
    const b = memory.add({ kind: 'semantic', text: 'Renk mavi tercih edilmiyor', evidence: [2], base: 0.8 });
    expect(memory.conflicts()).toHaveLength(1);
    memory.resolveConflict(a.id, b.id);
    expect(memory.conflicts()).toHaveLength(0);
  });

  it('Turkish negation suffixes are caught', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı Docker kullanıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı Docker kullanmıyorum diyor', evidence: [2], base: 0.8 });
    expect(memory.conflicts().length).toBeGreaterThan(0);
  });

  it('short and unrelated notes are not a conflict', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Toplantı yarın yapılmıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Toplantı notları hazır', evidence: [2], base: 0.8 });
    expect(memory.conflicts()).toHaveLength(0);
  });

  it('a forgotten note drops out of the conflict list', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [2], base: 0.8 });
    memory.forget(a.id);
    expect(memory.conflicts()).toHaveLength(0);
  });

  it('the conflict survives a rebuild', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [2], base: 0.8 });
    const before = memory.list().map((n) => n.conflict);
    memory.rebuild();
    expect(memory.list().map((n) => n.conflict)).toEqual(before);
  });
});

describe('project-scoped memory', () => {
  it('the project filter returns its own notes and global notes', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'global bilgi bir', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'p1 bilgisi iki', evidence: [1], base: 0.8, project: 'p1' });
    memory.add({ kind: 'semantic', text: 'p2 bilgisi üç', evidence: [1], base: 0.8, project: 'p2' });

    const p1 = memory.list({ project: 'p1' }).map((n) => n.text);
    expect(p1).toContain('global bilgi bir');
    expect(p1).toContain('p1 bilgisi iki');
    expect(p1).not.toContain('p2 bilgisi üç');
  });
});
