import { useEffect, useId, useRef, useState } from "react";

export interface ActivityNode {
  id: string;
  parentId: string | null;
  label: string;
  kind: string;
  status: string;
  summary: string;
  evidence: string;
  model: string;
}

const CARD_WIDTH = 244;
const CARD_HEIGHT = 116;
const COLUMN = 320;
const ROW = 144;
const humanize = (value: string) => value.replaceAll("_", " ");

export function ActivityDiagram({ nodes, focusRequest }: { nodes: ActivityNode[]; focusRequest?: { id: string; requestId: number } }) {
  const markerId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [followLatest, setFollowLatest] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(400);
  const viewportRef = useRef<HTMLDivElement>(null);
  const knownIds = useRef(new Set<string>());
  const latestId = useRef<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const lastFocus = useRef<typeof focusRequest>(undefined);
  const rowsPerColumn = Math.max(1, Math.floor((viewportHeight / zoom - 48 - CARD_HEIGHT) / ROW) + 1);
  const nodeLayoutKey = JSON.stringify(nodes.map(node => [node.id, node.parentId]));
  useEffect(() => {
    const pane = viewportRef.current;
    if (!pane) return;
    const update = () => setViewportHeight(pane.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const additions = nodes.filter(node => !knownIds.current.has(node.id));
    knownIds.current = new Set(nodes.map(node => node.id));
    if (additions.length) latestId.current = additions[additions.length - 1].id;
    const requested = focusRequest && lastFocus.current !== focusRequest;
    if (requested) {
      const card = cards.current.get(focusRequest.id);
      if (!card) return;
      lastFocus.current = focusRequest;
      setSelectedId(focusRequest.id);
      setFollowLatest(false);
      card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      card.focus({ preventScroll: true });
      return;
    }
    if (!followLatest || !latestId.current) return;
    const pane = viewportRef.current;
    const card = cards.current.get(latestId.current);
    if (!pane || !card) return;
    const bounds = card.getBoundingClientRect();
    const visible = pane.getBoundingClientRect();
    // Pan only the graph, keeping the transcript and page position stable.
    if (bounds.left < visible.left || bounds.right > visible.right || bounds.top < visible.top || bounds.bottom > visible.bottom) {
      pane.scrollTo({
        left: pane.scrollLeft + bounds.left - visible.left - (pane.clientWidth - bounds.width) / 2,
        top: pane.scrollTop + bounds.top - visible.top - (pane.clientHeight - bounds.height) / 2,
        behavior: "smooth",
      });
    }
  }, [focusRequest, nodeLayoutKey, followLatest, zoom, rowsPerColumn]);
  const selected = nodes.find(node => node.id === selectedId);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string, ActivityNode[]>();
  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  let index = 0;
  function place(node: ActivityNode) {
    if (positions.has(node.id)) return;
    positions.set(node.id, { x: 24 + Math.floor(index / rowsPerColumn) * COLUMN, y: 24 + (index % rowsPerColumn) * ROW });
    index++;
    for (const child of children.get(node.id) ?? []) place(child);
  }
  for (const node of nodes.filter(node => !node.parentId || !byId.has(node.parentId))) place(node);
  // Keep disconnected or malformed nodes inspectable as well.
  for (const node of nodes) if (!positions.has(node.id)) place(node);
  const width = Math.max(340, ...[...positions.values()].map(p => p.x + CARD_WIDTH + 24));
  const height = Math.max(180, ...[...positions.values()].map(p => p.y + CARD_HEIGHT + 24));

  return <div className="activity-diagram">
    <div className="activity-diagram__toolbar">
      <span>Activity hierarchy <span className="activity-diagram__count">{nodes.length}</span></span>
      <div className="activity-diagram__controls">
      <label className="activity-diagram__follow"><input type="checkbox" checked={followLatest} onChange={event => setFollowLatest(event.target.checked)} />Follow latest</label>
      <div className="activity-diagram__zoom" role="group" aria-label="Diagram zoom">
        <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</button>
        <button type="button" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, value + 0.25))}>+</button>
      </div>
      </div>
    </div>
    <p className="activity-diagram__hint">Arrows connect parent to child. Select an activity to inspect its source.</p>
    <div ref={viewportRef} className="activity-diagram__viewport" tabIndex={0} role="region" aria-label="Scrollable activity diagram">
      <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} aria-label="Observed activity hierarchy">
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" strokeWidth="1.5" /></marker></defs>
        <g className="activity-diagram__edges" aria-hidden="true">
          {nodes.map(node => {
            const parent = node.parentId ? positions.get(node.parentId) : undefined;
            const child = positions.get(node.id)!;
            if (!parent || parent === child) return null;
            const startX = parent.x + CARD_WIDTH;
            const startY = parent.y + CARD_HEIGHT / 2;
            const endY = child.y + CARD_HEIGHT / 2;
            if (parent.x === child.x) {
              const gutter = startX + 14;
              return <path key={node.id} d={`M${startX} ${startY} H${gutter} V${endY} H${child.x + CARD_WIDTH + 5}`} markerEnd={`url(#${markerId})`} />;
            }
            const middle = startX + (child.x - startX) / 2;
            return <path key={node.id} d={`M${startX} ${startY} H${middle} V${endY} H${child.x - 5}`} markerEnd={`url(#${markerId})`} />;
          })}
        </g>
        {nodes.map(node => {
          const position = positions.get(node.id)!;
          return <foreignObject key={node.id} x={position.x} y={position.y} width={CARD_WIDTH} height={CARD_HEIGHT}>
            <button type="button" className={`activity-card${selectedId === node.id ? " activity-card--selected" : ""}`} data-status={node.status} aria-pressed={selectedId === node.id} aria-label={`${node.label}, ${humanize(node.kind)}, ${humanize(node.status)}`} onClick={() => { setSelectedId(node.id); setFollowLatest(false); }} ref={element => {
              if (element) cards.current.set(node.id, element);
              else cards.current.delete(node.id);
            }}>
              <span className="activity-card__kind">«{humanize(node.kind)}»</span>
              <span className="activity-card__label" title={node.label}>{node.label}</span>
              <span className="activity-card__status"><span aria-hidden="true" />{humanize(node.status)}</span>
            </button>
          </foreignObject>;
        })}
      </svg>
    </div>
    {selected ? <section className="activity-inspector" aria-label="Selected activity" aria-live="polite">
      <div className="activity-inspector__heading"><h3>{selected.label}</h3><button type="button" onClick={() => setSelectedId(null)} aria-label="Close activity details">×</button></div>
      <p className="stream-disclaimer">{humanize(selected.kind)} · {humanize(selected.status)}</p>
      <p>{selected.summary}</p>
      <h4>Source evidence</h4>
      <blockquote>{selected.evidence}</blockquote>
      <p className="stream-disclaimer">Parser: {selected.model} · Node {selected.id}</p>
    </section> : <p className="activity-diagram__hint">Select a box to view its summary and exact source evidence.</p>}
  </div>;
}
