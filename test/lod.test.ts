import { describe, it, expect } from 'vitest';
import { levelForZoom, visibleMap } from '../app/src/lod.js';
import type { BrainMap, MapEdge, MapNode } from '../server/memory/map.js';

const note = (id: string, weight: number, conflict = false): MapNode => ({
  id,
  kind: 'note',
  label: id,
  weight,
  noteId: id,
  conflict,
});

const concept = (id: string, weight: number): MapNode => ({ id: `concept:${id}`, kind: 'concept', label: id, weight });
const project = (id: string): MapNode => ({ id: `project:${id}`, kind: 'project', label: id, weight: 0.6 });

const edge = (source: string, target: string, kind: MapEdge['kind'], weight = 0.5): MapEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  kind,
  weight,
});

function sample(): BrainMap {
  return {
    nodes: [project('app'), concept('puppeteer', 0.9), concept('nadir', 0.2), note('n1', 0.9), note('n2', 0.2)],
    edges: [
      edge('n1', 'concept:puppeteer', 'concept', 0.9),
      edge('n2', 'concept:nadir', 'concept', 0.2),
      edge('n1', 'n2', 'link', 0.2),
      edge('n1', 'n2', 'conflict', 1),
    ],
    stats: { notes: 2, concepts: 2, projects: 1, dormant: 0, conflicts: 1 },
    regions: [],
  };
}

describe('levelForZoom', () => {
  it('maps scale thresholds', () => {
    expect(levelForZoom(0.2)).toBe(0);
    expect(levelForZoom(0.6)).toBe(1);
    expect(levelForZoom(1.2)).toBe(2);
    expect(levelForZoom(2.5)).toBe(3);
  });
});

describe('visibleMap', () => {
  it('far out only the project, strong concepts and conflicting notes', () => {
    const map = sample();
    map.nodes = [...map.nodes, note('c1', 0.3, true)];
    const { nodes, level } = visibleMap(map, 0.2);
    expect(level).toBe(0);
    expect(nodes.map((n) => n.id).sort()).toEqual(['c1', 'concept:puppeteer', 'project:app']);
  });

  it('at mid zoom strong notes show and weak ones hide', () => {
    const { nodes } = visibleMap(sample(), 0.6);
    expect(nodes.some((n) => n.id === 'n1')).toBe(true);
    expect(nodes.some((n) => n.id === 'n2')).toBe(false);
  });

  it('all notes are visible up close', () => {
    const { nodes } = visibleMap(sample(), 1.2);
    expect(nodes.some((n) => n.id === 'n1')).toBe(true);
    expect(nodes.some((n) => n.id === 'n2')).toBe(true);
  });

  it('a conflict edge shows when both ends are visible', () => {
    for (const zoom of [0.2, 0.6, 1.2, 2.5]) {
      const map = sample();
      // at the far level notes are hidden; a conflicting note is visible at every level.
      map.nodes = map.nodes.map((n) => (n.id === 'n1' || n.id === 'n2' ? { ...n, conflict: true } : n));
      const { edges } = visibleMap(map, zoom);
      expect(edges.some((e) => e.kind === 'conflict')).toBe(true);
    }
  });

  it('an edge drops when neither end is visible', () => {
    const { edges } = visibleMap(sample(), 0.6);
    // n2 is hidden, so n1-n2 edges (including the conflict) drop.
    expect(edges.every((e) => e.source !== 'n2' && e.target !== 'n2')).toBe(true);
  });

  it('the transition is monotonic: zooming in never reduces the node count', () => {
    const map = sample();
    const counts = [0.2, 0.6, 1.2, 2.5].map((z) => visibleMap(map, z).nodes.length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });
});
