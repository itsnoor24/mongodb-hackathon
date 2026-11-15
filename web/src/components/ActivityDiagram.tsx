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
const GROUP_PAD = 18;
const GROUP_GAP = 16;
const GROUP_LABEL = 26;
interface TaskGroup {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const humanize = (value: string) => value.replaceAll("_", " ");
const groupCaption = (group: TaskGroup) => {
  const max = Math.max(16, Math.floor((group.width - 36) / 7.2));
  return group.label.length > max ? `${group.label.slice(0, max - 1)}…` : group.label;
};

export function ActivityDiagram({ nodes, focusRequest }: { nodes: ActivityNode[]; focusRequest?: { id: string; requestId: number } }) {
  const markerId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [followLatest, setFollowLatest] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const knownIds = useRef(new Set<string>());
  const latestId = useRef<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const lastFocus = useRef<typeof focusRequest>(undefined);
  const nodeLayoutKey = JSON.stringify(nodes.map(node => [node.id, node.parentId]));
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
  }, [focusRequest, nodeLayoutKey, followLatest, zoom]);
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
  const groups: TaskGroup[] = [];
  const rowLimit = CARD_WIDTH * 4 + GROUP_GAP * 3;
  interface LaidOut { width: number; height: number; positions: Map<string, { x: number; y: number }>; groups: TaskGroup[] }
  function layout(node: ActivityNode): LaidOut {
    const kids = children.get(node.id) ?? [];
    if (kids.length === 0) return { width: CARD_WIDTH, height: CARD_HEIGHT, positions: new Map([[node.id, { x: 0, y: 0 }]]), groups: [] };
    const rows: { items: LaidOut[]; width: number; height: number }[] = [];
    for (const item of kids.map(layout)) {
      const row = rows.at(-1);
      if (!row || row.width + GROUP_GAP + item.width > rowLimit) rows.push({ items: [item], width: item.width, height: item.height });
      else { row.items.push(item); row.width += GROUP_GAP + item.width; row.height = Math.max(row.height, item.height); }
    }
    const innerWidth = Math.max(CARD_WIDTH, ...rows.map(row => row.width));
    const laid: LaidOut = { width: 0, height: 0, positions: new Map(), groups: [] };
    laid.positions.set(node.id, { x: GROUP_PAD + (innerWidth - CARD_WIDTH) / 2, y: GROUP_PAD + GROUP_LABEL });
    let cursorY = GROUP_PAD + GROUP_LABEL + CARD_HEIGHT + GROUP_GAP;
    for (const row of rows) {
      let cursorX = GROUP_PAD;
      for (const item of row.items) {
        for (const [id, point] of item.positions) laid.positions.set(id, { x: point.x + cursorX, y: point.y + cursorY });
        for (const group of item.groups) laid.groups.push({ ...group, x: group.x + cursorX, y: group.y + cursorY });
        cursorX += item.width + GROUP_GAP;
      }
      cursorY += row.height + GROUP_GAP;
    }
    laid.width = innerWidth + GROUP_PAD * 2;
    laid.height = cursorY - GROUP_GAP + GROUP_PAD;
    laid.groups.push({ id: node.id, kind: node.kind, label: node.label, x: 0, y: 0, width: laid.width, height: laid.height });
    return laid;
  }
  function place(node: ActivityNode, x: number, y: number) {
    const laid = layout(node);
    for (const [id, point] of laid.positions) positions.set(id, { x: point.x + x, y: point.y + y });
    for (const group of laid.groups) groups.push({ ...group, x: group.x + x, y: group.y + y });
    return laid;
  }
  const roots = nodes.filter(node => !node.parentId || !byId.has(node.parentId));
  let cursorX = 24;
  let contentHeight = 180;
  for (const root of roots) {
    const size = place(root, cursorX, 24);
    cursorX += size.width + 28;
    contentHeight = Math.max(contentHeight, size.height + 48);
  }
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    const size = place(node, cursorX, 24);
    cursorX += size.width + 28;
    contentHeight = Math.max(contentHeight, size.height + 48);
  }
  const width = Math.max(340, cursorX);
  const height = contentHeight;
  const groupLayers = [...groups].sort((a, b) => b.width * b.height - a.width * a.height);

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
    <p className="activity-diagram__hint">A colored region groups a step with the work under it. Select a box to read its source.</p>
    <div ref={viewportRef} className="activity-diagram__viewport" tabIndex={0} role="region" aria-label="Scrollable activity diagram">
      <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} aria-label="Observed activity hierarchy">
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" strokeWidth="1.5" /></marker></defs>
        <g className="activity-diagram__groups">
          {groupLayers.map(group => <g key={group.id}>
            <rect className="activity-group" data-kind={group.kind} x={group.x} y={group.y} width={group.width} height={group.height} rx="18" />
            <text className="activity-group__label" x={group.x + 16} y={group.y + 20}>{groupCaption(group)}</text>
          </g>)}
        </g>
        <g className="activity-diagram__edges" aria-hidden="true">
          {nodes.map(node => {
            const parent = node.parentId ? positions.get(node.parentId) : undefined;
            const child = positions.get(node.id)!;
            if (!parent || parent === child) return null;
            const startX = parent.x + CARD_WIDTH / 2;
            const startY = parent.y + CARD_HEIGHT;
            const endX = child.x + CARD_WIDTH / 2;
            const endY = child.y;
            const path = Math.abs(startX - endX) < 8
              ? `M${startX} ${startY} V${endY - 6}`
              : `M${startX} ${startY} V${startY + (endY - startY) / 2} H${endX} V${endY - 6}`;
            return <path key={node.id} d={path} markerEnd={`url(#${markerId})`} />;
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
