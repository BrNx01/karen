import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { buildMap } from '../server/memory/map.js';

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  return { log, memory };
}

describe('buildMap', () => {
  it('regions: produces project, layer and concept boxes', () => {
    const { memory } = setup();
    memory.add({
      kind: 'semantic',
      text: 'PDF raporu puppeteer ile üretilir',
      concepts: ['puppeteer'],
      evidence: [1],
      base: 0.9,
      project: 'c:/work/app',
    });
    memory.add({ kind: 'episodic', text: 'rapor üretildi bugün', concepts: ['puppeteer'], evidence: [2], base: 0.6 });

    const map = buildMap(memory);
    const kinds = map.regions.map((r) => r.kind);
    expect(kinds).toContain('project');
    expect(kinds).toContain('layer');
    expect(kinds).toContain('concept');

    const projectRegion = map.regions.find((r) => r.kind === 'project');
    expect(projectRegion?.label).toBe('app');
    expect(projectRegion?.count).toBe(1);
    expect(projectRegion?.nodeIds).toHaveLength(1);

    const layerRegion = map.regions.find((r) => r.kind === 'layer' && r.label === 'Anılar');
    expect(layerRegion?.count).toBe(1);
  });

  it('region boxes are normalised and placed without overlap', () => {
    const { memory } = setup();
    for (let i = 0; i < 12; i++) {
      memory.add({
        kind: i % 2 === 0 ? 'semantic' : 'episodic',
        text: `not numara ${i} detay`,
        concepts: [`k${i % 4}`],
        evidence: [1],
        base: 0.5,
        project: `c:/proj/p${i % 3}`,
      });
    }
    const map = buildMap(memory);
    expect(map.regions.length).toBeGreaterThan(3);
    expect(map.regions.length).toBeLessThanOrEqual(20);
    for (const region of map.regions) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.w).toBeLessThanOrEqual(1.0001);
      expect(region.y + region.h).toBeLessThanOrEqual(1.0001);
    }
    const corners = new Set(map.regions.map((r) => `${r.x.toFixed(3)}:${r.y.toFixed(3)}`));
    expect(corners.size).toBe(map.regions.length);
  });

  it('no notes, no regions', () => {
    const { memory } = setup();
    expect(buildMap(memory).regions).toEqual([]);
  });

  it('links note, concept and project nodes', () => {
    const { memory } = setup();
    memory.add({
      kind: 'semantic',
      text: 'PDF raporu puppeteer ile üretilir',
      concepts: ['puppeteer', 'pdf'],
      evidence: [1],
      base: 0.9,
      project: 'c:/work/app',
    });
    const map = buildMap(memory);

    expect(map.nodes.filter((n) => n.kind === 'note')).toHaveLength(1);
    expect(map.nodes.filter((n) => n.kind === 'concept').map((n) => n.label).sort()).toEqual(['pdf', 'puppeteer']);
    expect(map.nodes.filter((n) => n.kind === 'project').map((n) => n.label)).toEqual(['app']);
    expect(map.edges.filter((e) => e.kind === 'concept')).toHaveLength(2);
    expect(map.edges.filter((e) => e.kind === 'project')).toHaveLength(1);
  });

  it('produces a note-to-note link only once', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'puppeteer kuruldu bugün', concepts: ['puppeteer'], evidence: [1], base: 0.8 });
    const b = memory.add({ kind: 'episodic', text: 'puppeteer sürümü yükseltildi', concepts: ['puppeteer'], evidence: [2], base: 0.6 });
    memory.link(a.id, b.id, 0.9);
    const map = buildMap(memory);
    expect(map.edges.filter((e) => e.kind === 'link')).toHaveLength(1);
  });

  it('the conflict edge shows on the map', () => {
    const { memory } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [2], base: 0.8 });
    const map = buildMap(memory);
    expect(map.stats.conflicts).toBe(1);
    expect(map.edges.filter((e) => e.kind === 'conflict')).toHaveLength(1);
  });

  it('a forgotten note is not on the map', () => {
    const { memory } = setup();
    const note = memory.add({ kind: 'semantic', text: 'unutulacak bilgi', evidence: [1], base: 0.8 });
    memory.forget(note.id);
    expect(buildMap(memory).nodes.filter((n) => n.kind === 'note')).toHaveLength(0);
  });

  it('a cold note stays faded on the map', () => {
    const { memory } = setup();
    memory.add({ kind: 'episodic', text: 'eski not burada', evidence: [1], base: 0.2 }, Date.now() - 500 * 86_400_000);
    memory.decay();
    const map = buildMap(memory);
    const notes = map.nodes.filter((n) => n.kind === 'note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.dormant).toBe(true);
    expect(map.stats.dormant).toBe(1);
  });

  it('caps the note count and keeps the strongest', () => {
    const { memory } = setup();
    for (let i = 0; i < 30; i++) {
      memory.add({ kind: 'semantic', text: `not numara ${i}`, evidence: [1], base: i / 30 });
    }
    const map = buildMap(memory, { maxNotes: 10 });
    expect(map.nodes.filter((n) => n.kind === 'note')).toHaveLength(10);
    // the strongest note (29) must be inside.
    expect(map.nodes.some((n) => n.label.includes('29'))).toBe(true);
  });

  it('a trauma note is flagged on its node', () => {
    const { memory, log } = setup();
    const note = memory.add({ kind: 'semantic', text: 'kalıcı ders', evidence: [1], base: 0.5 });
    memory.markTrauma(note.id, 'kullanici');
    const map = buildMap(memory);
    const node = map.nodes.find((n) => n.id === note.id);
    expect(node?.trauma).toBe(true);
  });

  it('weight grows with the strength score', () => {
    const { memory } = setup();
    const weak = memory.add({ kind: 'semantic', text: 'zayıf not burada', evidence: [1], base: 0.2 });
    const strong = memory.add({ kind: 'semantic', text: 'güçlü not burada', evidence: [1], base: 1 });
    const map = buildMap(memory);
    const nodeOf = (id: string) => map.nodes.find((n) => n.noteId === id);
    expect(nodeOf(strong.id)!.weight).toBeGreaterThan(nodeOf(weak.id)!.weight);
  });
});
