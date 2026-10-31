import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore, strength, TRAUMA_STRENGTH_FLOOR } from '../server/memory/notes.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

describe('travma', () => {
  it('is marked and persists', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'şu kütüphane çökertiyor', evidence: [1], base: 0.6 });
    expect(memory.get(note.id)!.isTrauma).toBe(false);
    expect(memory.markTrauma(note.id, 'tekrarlanan hata')).toBe(true);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
    expect(memory.markTrauma(note.id, 'tekrar')).toBe(false);
    expect(memory.traumaNotes().map((n) => n.id)).toContain(note.id);
  });

  it('rebuild keeps the trauma mark', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'asla unutma', evidence: [1], base: 0.6 });
    memory.markTrauma(note.id, 'kullanici');
    memory.rebuild();
    expect(memory.get(note.id)!.isTrauma).toBe(true);
  });

  it('a trauma note does not go cold even after 10 years', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'kalıcı ders', evidence: [1], base: 0.4 });
    memory.markTrauma(note.id, 'kullanici');
    const result = memory.decay(NOW + 10 * 365 * DAY);
    expect(result.dormant).not.toContain(note.id);
    expect(memory.get(note.id)!.dormant).toBe(false);
  });

  it('trauma strength does not fall below the threshold', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'sert ders', evidence: [1], base: 0.2 });
    memory.markTrauma(note.id, 'kullanici');
    const kept = memory.get(note.id)!;
    expect(kept.storage).toBeGreaterThanOrEqual(10);
    expect(strength(kept, NOW + 10 * 365 * DAY)).toBeGreaterThan(0.3);
  });

  it('the strength of a trauma note stays above the explicit floor', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'taban dersi', evidence: [1], base: 0.2 });
    memory.markTrauma(note.id, 'kullanici');
    // even with Storage 10, R -> 0; the floor must be independent of the FSRS constants.
    expect(strength(memory.get(note.id)!, NOW + 30 * 365 * DAY)).toBe(TRAUMA_STRENGTH_FLOOR);
  });

  it('cooling skips a trauma note', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const trauma = memory.add({ kind: 'semantic', text: 'atlanacak travma', evidence: [1], base: 0.2 });
    const plain = memory.add({ kind: 'semantic', text: 'kontrol notu', evidence: [2], base: 0.2 });
    memory.markTrauma(trauma.id, 'kullanici');
    // writing trauma pulls storage to 10; we lower storage to 1 through the event log
    // so the `storage < 3` precondition holds and the test really exercises the `decay()` skip.
    for (const id of [trauma.id, plain.id]) {
      log.append('memory_score', 'brain', 'brain', {
        noteId: id,
        op: 'review',
        stability: 1,
        difficulty: 5,
        storage: 1,
        lastReview: NOW,
      });
    }
    memory.rebuild();

    const result = memory.decay(NOW + 10 * 365 * DAY);
    // the control note goes cold: the scenario is really below the threshold.
    expect(result.dormant).toContain(plain.id);
    expect(result.dormant).not.toContain(trauma.id);
    expect(memory.get(trauma.id)!.dormant).toBe(false);
    const dormantEvents = log
      .read()
      .filter(
        (e) =>
          e.kind === 'memory_score' &&
          e.payload['op'] === 'dormant' &&
          e.payload['noteId'] === trauma.id,
      );
    expect(dormantEvents).toHaveLength(0);
  });
});
