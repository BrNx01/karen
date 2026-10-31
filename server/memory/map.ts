import type { MemoryStore, Note } from './notes.js';
import { strength } from './notes.js';

export type MapNodeKind = 'project' | 'concept' | 'note';

export type MapNode = {
  id: string;
  kind: MapNodeKind;
  label: string;
  /** 0..1 — node size and importance ranking. */
  weight: number;
  noteId?: string;
  detail?: string;
  concepts?: string[];
  evidence?: number[];
  dormant?: boolean;
  forgotten?: boolean;
  conflict?: boolean;
  recallCount?: number;
  /** Trauma note: marked on the map with a red ring. */
  trauma?: boolean;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'link' | 'concept' | 'project' | 'conflict';
  weight: number;
};

export type MapRegion = {
  id: string;
  kind: 'project' | 'layer' | 'concept';
  label: string;
  count: number;
  weight: number;
  nodeIds: string[];
  /** 0..1 normalized top-left corner and size of the box (the UI lays it out). */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BrainMap = {
  nodes: MapNode[];
  edges: MapEdge[];
  regions: MapRegion[];
  stats: {
    notes: number;
    concepts: number;
    projects: number;
    dormant: number;
    conflicts: number;
    /** Number of notes left off the map because of the strength order. */
    truncated?: number;
  };
};

const MAX_CONCEPTS = 40;
const MAX_NOTES = 800;

/**
 * Brain map: links notes into project and concept nodes.
 * Weights come from the strength score; the UI uses them for semantic zoom.
 */
export function buildMap(
  memory: MemoryStore,
  opts: { maxNotes?: number; maxConcepts?: number } = {},
): BrainMap {
  const maxNotes = opts.maxNotes ?? MAX_NOTES;
  const maxConcepts = opts.maxConcepts ?? MAX_CONCEPTS;

  const all = memory.list({ includeDormant: true });
  const ranked = all
    .map((n) => ({ note: n, value: strength(n) }))
    .sort((a, b) => b.value - a.value);
  const visible = ranked.slice(0, maxNotes);
  const truncated = Math.max(0, ranked.length - visible.length);

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const noteIds = new Set<string>();

  // Project nodes
  const projects = new Map<string, number>();
  for (const { note } of visible) {
    if (note.project) projects.set(note.project, (projects.get(note.project) ?? 0) + 1);
  }
  for (const [project, count] of projects) {
    const id = `project:${project}`;
    nodes.push({
      id,
      kind: 'project',
      label: projectNameOf(project),
      weight: Math.min(1, 0.4 + count / 20),
      detail: project,
    });
  }

  // Concept nodes (the most frequent)
  const concepts = new Map<string, number>();
  for (const { note } of visible) {
    for (const concept of note.concepts) {
      concepts.set(concept, (concepts.get(concept) ?? 0) + 1);
    }
  }
  const topConcepts = [...concepts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxConcepts);
  const conceptIds = new Set<string>();
  for (const [concept, count] of topConcepts) {
    const id = `concept:${concept}`;
    conceptIds.add(concept);
    nodes.push({
      id,
      kind: 'concept',
      label: concept,
      weight: Math.min(1, 0.25 + count / 12),
      detail: `${count} notes mention it`,
    });
  }

  // Note nodes
  for (const { note, value } of visible) {
    noteIds.add(note.id);
    nodes.push(noteToNode(note, value));
  }

  // Note → project / concept edges
  for (const { note, value } of visible) {
    if (note.project) {
      edges.push({
        id: `p:${note.id}:${note.project}`,
        source: note.id,
        target: `project:${note.project}`,
        kind: 'project',
        weight: value,
      });
    }
    for (const concept of note.concepts) {
      if (!conceptIds.has(concept)) continue;
      edges.push({
        id: `c:${note.id}:${concept}`,
        source: note.id,
        target: `concept:${concept}`,
        kind: 'concept',
        weight: value,
      });
    }
  }

  // Note ↔ note links (only those whose both ends are visible)
  const seen = new Set<string>();
  for (const { note } of visible) {
    for (const link of memory.linksOf(note.id)) {
      if (!noteIds.has(link.id)) continue;
      const key = [note.id, link.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: `l:${key}`,
        source: note.id,
        target: link.id,
        kind: 'link',
        weight: link.weight,
      });
    }
  }

  // Conflict edges
  const conflicts = memory.conflicts();
  for (const pair of conflicts) {
    if (!noteIds.has(pair.a.id) || !noteIds.has(pair.b.id)) continue;
    edges.push({
      id: `x:${pair.a.id}:${pair.b.id}`,
      source: pair.a.id,
      target: pair.b.id,
      kind: 'conflict',
      weight: 1,
    });
  }

  // Do not leave notes that connect nowhere "loose": a note stays visible even without its own concept.
  const regions = buildRegions(visible, conceptIds);
  return {
    nodes,
    edges,
    regions,
    stats: {
      notes: visible.length,
      concepts: conceptIds.size,
      projects: projects.size,
      dormant: visible.filter((v) => v.note.dormant).length,
      conflicts: conflicts.filter((p) => noteIds.has(p.a.id) && noteIds.has(p.b.id)).length,
      truncated,
    },
  };
}

/**
 * Regions: project, layer (episodic/semantic) and dense concept sets.
 * The UI shows only these at first; clicking a region opens its contents.
 * Box layout is a simple grid: enough and stable since the card count is small.
 */
export function buildRegions(
  visible: { note: Note; value: number }[],
  conceptIds: Set<string>,
): MapRegion[] {
  const regions: { id: string; kind: MapRegion['kind']; label: string; nodeIds: string[]; weight: number }[] = [];

  // 1) Projects
  const byProject = new Map<string, string[]>();
  for (const { note } of visible) {
    if (!note.project) continue;
    const list = byProject.get(note.project) ?? [];
    list.push(note.id);
    byProject.set(note.project, list);
  }
  // Project regions: the 12 projects with the most notes; the rest are collected in one box.
  const projectEntries = [...byProject.entries()].sort((a, b) => b[1].length - a[1].length);
  const shownProjects = projectEntries.slice(0, 12);
  const restProjects = projectEntries.slice(12);
  for (const [project, ids] of shownProjects) {
    regions.push({
      id: `region:project:${project}`,
      kind: 'project',
      label: projectNameOf(project),
      nodeIds: ids,
      weight: Math.min(1, 0.4 + ids.length / 20),
    });
  }
  if (restProjects.length > 0) {
    regions.push({
      id: 'region:project:other',
      kind: 'project',
      label: `other projects (${restProjects.length})`,
      nodeIds: restProjects.flatMap(([, ids]) => ids),
      weight: 0.3,
    });
  }

  // 2) Layers
  const episodic = visible.filter((v) => v.note.kind === 'episodic').map((v) => v.note.id);
  const semantic = visible.filter((v) => v.note.kind === 'semantic').map((v) => v.note.id);
  if (episodic.length > 0) {
    regions.push({
      id: 'region:layer:episodic',
      kind: 'layer',
      label: 'Memories',
      nodeIds: episodic,
      weight: Math.min(1, 0.3 + episodic.length / 30),
    });
  }
  if (semantic.length > 0) {
    regions.push({
      id: 'region:layer:semantic',
      kind: 'layer',
      label: 'Facts',
      nodeIds: semantic,
      weight: Math.min(1, 0.3 + semantic.length / 30),
    });
  }

  // 3) Concept clusters (only the strongest 6)
  const byConcept = new Map<string, string[]>();
  for (const { note } of visible) {
    for (const concept of note.concepts) {
      if (!conceptIds.has(concept)) continue;
      const list = byConcept.get(concept) ?? [];
      list.push(note.id);
      byConcept.set(concept, list);
    }
  }
  const topConcepts = [...byConcept.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  for (const [concept, ids] of topConcepts) {
    // Counting notes that already appear in a project again is harmless; this is a region view.
    regions.push({
      id: `region:concept:${concept}`,
      kind: 'concept',
      label: `#${concept}`,
      nodeIds: [...new Set(ids)],
      weight: Math.min(1, 0.2 + ids.length / 15),
    });
  }

  // Grid layout (normalized 0..1)
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(regions.length))));
  const rows = Math.ceil(regions.length / cols);
  return regions.map((region, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const w = 1 / cols;
    const h = 1 / Math.max(1, rows);
    return {
      ...region,
      count: region.nodeIds.length,
      x: col * w,
      y: row * h,
      w,
      h,
    };
  });
}

function noteToNode(note: Note, value: number): MapNode {
  // Weight: retrievability + importance. Fresh notes share the same R;
  // the importance difference must show in node size.
  const weight = Math.min(1, value * (0.7 + Math.min(1, Math.max(0, note.base)) * 0.3));
  return {
    id: note.id,
    kind: 'note',
    label: note.text.length > 60 ? `${note.text.slice(0, 57)}…` : note.text,
    weight,
    noteId: note.id,
    detail: note.text,
    concepts: note.concepts,
    evidence: note.evidence.slice(0, 8),
    dormant: note.dormant,
    forgotten: note.forgotten,
    conflict: note.conflict,
    recallCount: note.recallCount,
    ...(note.isTrauma ? { trauma: true } : {}),
  };
}

function projectNameOf(key: string): string {
  const parts = key.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? key;
}
