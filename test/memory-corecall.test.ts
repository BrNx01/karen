import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { LINK_STRONG } from '../server/memory/links.js';
import { linkNotes } from '../server/memory/distill.js';

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const notes = ['c++ derleyici', 'ai modeli', 'donanım hızlandırma', 'pdf üretimi', 'ses tanıma'].map((text, i) =>
    memory.add({ kind: 'semantic', text, evidence: [i + 1], base: 0.5 }),
  );
  return { log, memory, notes };
}

describe('coRecall', () => {
  it('links notes recalled in the same turn', () => {
    const { memory, notes } = setup();
    const count = memory.coRecall([notes[0]!.id, notes[1]!.id]);
    expect(count).toBe(1);
    expect(memory.linksOf(notes[0]!.id).map((l) => l.id)).toContain(notes[1]!.id);
  });

  it('caps the number of pairs (at most 3)', () => {
    const { memory, notes } = setup();
    const ids = notes.map((n) => n.id);
    const count = memory.coRecall(ids);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('repeated co-recall strengthens the link', () => {
    const { memory, notes } = setup();
    memory.coRecall([notes[0]!.id, notes[1]!.id]);
    const first = memory.linkWeight(notes[0]!.id, notes[1]!.id)!.weight;
    memory.coRecall([notes[0]!.id, notes[1]!.id]);
    const second = memory.linkWeight(notes[0]!.id, notes[1]!.id)!.weight;
    expect(second).toBeGreaterThan(first);
  });

  it('a single note does nothing', () => {
    const { memory, notes } = setup();
    expect(memory.coRecall([notes[0]!.id])).toBe(0);
    expect(memory.linksOf(notes[0]!.id)).toHaveLength(0);
  });

  it('an unknown id is ignored', () => {
    const { memory, notes } = setup();
    expect(memory.coRecall([notes[0]!.id, 'yok'])).toBe(0);
  });
});

describe('strong link preload', () => {
  it('a strongly linked note is recalled even without a word match', () => {
    const { memory, notes } = setup();
    // push the link above the threshold.
    for (let i = 0; i < 20; i++) memory.link(notes[0]!.id, notes[1]!.id);
    expect(memory.linkWeight(notes[0]!.id, notes[1]!.id)!.weight).toBeGreaterThanOrEqual(LINK_STRONG);

    const hits = memory.recall('c++ derleyici', { limit: 5, hops: 1 });
    expect(hits.map((h) => h.id)).toContain(notes[1]!.id);
  });

  it('a weak link does not preload', () => {
    const { memory, notes } = setup();
    // the link attaches to the QUERIED note: otherwise the test would pass even if isStrong were always true.
    memory.link(notes[3]!.id, notes[4]!.id, 0.1);
    // hops: 0 — spreading off, only the preload path remains.
    const hits = memory.recall('pdf üretimi', { limit: 5, hops: 0 });
    expect(hits.map((h) => h.id)).not.toContain(notes[4]!.id);
  });

  it('concept overlap alone does not preload', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const a = memory.add({ kind: 'semantic', text: 'birinci not', concepts: ['x', 'y', 'z', 'w'], evidence: [1], base: 0.5 });
    const b = memory.add({ kind: 'semantic', text: 'ikinci not', concepts: ['x', 'y', 'z', 'w'], evidence: [2], base: 0.5 });
    linkNotes(memory);
    expect(memory.linkWeight(a.id, b.id)!.weight).toBeLessThan(LINK_STRONG);
    // hops: 0 — the right candidate can only come from the preload path.
    const hits = memory.recall('birinci', { limit: 5, hops: 0 });
    expect(hits.map((h) => h.id)).toContain(a.id);
    expect(hits.map((h) => h.id)).not.toContain(b.id);
  });

  it('a preloaded neighbour cannot outrank the note the query matched', () => {
    const { memory, notes } = setup();
    for (let i = 0; i < 20; i++) memory.link(notes[0]!.id, notes[1]!.id);
    // the neighbour is slightly stronger; without the penalty it would beat the match in the left lobe.
    for (let i = 0; i < 4; i++) memory.review(notes[1]!.id);
    const hits = memory.recall('c++ derleyici', { limit: 5, hops: 0 });
    expect(hits.map((h) => h.id)).toContain(notes[1]!.id);
    expect(hits[0]!.id).toBe(notes[0]!.id);
  });

  it('a strong link preloads even with spreading off', () => {
    const { memory, notes } = setup();
    for (let i = 0; i < 20; i++) memory.link(notes[0]!.id, notes[1]!.id);
    const hits = memory.recall('c++ derleyici', { limit: 5, hops: 0 });
    expect(hits.map((h) => h.id)).toContain(notes[1]!.id);
  });

  it('a forgotten neighbour is not preloaded', () => {
    const { memory, notes } = setup();
    for (let i = 0; i < 20; i++) memory.link(notes[0]!.id, notes[1]!.id, undefined, 0);
    memory.forget(notes[1]!.id);
    const hits = memory.recall('c++ derleyici', { limit: 5, hops: 1 });
    expect(hits.map((h) => h.id)).not.toContain(notes[1]!.id);
  });

  it('a sleeping strong neighbour is not preloaded', () => {
    const { memory, notes } = setup();
    for (let i = 0; i < 20; i++) memory.link(notes[0]!.id, notes[1]!.id);
    // make the seed note persistent (storage >= 3) and let the neighbour sink to cold storage.
    memory.review(notes[0]!.id);
    memory.review(notes[0]!.id);
    memory.review(notes[0]!.id);
    memory.decay(Date.now() + 365 * 86_400_000);
    expect(memory.get(notes[1]!.id)!.dormant).toBe(true);

    const hits = memory.recall('c++ derleyici', { limit: 5, hops: 1 });
    expect(hits.map((h) => h.id)).toContain(notes[0]!.id);
    expect(hits.map((h) => h.id)).not.toContain(notes[1]!.id);
  });
});
