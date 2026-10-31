import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore, fold } from '../server/memory/notes.js';

describe('Turkish search', () => {
  it('fold reduces Turkish characters', () => {
    expect(fold('Yedeğini ŞİMDİ Çalıştır')).toBe('yedegini simdi calistir');
  });

  it('finds the stem despite different suffixes', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    memory.add({ kind: 'episodic', text: 'veritabanı yedeğini her gece al', evidence: [1], base: 0.9 });
    expect(memory.recall('yedek')).toHaveLength(1);
    expect(memory.recall('YEDEK')).toHaveLength(1);
    expect(memory.recall('veritabanı yedeği')).toHaveLength(1);
  });

  it('raporu matches rapor', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    memory.add({ kind: 'episodic', text: 'PDF raporu üretildi', evidence: [1], base: 0.9 });
    expect(memory.recall('rapor')).toHaveLength(1);
    expect(memory.recall('raporlar')).toHaveLength(1);
  });
});
