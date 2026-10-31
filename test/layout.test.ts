import { describe, it, expect } from 'vitest';
import { computeLayout, tooClose } from '../app/src/layout.js';
import type { MapNode } from '../server/memory/map.js';

const note = (id: string): MapNode => ({ id, kind: 'note', label: id, weight: 0.5, noteId: id });
const concept = (id: string): MapNode => ({ id: `concept:${id}`, kind: 'concept', label: id, weight: 0.7 });
const project = (id: string): MapNode => ({ id: `project:${id}`, kind: 'project', label: id, weight: 0.6 });

describe('computeLayout', () => {
  it('assigns a position to every node', () => {
    const nodes = [project('app'), concept('pdf'), note('n1'), note('n2')];
    const layout = computeLayout(nodes);
    expect(layout.size).toBe(4);
    for (const node of nodes) expect(layout.get(node.id)).toBeDefined();
  });

  it('stable: the same node always lands in the same place', () => {
    const nodes = [project('app'), concept('pdf'), note('n1'), note('n2'), note('n3')];
    const first = computeLayout(nodes);
    const second = computeLayout(nodes);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it('existing nodes stay put when a node is added (no jitter on transition)', () => {
    const base = [project('app'), concept('pdf'), note('n1'), note('n2')];
    const before = computeLayout(base);
    const after = computeLayout([...base, concept('yedek')]);
    // project and note positions are kept; only the new concept is added.
    expect(after.get('project:app')).toEqual(before.get('project:app'));
    expect(after.get('n1')).toEqual(before.get('n1'));
    expect(after.get('n2')).toEqual(before.get('n2'));
  });

  it('rings grow with many notes and nodes do not pile up', () => {
    const notes = Array.from({ length: 200 }, (_, i) => note(`n${i}`));
    const layout = computeLayout(notes);
    const points = [...layout.values()];
    const radii = new Set(points.map((p) => Math.round(Math.hypot(p.x, p.y) / 100)));
    expect(radii.size).toBeGreaterThan(5); // birden fazla halka
    const far = Math.max(...points.map((p) => Math.hypot(p.x, p.y)));
    expect(far).toBeGreaterThan(1500);
  });

  it('neighbours on the same ring are not too close', () => {
    const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`));
    const layout = computeLayout(notes);
    const points = [...layout.values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(tooClose(points[i]!, points[j]!, 100)).toBe(false);
      }
    }
  });
});
