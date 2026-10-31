import type { BrainMap, MapEdge, MapNode } from '../../server/memory/map.js';

export type LodLevel = 0 | 1 | 2 | 3;

/** Semantic zoom: more detail becomes visible as the scale grows. */
export function levelForZoom(zoom: number): LodLevel {
  if (zoom < 0.45) return 0;
  if (zoom < 0.9) return 1;
  if (zoom < 1.6) return 2;
  return 3;
}

export const LEVEL_LABELS: Record<LodLevel, string> = {
  // i18n-exempt: debug labels for the zoom level, not rendered as UI copy
  0: 'brain map',
  1: 'projects and core concepts',
  2: 'notes',
  3: 'detail',
};

const MAX_EDGES: Record<LodLevel, number> = { 0: 120, 1: 400, 2: 1200, 3: 3000 };

/**
 * Visible node/edge set for the scale. Nodes never disappear — the ones below the
 * threshold simplify; so transitions do not flicker.
 */
export function visibleMap(map: BrainMap, zoom: number): { nodes: MapNode[]; edges: MapEdge[]; level: LodLevel } {
  const level = levelForZoom(zoom);
  const nodes = map.nodes.filter((node) => isVisible(node, level));
  const ids = new Set(nodes.map((n) => n.id));

  const edges = map.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .filter((edge) => edgeVisible(edge, level))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_EDGES[level]);

  return { nodes, edges, level };
}

function isVisible(node: MapNode, level: LodLevel): boolean {
  if (node.kind === 'project') return true;
  if (node.kind === 'concept') {
    // Far away only the strong concepts; close up all of them.
    return level === 0 ? node.weight >= 0.5 : true;
  }
  // A conflicting note is visible from far away too: nothing waiting for a decision is hidden.
  if (node.conflict) return true;
  // Notes: all of them at the closest level, the meaningful ones at the middle level, none far away.
  if (level <= 1) return level === 1 && node.weight >= 0.45;
  return true;
}

function edgeVisible(edge: MapEdge, level: LodLevel): boolean {
  if (edge.kind === 'conflict') return true;
  if (level === 0) return false;
  if (level === 1) return edge.kind === 'project' || edge.weight >= 0.6;
  if (level === 2) return edge.kind !== 'link' || edge.weight >= 0.3;
  return true;
}
