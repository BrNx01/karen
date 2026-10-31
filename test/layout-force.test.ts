import { describe, it, expect } from 'vitest';
import { capNotes, computeForceLayout, tooClose } from '../app/src/layout.js';
import type { MapEdge, MapNode } from '../server/memory/map.js';

const note = (id: string): MapNode => ({ id, kind: 'note', label: id, weight: 0.5, noteId: id });
const concept = (id: string): MapNode => ({ id: `concept:${id}`, kind: 'concept', label: id, weight: 0.7 });
const edge = (a: string, b: string, weight = 0.7): MapEdge => ({ id: `${a}-${b}`, source: a, target: b, kind: 'concept', weight });

describe('computeForceLayout', () => {
  it('assigns a position to every node', () => {
    const nodes = [concept('pdf'), note('n1'), note('n2')];
    const layout = computeForceLayout(nodes, [edge('n1', 'concept:pdf')]);
    expect(layout.size).toBe(3);
  });

  it('deterministic: same input, same output', () => {
    const nodes = [concept('pdf'), note('n1'), note('n2'), note('n3')];
    const edges = [edge('n1', 'concept:pdf'), edge('n2', 'concept:pdf')];
    const a = computeForceLayout(nodes, edges, { iterations: 60 });
    const b = computeForceLayout(nodes, edges, { iterations: 60 });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('a linked note moves toward its concept', () => {
    const nodes = [concept('pdf'), note('near'), note('far')];
    const edges = [edge('near', 'concept:pdf', 0.9)];
    const layout = computeForceLayout(nodes, edges, { iterations: 200 });
    const c = layout.get('concept:pdf')!;
    const near = layout.get('near')!;
    const far = layout.get('far')!;
    const dNear = Math.hypot(near.x - c.x, near.y - c.y);
    const dFar = Math.hypot(far.x - c.x, far.y - c.y);
    expect(dNear).toBeLessThan(dFar);
  });

  it('nodes do not fully overlap', () => {
    const nodes = [concept('a'), note('n1'), note('n2'), note('n3')];
    const layout = computeForceLayout(nodes, []);
    const points = [...layout.values()];
    let overlapping = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (tooClose(points[i]!, points[j]!, 1)) overlapping++;
      }
    }
    expect(overlapping).toBe(0);
  });

  it('stays within bounds', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => note(`n${i}`));
    const layout = computeForceLayout(nodes, [], { width: 800, height: 600 });
    for (const point of layout.values()) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(400.1);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(300.1);
    }
  });

  it('finishes in reasonable time with 50 nodes', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => note(`n${i}`));
    const edges = nodes.slice(1).map((node, i) => edge(node.id, nodes[i]!.id));
    const started = Date.now();
    computeForceLayout(nodes, edges, { iterations: 100 });
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('fast and sparse enough at 840 nodes in 60 iterations', () => {
    const nodes: MapNode[] = [];
    for (let i = 0; i < 40; i++) nodes.push(concept(`k${i}`));
    for (let i = 0; i < 800; i++) nodes.push(note(`n${i}`));
    const edges = Array.from({ length: 800 }, (_, i) => edge(`n${i}`, `concept:k${i % 40}`));

    const started = Date.now();
    const layout = computeForceLayout(nodes, edges, { iterations: 60 });
    const elapsed = Date.now() - started;

    const points = [...layout.values()];
    let nearestSum = 0;
    let nearestMin = Infinity;
    let closePairs = 0;
    for (let i = 0; i < points.length; i++) {
      let nearest = Infinity;
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const distance = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        nearest = Math.min(nearest, distance);
        if (j > i && distance < 20) closePairs++;
      }
      nearestSum += nearest;
      nearestMin = Math.min(nearestMin, nearest);
    }
    const averageNearest = nearestSum / points.length;
    const totalPairs = (points.length * (points.length - 1)) / 2;
    // Wall-clock budgets flake on a busy machine; this one is loose enough to be stable
    // (measured ~420-870 ms) and still catches an order-of-magnitude regression.
    expect(elapsed).toBeLessThan(3000);
    // measured: mean nearest 63.5 px, smallest 37.8 px, under 20 px 1629/352k
    // pairs (0.46%), 60 iterations ≈ 420 ms. The thresholds leave a safety margin below the measurement.
    expect(averageNearest).toBeGreaterThan(60);
    expect(nearestMin).toBeGreaterThan(0);
    expect(closePairs / totalPairs).toBeLessThan(0.03);
  });
});

describe('capNotes', () => {
  it('keeps the strongest notes and does not clip the concept', () => {
    const nodes: MapNode[] = [concept('k')];
    for (let i = 0; i < 500; i++) nodes.push({ ...note(`n${i}`), weight: i / 1000 });
    const capped = capNotes(nodes, 400);
    const notes = capped.filter((node) => node.kind === 'note');
    expect(notes).toHaveLength(400);
    expect(notes.some((node) => node.id === 'n0')).toBe(false);
    expect(notes.some((node) => node.id === 'n499')).toBe(true);
    expect(capped.some((node) => node.kind === 'concept')).toBe(true);
    // input below the limit is returned unchanged.
    expect(capNotes(nodes.slice(0, 3), 400)).toEqual(nodes.slice(0, 3));
  });
});
