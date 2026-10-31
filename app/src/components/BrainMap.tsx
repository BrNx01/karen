import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BrainMap, MapNode } from '../../../server/memory/map.js';
import { useI18n } from '../i18n.js';
import {
  capNotes,
  computeForceLayout,
  fitViewport,
  tierForZoom,
  visibleKinds,
  type MapTier,
  type Viewport,
} from '../layout.js';

/** At the street tier at most this many notes are drawn; concepts/projects are never trimmed. */
const NOTE_CAP = 400;

type MapNodeData = {
  label: string;
  kind: MapNode['kind'];
  weight: number;
  detail?: string;
  dormant?: boolean;
  conflict?: boolean;
  recallCount?: number;
  trauma?: boolean;
};

function NoteNode(props: { data: MapNodeData; selected?: boolean }) {
  const { t } = useI18n();
  const { data } = props;
  return (
    <div
      className={`map-node note ${data.dormant ? 'dormant' : ''} ${data.conflict ? 'conflict' : ''} ${
        data.trauma ? 'trauma' : ''
      } ${props.selected ? 'selected' : ''}`}
      style={{ fontSize: 10 + data.weight * 5 }}
      title={data.detail}
    >
      <Handle type="target" position={Position.Left} className="map-handle" />
      {data.label}
      {data.conflict && <span className="map-badge">{t('map.badge.conflict')}</span>}
      <Handle type="source" position={Position.Right} className="map-handle" />
    </div>
  );
}

function ConceptNode(props: { data: MapNodeData }) {
  return (
    <div className="map-node concept" title={props.data.detail}>
      <Handle type="target" position={Position.Left} className="map-handle" />
      {props.data.label}
      <Handle type="source" position={Position.Right} className="map-handle" />
    </div>
  );
}

function ProjectNode(props: { data: MapNodeData }) {
  return (
    <div className="map-node project" title={props.data.detail}>
      <Handle type="target" position={Position.Left} className="map-handle" />
      ▣ {props.data.label}
      <Handle type="source" position={Position.Right} className="map-handle" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  noteNode: NoteNode as never,
  conceptNode: ConceptNode as never,
  projectNode: ProjectNode as never,
};

const COLORS: Record<string, string> = {
  link: 'rgba(120,150,200,0.35)',
  concept: 'rgba(90,120,170,0.25)',
  project: 'rgba(80,170,140,0.35)',
  conflict: '#e0b04a',
};

const TIER_KEY: Record<MapTier, 'map.tier.kita' | 'map.tier.sehir' | 'map.tier.sokak'> = {
  kita: 'map.tier.kita',
  sehir: 'map.tier.sehir',
  sokak: 'map.tier.sokak',
};

/**
 * Single canvas: every node lives in one layout, so zoom only changes visibility
 * (continent → city → street). Nodes never move.
 */
export function BrainMapView(props: {
  map: BrainMap | null;
  onOpenNote: (noteId: string) => void;
  onForget: (noteId: string) => void;
}) {
  const { t } = useI18n();
  if (!props.map) return <p className="empty">{t('common.loading')}</p>;
  if (props.map.nodes.length === 0) {
    return <p className="empty">{t('map.empty')}</p>;
  }
  return <MapCanvas map={props.map} onOpenNote={props.onOpenNote} onForget={props.onForget} />;
}

function MapCanvas(props: {
  map: BrainMap;
  onOpenNote: (noteId: string) => void;
  onForget: (noteId: string) => void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // undefined: not measured yet (React Flow is never mounted), null: measurement invalid.
  const [defaultViewport, setDefaultViewport] = useState<Viewport | null | undefined>(undefined);

  const allNodes = props.map.nodes;
  const allEdges = props.map.edges;

  // Layout computed once over all nodes so zoom never moves a node: it is not recomputed unless the id + weight signature changes.
  const signature = useMemo(
    () => `${allNodes.map((n) => n.id).join()}|${allEdges.map((e) => `${e.id}:${e.weight}`).join()}`,
    [allNodes, allEdges],
  );
  // The signature covers node ids and edge weights; positions do not depend on the tier.
  // The O(n²) iteration count drops with the node count: 60 iterations ≈ 400 ms at 840 nodes (the old 200 ≈ 1400 ms).
  const iterations = allNodes.length <= 300 ? 200 : allNodes.length <= 600 ? 100 : 60;
  const layout = useMemo(
    () => computeForceLayout(allNodes, allEdges, { iterations }),
    [signature, iterations],
  );

  // Framed from our own coordinates, not React Flow measurement, so the tier filter
  // cannot break fitView. Measurement happens once; later renders/tier changes do not refit.
  const points = useMemo(() => [...layout.values()], [layout]);
  useEffect(() => {
    if (defaultViewport !== undefined) return;
    const element = wrapRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const next = fitViewport(points, { width: rect.width, height: rect.height });
      if (next) setDefaultViewport(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [points, defaultViewport]);

  useEffect(() => {
    if (defaultViewport) setZoom(defaultViewport.zoom);
  }, [defaultViewport]);

  const tier = tierForZoom(zoom ?? defaultViewport?.zoom ?? 0.2);
  const visibleNodes = useMemo(() => {
    const kinds = visibleKinds(tier);
    const shown = allNodes.filter((node) => kinds.includes(node.kind));
    // Drawing 800+ notes at once locks the UI: only the strongest 400 stay at the street tier.
    return tier === 'sokak' ? capNotes(shown, NOTE_CAP) : shown;
  }, [allNodes, tier]);
  const mapNotes = allNodes.filter((node) => node.kind === 'note').length;
  const hiddenNotes = Math.max(0, mapNotes - NOTE_CAP);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => allEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [allEdges, visibleIds],
  );

  const flowNodes: Node[] = useMemo(
    () =>
      visibleNodes.map((node) => ({
        id: node.id,
        type: node.kind === 'note' ? 'noteNode' : node.kind === 'concept' ? 'conceptNode' : 'projectNode',
        position: layout.get(node.id) ?? { x: 0, y: 0 },
        data: {
          label: node.label,
          kind: node.kind,
          weight: node.weight,
          detail: node.detail,
          dormant: node.dormant,
          conflict: node.conflict,
          recallCount: node.recallCount,
          trauma: node.trauma,
        } satisfies MapNodeData,
        style:
          node.kind === 'note'
            ? { width: 150 + node.weight * 120 }
            : node.kind === 'concept'
              ? { width: 110 }
              : { width: 140 },
      })),
    [visibleNodes, layout],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: edge.kind === 'conflict',
        style: {
          stroke: COLORS[edge.kind] ?? 'rgba(120,150,200,0.3)',
          strokeWidth: edge.kind === 'conflict' ? 2 : 0.6 + edge.weight * 1.6,
          strokeDasharray: edge.kind === 'conflict' ? '6 4' : undefined,
        },
      })),
    [visibleEdges],
  );

  const selected = selectedId ? allNodes.find((n) => n.id === selectedId) : undefined;

  return (
    <div className="map-wrap">
      <div className="map-head">
        <h2 className="map-title">{t('map.title')}</h2>
        <span className="map-stats">
          {t('map.stats', {
            notes: props.map.stats.notes,
            concepts: props.map.stats.concepts,
            projects: props.map.stats.projects,
          })}
          {props.map.stats.conflicts > 0 && ` · ${t('map.conflicts', { count: props.map.stats.conflicts })}`}
          {props.map.stats.truncated ? ` · ${t('map.truncated', { count: props.map.stats.truncated })}` : ''}
          {tier === 'sokak' && hiddenNotes > 0 ? ` · ${t('map.hiddenNotes', { count: hiddenNotes })}` : ''}
        </span>
        <span className="map-level">{t(TIER_KEY[tier])}</span>
        <p className="hint">{t('map.hint')}</p>
        {props.map.stats.conflicts > 0 && (
          <p className="hint warn">{t('map.conflictHint', { count: props.map.stats.conflicts })}</p>
        )}
      </div>

      <div className="map-canvas" ref={wrapRef}>
        {visibleNodes.length === 0 && <p className="map-empty-hint">{t('map.zoomForDetail')}</p>}
        {defaultViewport !== undefined && (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onMove={(_, viewport) => setZoom(viewport.zoom)}
            defaultViewport={defaultViewport ?? undefined}
            minZoom={0.2}
            maxZoom={2.5}
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1d2430" gap={28} />
            <MiniMap pannable zoomable nodeColor={() => '#2a3546'} maskColor="rgba(10,12,16,0.7)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      {selected && (
        <aside className="map-detail">
          <div className="map-detail-head">
            <span className={`tag ${selected.kind}`}>
              {t(
                selected.kind === 'note'
                  ? 'map.kind.note'
                  : selected.kind === 'concept'
                    ? 'map.kind.concept'
                    : 'map.kind.project',
              )}
            </span>
            <button onClick={() => setSelectedId(null)}>{t('common.close')}</button>
          </div>
          <p className="map-detail-text">{selected.detail ?? selected.label}</p>
          <ul className="map-detail-meta">
            <li>{t('map.detail.strength', { value: selected.weight.toFixed(2) })}</li>
            {selected.recallCount !== undefined && (
              <li>{t('map.detail.recalls', { count: selected.recallCount })}</li>
            )}
            {selected.evidence && selected.evidence.length > 0 && (
              <li>
                {t('map.detail.sources', { sources: selected.evidence.map((id) => `#${id}`).join(' ') })}
              </li>
            )}
            {selected.concepts && selected.concepts.length > 0 && (
              <li>{t('map.detail.concepts', { list: selected.concepts.join(', ') })}</li>
            )}
            {selected.dormant && <li>{t('map.detail.dormant')}</li>}
            {selected.trauma && <li className="warn">{t('map.detail.trauma')}</li>}
            {selected.conflict && <li className="warn">{t('map.detail.conflict')}</li>}
          </ul>
          {selected.noteId && (
            <div className="repo-actions">
              <button className="primary" onClick={() => props.onOpenNote(selected.noteId!)}>
                {t('map.openInMemory')}
              </button>
              <button onClick={() => props.onForget(selected.noteId!)}>{t('map.forget')}</button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
