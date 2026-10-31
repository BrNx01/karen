import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore, strength } from '../server/memory/notes.js';
import { LINK_FLOOR } from '../server/memory/links.js';

const DAY = 86_400_000;
const NOW = Date.now();

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const a = memory.add({ kind: 'semantic', text: 'c++ derleyici', evidence: [1], base: 0.6 });
  const b = memory.add({ kind: 'semantic', text: 'ai modeli', evidence: [2], base: 0.6 });
  return { log, memory, a, b };
}

describe('hebbian link', () => {
  it('linking twice increases the weight', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.5);
    const first = memory.linkWeight(a.id, b.id)!.weight;
    memory.link(a.id, b.id);
    const second = memory.linkWeight(a.id, b.id)!.weight;
    expect(second).toBeGreaterThan(first);
  });

  it('strengthens over five repeats and never exceeds 1', () => {
    const { memory, a, b } = setup();
    for (let i = 0; i < 5; i++) memory.link(a.id, b.id);
    const w = memory.linkWeight(a.id, b.id)!.weight;
    expect(w).toBeGreaterThan(0.6);
    expect(w).toBeLessThanOrEqual(1);
  });

  it('the read path fades it over time', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.9);
    const fresh = memory.linkWeight(a.id, b.id, NOW)!.weight;
    const old = memory.linkWeight(a.id, b.id, NOW + 60 * DAY)!.weight;
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThanOrEqual(LINK_FLOOR);
  });

  it('cooling does not go below the floor and the link is not deleted', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.9);
    const w = memory.linkWeight(a.id, b.id, NOW + 10 * 365 * DAY)!.weight;
    expect(w).toBeCloseTo(LINK_FLOOR, 5);
    expect(memory.linksOf(a.id)).toHaveLength(1);
  });

  it('rebuild keeps the weight', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.5);
    memory.link(a.id, b.id);
    const before = memory.linkWeight(a.id, b.id, NOW)!.weight;
    memory.rebuild();
    expect(memory.linkWeight(a.id, b.id, NOW)!.weight).toBeCloseTo(before, 6);
  });

  it('no self-link is created', () => {
    const { memory, a } = setup();
    memory.link(a.id, a.id);
    expect(memory.linksOf(a.id)).toHaveLength(0);
  });
});
