import type { MapEdge, MapNode } from '../../server/memory/map.js';

export type Point = { x: number; y: number };

/** React Flow viewport transform: screen = {x,y} + point * zoom. */
export type Viewport = { x: number; y: number; zoom: number };

/**
 * Viewport fitting every position into the pane. Returns null when the pane is
 * unknown. Framed from our own coordinates, not React Flow measurement: it is a
 * pure calculation, so no layout measurement has to arrive first.
 */
export function fitViewport(
  points: Point[],
  pane: { width: number; height: number },
  opts: { padding?: number; nodeWidth?: number; nodeHeight?: number; maxZoom?: number } = {},
): Viewport | null {
  const { width, height } = pane;
  if (
    points.length === 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const padding = opts.padding ?? 40;
  const halfW = (opts.nodeWidth ?? 160) / 2;
  const halfH = (opts.nodeHeight ?? 44) / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x - halfW);
    maxX = Math.max(maxX, point.x + halfW);
    minY = Math.min(minY, point.y - halfH);
    maxY = Math.max(maxY, point.y + halfH);
  }
  if (minX === Infinity) return null;

  const boundsW = Math.max(1, maxX - minX);
  const boundsH = Math.max(1, maxY - minY);
  const availableW = Math.max(1, width - padding * 2);
  const availableH = Math.max(1, height - padding * 2);
  const maxZoom = opts.maxZoom ?? 1.1;
  // Same floor as minZoom: the viewport must never produce a zoom React Flow would clip.
  const zoom = Math.max(0.2, Math.min(maxZoom, availableW / boundsW, availableH / boundsH));

  // The center of the bounds must land at the center of the pane.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: width / 2 - cx * zoom, y: height / 2 - cy * zoom, zoom };
}

/** Semantic zoom tier: continent → city → street. */
export type MapTier = 'kita' | 'sehir' | 'sokak';

/** Tier thresholds: below 0.55 continent, below 1.15 city, above street. */
export function tierForZoom(zoom: number): MapTier {
  const z = Number.isFinite(zoom) ? Math.max(0, zoom) : 0;
  if (z < 0.55) return 'kita';
  if (z < 1.15) return 'sehir';
  return 'sokak';
}

/** Node kinds visible at a tier. */
export function visibleKinds(tier: MapTier): MapNode['kind'][] {
  if (tier === 'kita') return ['project'];
  if (tier === 'sehir') return ['project', 'concept'];
  return ['project', 'concept', 'note'];
}

/**
 * Stable layout: positions are computed once over all nodes so zoom never moves
 * a node. They are bound to node identity: when the LOD level changes only
 * visibility changes, nodes do not move, so zoom transitions do not flicker.
 */
export function computeLayout(nodes: MapNode[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const hubs = nodes.filter((n) => n.kind !== 'note');
  const notes = nodes.filter((n) => n.kind === 'note');

  hubs.forEach((node, index) => {
    const angle = (index / Math.max(1, hubs.length)) * Math.PI * 2;
    positions.set(node.id, { x: Math.cos(angle) * 300, y: Math.sin(angle) * 300 });
  });

  // Nodes per ring follow a constant arc length; the radius grows with the note count.
  const perRing = 12;
  notes.forEach((node, index) => {
    const ring = Math.floor(index / perRing);
    const inRing = Math.min(perRing, notes.length - ring * perRing);
    const slot = index - ring * perRing;
    const angle = (slot / Math.max(1, inRing)) * Math.PI * 2 + ring * 0.35;
    const radius = 620 + ring * 260;
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });

  return positions;
}

/**
 * Force-directed layout: concept/project nodes are pulled to the center, linked
 * notes move toward their concepts, and all nodes repel each other. The result
 * is computed once (deterministically) and cached; it does not rerun every frame.
 */
export function computeForceLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  opts: { iterations?: number; width?: number; height?: number } = {},
): Map<string, Point> {
  const iterations = opts.iterations ?? 220;
  // The box grows with the node count: in a fixed 1400×900, 800 notes would stack on one point.
  const width = opts.width ?? Math.max(1400, 90 * Math.sqrt(nodes.length));
  const height = opts.height ?? Math.max(900, 60 * Math.sqrt(nodes.length));
  const positions = new Map<string, Point>();

  // Start: concepts on a center ring, notes spread outward (deterministic).
  const hubs = nodes.filter((n) => n.kind !== 'note');
  const notes = nodes.filter((n) => n.kind === 'note');
  hubs.forEach((node, index) => {
    const angle = (index / Math.max(1, hubs.length)) * Math.PI * 2;
    positions.set(node.id, { x: Math.cos(angle) * 240, y: Math.sin(angle) * 240 });
  });
  notes.forEach((node, index) => {
    // Golden angle: nodes must not start on top of each other.
    const angle = index * 2.399963;
    const radius = 420 + (index % 7) * 60;
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });

  const index = new Map(nodes.map((node) => [node.id, node]));
  const links = edges
    .filter((edge) => index.has(edge.source) && index.has(edge.target))
    .map((edge) => ({ a: edge.source, b: edge.target, weight: edge.weight }));

  // Concept/project nodes are pulled to the center harder.
  const centerPull = (node: MapNode): number => (node.kind === 'note' ? 0.004 : 0.02);

  // The equilibrium distance must grow with the node count; fixed repulsion piles
  // everything into one blob in a crowd (26 px spacing measured at 840 notes, box 150+ px).
  const spread = Math.max(1, Math.sqrt(nodes.length / 60));
  const targetDistance = 180 * spread;
  const repulsion = 2200 * spread * spread;

  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / iterations;

    // Repulsion: every node pair (O(n²); n is small per region, acceptable at 500 notes).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i] as MapNode;
        const b = nodes[j] as MapNode;
        const pa = positions.get(a.id) as Point;
        const pb = positions.get(b.id) as Point;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) {
          // Exact overlap: deterministic small offset.
          dx = (i + 1) * 0.1 - (j + 1) * 0.07;
          dy = (j + 1) * 0.1 - (i + 1) * 0.07;
          dist2 = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(dist2);
        const repulse = (repulsion / dist2) * cooling;
        const ux = (dx / dist) * repulse;
        const uy = (dy / dist) * repulse;
        pa.x += ux;
        pa.y += uy;
        pb.x -= ux;
        pb.y -= uy;
      }
    }

    // Attraction: linked nodes come closer.
    for (const link of links) {
      const pa = positions.get(link.a) as Point;
      const pb = positions.get(link.b) as Point;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const target = targetDistance;
      const pull = ((dist - target) / dist) * (0.01 + link.weight * 0.02) * cooling;
      pa.x += dx * pull;
      pa.y += dy * pull;
      pb.x -= dx * pull;
      pb.y -= dy * pull;
    }

    // Center pull + clamping.
    for (const node of nodes) {
      const point = positions.get(node.id) as Point;
      point.x -= point.x * centerPull(node);
      point.y -= point.y * centerPull(node);
      point.x = Math.max(-width / 2, Math.min(width / 2, point.x));
      point.y = Math.max(-height / 2, Math.min(height / 2, point.y));
    }
  }

  return positions;
}

/**
 * Caps the note count at the street tier: the strongest `limit` notes stay, concepts
 * and projects are never trimmed. Input order is preserved, so layout stays bound
 * to identity.
 */
export function capNotes(nodes: MapNode[], limit: number): MapNode[] {
  const notes = nodes.filter((node) => node.kind === 'note');
  if (notes.length <= limit) return nodes;
  const keep = new Set(
    [...notes]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, Math.max(0, limit))
      .map((node) => node.id),
  );
  return nodes.filter((node) => node.kind !== 'note' || keep.has(node.id));
}

/** Are two node positions too close together (overlap check). */
export function tooClose(a: Point, b: Point, minDistance = 120): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < minDistance;
}
