import { describe, it, expect } from 'vitest';
import { tierForZoom, visibleKinds, fitViewport } from '../app/src/layout.js';
import { computeForceLayout } from '../app/src/layout.js';
import type { MapEdge, MapNode } from '../server/memory/map.js';

const note = (id: string, trauma = false): MapNode => ({ id, kind: 'note', label: id, weight: 0.5, noteId: id, trauma });
const concept = (id: string): MapNode => ({ id: `concept:${id}`, kind: 'concept', label: id, weight: 0.7 });
const project = (id: string): MapNode => ({ id: `project:${id}`, kind: 'project', label: id, weight: 0.8 });

describe('tierForZoom', () => {
  it('picks tiers by their thresholds', () => {
    expect(tierForZoom(0.2)).toBe('kita');
    expect(tierForZoom(0.549)).toBe('kita');
    expect(tierForZoom(0.55)).toBe('sehir');
    expect(tierForZoom(1.149)).toBe('sehir');
    expect(tierForZoom(1.15)).toBe('sokak');
    expect(tierForZoom(2.4)).toBe('sokak');
  });

  it('an invalid zoom counts as continent', () => {
    expect(tierForZoom(Number.NaN)).toBe('kita');
    expect(tierForZoom(-1)).toBe('kita');
  });
});

describe('visibleKinds', () => {
  it('continent shows only the project', () => {
    expect(visibleKinds('kita')).toEqual(['project']);
  });
  it('city shows project + concepts', () => {
    expect(visibleKinds('sehir')).toEqual(['project', 'concept']);
  });
  it('sokakta hepsi', () => {
    expect(visibleKinds('sokak')).toEqual(['project', 'concept', 'note']);
  });
});

describe('fitViewport', () => {
  const pane = { width: 1000, height: 600 };
  const square = [
    { x: -300, y: -300 },
    { x: 300, y: -300 },
    { x: 300, y: 300 },
    { x: -300, y: 300 },
  ];

  it('null for an empty point or an invalid box', () => {
    expect(fitViewport([], pane)).toBeNull();
    expect(fitViewport(square, { width: 0, height: 600 })).toBeNull();
    expect(fitViewport(square, { width: 1000, height: 0 })).toBeNull();
    expect(fitViewport(square, { width: Number.NaN, height: 600 })).toBeNull();
  });

  it('zoom does not exceed the cap and the centre falls inside the box', () => {
    const viewport = fitViewport(square, pane)!;
    expect(viewport.zoom).toBeLessThanOrEqual(1.1);
    const cx = viewport.x + 0 * viewport.zoom;
    const cy = viewport.y + 0 * viewport.zoom;
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(pane.width);
    expect(cy).toBeGreaterThan(0);
    expect(cy).toBeLessThan(pane.height);
  });

  it('all endpoints stay inside the box after the view', () => {
    const viewport = fitViewport(square, pane)!;
    for (const point of square) {
      const x = viewport.x + point.x * viewport.zoom;
      const y = viewport.y + point.y * viewport.zoom;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(pane.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(pane.height);
    }
  });

  it('deterministik', () => {
    expect(fitViewport(square, pane)).toEqual(fitViewport(square, pane));
  });
});

describe('layout stability', () => {
  it('layout over the whole set is deterministic', () => {
    const nodes = [project('p'), concept('a'), note('n1'), note('n2')];
    const edges: MapEdge[] = [{ id: 'e1', source: 'n1', target: 'concept:a', kind: 'concept', weight: 0.7 }];
    const a = computeForceLayout(nodes, edges, { iterations: 50 });
    const b = computeForceLayout(nodes, edges, { iterations: 50 });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('layout computed on a subset differs (hence the whole set is used)', () => {
    const nodes = [project('p'), concept('a'), note('n1'), note('n2')];
    const edges: MapEdge[] = [{ id: 'e1', source: 'n1', target: 'concept:a', kind: 'concept', weight: 0.7 }];
    const all = computeForceLayout(nodes, edges, { iterations: 50 });
    const subset = computeForceLayout([concept('a'), note('n1')], [], { iterations: 50 });
    expect(subset.get('n1')).not.toEqual(all.get('n1'));
  });
});
