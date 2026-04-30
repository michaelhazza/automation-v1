import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User, getActiveClientId, getActiveClientName } from '../lib/auth';
import HeartbeatEditor from '../components/HeartbeatEditor';
// Inline SVG icons (matching codebase convention — no lucide-react dependency)
const Ico = ({ children, size, ...props }: { children: React.ReactNode; size?: number } & React.SVGProps<SVGSVGElement>) => (
  <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>
);
type IcoProps = { size?: number } & React.SVGProps<SVGSVGElement>;
const ZoomIn = (props: IcoProps) => <Ico {...props}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></Ico>;
const ZoomOut = (props: IcoProps) => <Ico {...props}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></Ico>;
const Maximize2 = (props: IcoProps) => <Ico {...props}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></Ico>;
const LayoutGrid = (props: IcoProps) => <Ico {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>;
const GitBranch = (props: IcoProps) => <Ico {...props}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></Ico>;

// ── Types ──────────────────────────────────────────────────────────────────

interface OrgChartNode {
  actorId: string;
  actorKind: 'agent' | 'human';
  displayName: string;
  parentActorId: string | null;
  parentValidationError?: 'cross_subaccount_parent' | 'cycle_detected';
  agentRole: string | null;
  agentTitle: string | null;
  identity?: { id: string; emailAddress: string; status: string; photoUrl: string | null };
  user?: { id: string; email: string };
}

interface AgentNode {
  id: string;
  agentId: string;
  agentRole: string | null;
  agentTitle: string | null;
  parentSubaccountAgentId: string | null;
  isActive: boolean;
  actorKind?: 'agent' | 'human';
  identityStatus?: string;
  agent: { name: string; icon: string | null; status: string };
  children: AgentNode[];
}

interface LayoutNode {
  node: AgentNode;
  x: number;
  y: number;
}

// Two edge shapes: orthogonal "tree" connectors between horizontally-laid
// nodes, and a single vertical "trunk" that runs through the centerline of
// a column of vertically-stacked leaves. Trunks are drawn behind the cards
// so only the gaps between cards show, giving a clean spine effect.
type Edge =
  | { kind: 'tree'; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: 'trunk'; x: number; fromY: number; toY: number };

// ── Layout constants ───────────────────────────────────────────────────────

const CARD_W = 180;
const CARD_H = 56;
const COL_GAP = 24;       // horizontal gap between sibling columns
const ROOT_GAP = 56;      // vertical gap from a parent to children laid horizontally
const HEAD_TO_LEAF = 28;  // vertical gap from a parent to first vertically-stacked leaf
const LEAF_GAP = 8;       // vertical gap between stacked leaves
const PAD = 24;

// ── Tree layout algorithm ──────────────────────────────────────────────────
// A node whose children are all leaves (no grandchildren) gets its children
// stacked vertically directly underneath it — same X, increasing Y. This
// prevents wide trees of small children from sprawling horizontally and
// keeps every column's footprint exactly CARD_W wide.
//
// All other nodes lay their children out horizontally with the classic
// "balance subtree widths" pattern.

function allChildrenAreLeaves(n: AgentNode): boolean {
  return n.children.length > 0 && n.children.every((c) => c.children.length === 0);
}

function subtreeWidth(node: AgentNode): number {
  if (node.children.length === 0) return CARD_W;
  if (allChildrenAreLeaves(node)) return CARD_W;
  const childrenWidth = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  return Math.max(CARD_W, childrenWidth + COL_GAP * (node.children.length - 1));
}

function layoutTree(node: AgentNode, x: number, y: number): LayoutNode[] {
  const result: LayoutNode[] = [{ node, x, y }];
  if (node.children.length === 0) return result;

  if (allChildrenAreLeaves(node)) {
    let leafY = y + CARD_H + HEAD_TO_LEAF;
    for (const child of node.children) {
      result.push({ node: child, x, y: leafY });
      leafY += CARD_H + LEAF_GAP;
    }
    return result;
  }

  const totalW = node.children.reduce((s, c) => s + subtreeWidth(c), 0) + COL_GAP * (node.children.length - 1);
  let cx = x - totalW / 2;

  for (const child of node.children) {
    const w = subtreeWidth(child);
    const childX = cx + w / 2;
    result.push(...layoutTree(child, childX, y + CARD_H + ROOT_GAP));
    cx += w + COL_GAP;
  }
  return result;
}

function layoutForest(roots: AgentNode[]): LayoutNode[] {
  if (roots.length === 0) return [];
  const layouts: LayoutNode[] = [];
  let offsetX = 0;
  for (const root of roots) {
    const w = subtreeWidth(root);
    layouts.push(...layoutTree(root, offsetX + w / 2, 0));
    offsetX += w + COL_GAP * 2;
  }
  return layouts;
}

function collectEdges(layout: LayoutNode[]): Edge[] {
  const byId = new Map(layout.map((l) => [l.node.id, l]));
  const edges: Edge[] = [];
  for (const l of layout) {
    const { node, x, y } = l;
    if (node.children.length === 0) continue;

    if (allChildrenAreLeaves(node)) {
      // Single vertical trunk from below the parent to the top of the last leaf.
      // The trunk passes behind every leaf card; only the gaps render visibly.
      const lastChild = node.children[node.children.length - 1];
      const lp = byId.get(lastChild.id);
      if (!lp) continue;
      edges.push({ kind: 'trunk', x, fromY: y + CARD_H, toY: lp.y });
    } else {
      for (const child of node.children) {
        const cp = byId.get(child.id);
        if (!cp) continue;
        edges.push({ kind: 'tree', fromX: x, fromY: y + CARD_H, toX: cp.x, toY: cp.y });
      }
    }
  }
  return edges;
}

// ── Build tree from flat list ──────────────────────────────────────────────

function buildTree(agents: Omit<AgentNode, 'children'>[]): AgentNode[] {
  const map = new Map<string, AgentNode>();
  for (const a of agents) map.set(a.id, { ...a, children: [] });

  const roots: AgentNode[] = [];
  for (const a of agents) {
    const node = map.get(a.id)!;
    if (a.parentSubaccountAgentId && map.has(a.parentSubaccountAgentId)) {
      map.get(a.parentSubaccountAgentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ── Status colours ─────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  active: '#4ade80',
  inactive: '#ef4444',
  draft: '#facc15',
};

// Actor kind border colours
const KIND_BORDER: Record<string, string> = {
  human: '#f59e0b',   // amber
  agent: 'var(--indigo-500, #6366f1)', // indigo
};

// Lifecycle dot colour derived from workspace identity status
function identityStatusDot(status: string | undefined): string {
  if (status === 'active') return '#22c55e';    // green
  if (status === 'suspended') return '#f97316'; // orange
  return '#94a3b8';                              // grey (not_onboarded / no identity)
}

// ── Component ──────────────────────────────────────────────────────────────

export default function OrgChartPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const activeClientId = getActiveClientId();
  const activeClientName = getActiveClientName();

  const [agents, setAgents] = useState<Omit<AgentNode, 'children'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'chart' | 'list' | 'schedule'>('chart');
  const [liveAgentIds, setLiveAgentIds] = useState<Set<string>>(new Set());
  const [listSort, setListSort] = useState<{ col: 'hierarchy' | 'name' | 'title' | 'status' | 'live'; dir: 'asc' | 'desc' }>({ col: 'hierarchy', dir: 'asc' });
  const [listFilter, setListFilter] = useState('');

  // Pan (via native scroll) & zoom
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInit = useRef(false);

  useEffect(() => {
    if (!activeClientId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/subaccounts/${activeClientId}/agents`),
      api.get('/api/agents').catch((err) => { console.error('[OrgChart] Failed to fetch org agents:', err); return { data: [] }; }),
      api.get(`/api/subaccounts/${activeClientId}/live-status`).catch(() => ({ data: { runningAgentIds: [] } })),
      api.get(`/api/subaccounts/${activeClientId}/workspace/org-chart`).catch(() => ({ data: [] })),
    ]).then(([saRes, _orgRes, liveRes, wsRes]) => {
      const liveIds = new Set<string>((liveRes.data?.runningAgentIds ?? []) as string[]);
      setLiveAgentIds(liveIds);

      const saAgents = saRes.data as Omit<AgentNode, 'children'>[];
      const wsNodes = wsRes.data as OrgChartNode[];

      // Build a lookup: workspaceActorId → saAgent, so workspace actors that
      // correspond to an existing subaccount agent can be deduplicated.
      const actorToSaAgent = new Map<string, Omit<AgentNode, 'children'>>();
      for (const a of saAgents) {
        // saAgent rows carry workspaceActorId if the agent has been onboarded
        const waid = (a as any).workspaceActorId as string | undefined;
        if (waid) actorToSaAgent.set(waid, a);
      }

      // For each workspace actor, either upgrade the existing saAgent entry
      // (use workspace parentActorId as the authoritative parent) or add a
      // synthetic AgentNode for actors that have no corresponding saAgent.
      const extraNodes: Omit<AgentNode, 'children'>[] = [];
      const seenActorIds = new Set<string>();

      for (const ws of wsNodes) {
        seenActorIds.add(ws.actorId);
        const existingSa = actorToSaAgent.get(ws.actorId);

        if (existingSa) {
          // Upgrade in-place: use workspace parent and carry kind + identity status
          (existingSa as any).parentSubaccountAgentId = ws.parentActorId;
          (existingSa as any).actorKind = ws.actorKind;
          (existingSa as any).identityStatus = ws.identity?.status;
        } else {
          // Workspace actor with no corresponding saAgent — add as synthetic node
          const identityStatus = ws.identity?.status;
          extraNodes.push({
            id: ws.actorId,
            agentId: ws.user?.id ?? ws.actorId,
            parentSubaccountAgentId: ws.parentActorId,
            agentRole: ws.agentRole,
            agentTitle: ws.agentTitle,
            isActive: identityStatus === 'active',
            actorKind: ws.actorKind,
            identityStatus,
            agent: {
              name: ws.displayName,
              icon: null,
              status: identityStatus ?? 'not_onboarded',
            },
          } as any);
        }
      }

      setAgents([...saAgents, ...extraNodes]);
    }).catch((err) => { console.error('[OrgChart] Failed to load org chart data:', err); setAgents([]); })
      .finally(() => setLoading(false));
  }, [activeClientId]);

  const roots = useMemo(() => buildTree(agents), [agents]);
  const layout = useMemo(() => layoutForest(roots), [roots]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Shared layout order map — used by both heartbeatAgents and listAgents so
  // we don't allocate two identical Maps from the same `layout` array.
  const layoutOrderMap = useMemo(() => new Map(layout.map((l, i) => [l.node.id, i])), [layout]);

  // Heartbeat agents are derived from `agents` + `layout` so the schedule
  // list renders in the same order as the chart (depth-first: root, then each
  // column top-to-bottom, columns left-to-right).
  const heartbeatAgents = useMemo(() => {
    return agents
      .filter((a: any) => a.isActive)
      .map((a: any) => ({
        id: a.id,
        agentId: a.agentId,
        name: a.agent?.name ?? 'Unknown',
        icon: a.agent?.icon ?? null,
        heartbeatEnabled: a.heartbeatEnabled ?? false,
        heartbeatIntervalHours: a.heartbeatIntervalHours ?? null,
        heartbeatOffsetHours: a.heartbeatOffsetHours ?? 9,
        heartbeatOffsetMinutes: a.heartbeatOffsetMinutes ?? 0,
      }))
      .sort((a, b) => (layoutOrderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (layoutOrderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [agents, layoutOrderMap]);

  const listAgents = useMemo(() => {
    const q = listFilter.toLowerCase();
    const filtered = agents.filter((a: any) =>
      !listFilter ||
      (a.agent.name ?? '').toLowerCase().includes(q) ||
      (a.agentTitle ?? '').toLowerCase().includes(q)
    );
    return [...filtered].sort((a: any, b: any) => {
      let cmp = 0;
      switch (listSort.col) {
        case 'hierarchy': cmp = (layoutOrderMap.get(a.id) ?? 999) - (layoutOrderMap.get(b.id) ?? 999); break;
        case 'name': cmp = (a.agent.name ?? '').localeCompare(b.agent.name ?? ''); break;
        case 'title': cmp = (a.agentTitle ?? '').localeCompare(b.agentTitle ?? ''); break;
        case 'status': cmp = Number(b.isActive) - Number(a.isActive); break;
        case 'live': cmp = Number(liveAgentIds.has(b.agentId)) - Number(liveAgentIds.has(a.agentId)); break;
      }
      return listSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [agents, listFilter, listSort, layoutOrderMap, liveAgentIds]);

  // Compute canvas bounds
  const bounds = useMemo(() => {
    if (layout.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of layout) {
      minX = Math.min(minX, l.x - CARD_W / 2);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + CARD_W / 2);
      maxY = Math.max(maxY, l.y + CARD_H);
    }
    return { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
  }, [layout]);

  // Centre the chart horizontally inside the scroll container after zoom changes.
  // Vertical scroll stays at the top so the root is visible.
  // Uses clientWidth (excludes border) so the calc matches the scroll viewport.
  const centerScroll = useCallback((nextZoom: number) => {
    const el = containerRef.current;
    if (!el) return;
    const sw = bounds.w * nextZoom;
    el.scrollLeft = Math.max(0, (sw - el.clientWidth) / 2);
    el.scrollTop = 0;
  }, [bounds.w]);

  // Auto-fit on first load. Cap at 1.0 so a small chart doesn't blow up;
  // floor at 0.4 so giant charts don't render at unreadable text sizes.
  // clientWidth/Height exclude the container's border — using getBoundingClientRect
  // here would set the sizer ~2px wider than the scroll viewport and falsely
  // trigger a horizontal scrollbar.
  useEffect(() => {
    if (hasInit.current || layout.length === 0 || !containerRef.current) return;
    hasInit.current = true;
    const el = containerRef.current;
    const scaleX = el.clientWidth / bounds.w;
    const scaleY = el.clientHeight / bounds.h;
    const fitZoom = Math.max(0.4, Math.min(scaleX, scaleY, 1));
    setZoom(fitZoom);
    requestAnimationFrame(() => centerScroll(fitZoom));
  }, [layout, bounds, centerScroll]);

  // Mouse handlers for pan (drag updates native scrollLeft/scrollTop)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-card]')) return;
    const el = containerRef.current;
    if (!el) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !containerRef.current) return;
    containerRef.current.scrollLeft = dragStart.current.scrollX - (e.clientX - dragStart.current.x);
    containerRef.current.scrollTop = dragStart.current.scrollY - (e.clientY - dragStart.current.y);
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // Ctrl/Cmd + wheel zooms; plain wheel falls through to native scroll.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.max(0.3, Math.min(2, z + delta)));
  }, []);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current || layout.length === 0) return;
    const el = containerRef.current;
    const scaleX = el.clientWidth / bounds.w;
    const scaleY = el.clientHeight / bounds.h;
    const fitZoom = Math.max(0.4, Math.min(scaleX, scaleY, 1));
    setZoom(fitZoom);
    requestAnimationFrame(() => centerScroll(fitZoom));
  }, [layout, bounds, centerScroll]);

  if (!activeClientId) {
    return (
      <div className="p-12 text-center">
        <p className="text-[16px] font-semibold text-slate-800">Select a company to view the org chart.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="text-sm text-slate-500">Loading org chart...</div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center">
        <div className="w-16 h-16 rounded-2xl bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)] flex items-center justify-center text-3xl mb-4">🏢</div>
        <p className="text-[16px] font-semibold text-slate-800 mb-2">No agents configured</p>
        <p className="text-[13px] text-slate-500 max-w-sm">No agents have been configured for this subaccount yet.</p>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 m-0">Org Chart</h1>
          <p className="text-[13px] text-slate-500 mt-0.5 m-0">{activeClientName ?? 'Company'} — {agents.length} agent{agents.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setViewMode('chart')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium cursor-pointer border-0 transition-colors ${
                viewMode === 'chart' ? 'bg-indigo-50 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <GitBranch size={13} />
              Chart
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium cursor-pointer border-0 border-l border-slate-200 transition-colors ${
                viewMode === 'list' ? 'bg-indigo-50 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid size={13} />
              List
            </button>
            <button
              onClick={() => setViewMode('schedule')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium cursor-pointer border-0 border-l border-slate-200 transition-colors ${
                viewMode === 'schedule' ? 'bg-indigo-50 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Maximize2 size={13} />
              Schedule
            </button>
          </div>

          {/* Zoom controls (chart mode only) */}
          {viewMode === 'chart' && (
            <>
              <div className="w-px h-5 bg-slate-200" />
              <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="btn btn-sm btn-icon-sm btn-secondary" title="Zoom in">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className="btn btn-sm btn-icon-sm btn-secondary" title="Zoom out">
                <ZoomOut size={14} />
              </button>
              <button onClick={fitToScreen} className="btn btn-sm btn-icon-sm btn-secondary" title="Fit to view">
                <Maximize2 size={14} />
              </button>
            </>
          )}

        </div>
      </div>

      {/* Chart view */}
      {viewMode === 'chart' && (
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className={`relative overflow-auto bg-white border border-slate-200 rounded-xl ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ userSelect: 'none', height: 'calc(100vh - 180px)' }}
        >
          {/* Sizer carries the scaled visual dimensions so the scroll container
              gets real overflow and renders native scrollbars. The inner
              transform shifts the (possibly negative) chart origin to (0,0).
              Math.floor avoids sub-pixel rounding inflating the sizer past
              clientWidth, which would falsely trigger a horizontal scrollbar. */}
          <div style={{ width: Math.floor(bounds.w * zoom), height: Math.floor(bounds.h * zoom), position: 'relative' }}>
          <div
            style={{
              transform: `translate(${-bounds.minX * zoom}px, ${-bounds.minY * zoom}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            {/* SVG connectors — drawn first so cards (added below) sit on top.
                Trunk lines pass through the centerline of stacked-leaf cards
                and are hidden behind those cards; only the inter-card gaps
                render visibly, giving the column a clean spine. */}
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: bounds.w + Math.abs(bounds.minX) * 2, height: bounds.h + Math.abs(bounds.minY) * 2, pointerEvents: 'none', overflow: 'visible' }}
            >
              {edges.map((e, i) => {
                if (e.kind === 'tree') {
                  const midY = e.fromY + (e.toY - e.fromY) / 2;
                  return (
                    <path
                      key={i}
                      d={`M ${e.fromX} ${e.fromY} L ${e.fromX} ${midY} L ${e.toX} ${midY} L ${e.toX} ${e.toY}`}
                      fill="none"
                      stroke="#cbd5e1"
                      strokeWidth={1.5}
                    />
                  );
                }
                return (
                  <path
                    key={i}
                    d={`M ${e.x} ${e.fromY} L ${e.x} ${e.toY}`}
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>

            {/* Agent cards — uniform horizontal layout (icon left, name + title right) */}
            {layout.map((l) => {
              const a = l.node;
              const isLive = liveAgentIds.has(a.agentId);
              const hasIdentity = !!(a as any).identityStatus;
              // Nodes with an identity status use the lifecycle dot; others use the legacy status dot
              const dotColor = hasIdentity
                ? identityStatusDot((a as any).identityStatus)
                : isLive ? '#22c55e' : (STATUS_DOT[a.agent.status] ?? '#cbd5e1');
              const kindBorder = (a as any).actorKind
                ? KIND_BORDER[(a as any).actorKind as string] ?? undefined
                : undefined;

              return (
                <div
                  key={a.id}
                  data-card
                  onClick={() => navigate(`/agents/${a.agentId}`)}
                  className="absolute bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer overflow-hidden"
                  style={{
                    width: CARD_W,
                    height: CARD_H,
                    transform: `translate(${l.x - CARD_W / 2}px, ${l.y}px)`,
                  }}
                >
                  {/* Kind indicator: coloured left border for humans (amber) and agents (indigo) */}
                  {kindBorder && (
                    <div
                      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: kindBorder, borderRadius: '8px 0 0 8px' }}
                    />
                  )}
                  <div className="flex items-center gap-2.5 h-full relative" style={{ paddingLeft: kindBorder ? 10 : 10, paddingRight: 10 }}>
                    <div className="w-[34px] h-[34px] rounded-[8px] shrink-0 flex items-center justify-center text-[18px] bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                      {a.agent.icon || ((a as any).actorKind === 'human' ? '👤' : '🤖')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-slate-900 truncate leading-tight">
                        {a.agent.name}
                      </div>
                      {a.agentTitle && (
                        <div className="text-[9.5px] text-slate-400 uppercase tracking-wider mt-0.5 truncate">
                          {a.agentTitle}
                        </div>
                      )}
                    </div>
                    <span
                      className={`absolute top-2 right-2 w-[6px] h-[6px] rounded-full${isLive && !hasIdentity ? ' animate-pulse' : ''}`}
                      style={{ background: dotColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </div>
      )}

      {/* Schedule view — heartbeat editor lives here on its own tab so the
          Chart and List views stay focused on org structure. */}
      {viewMode === 'schedule' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <HeartbeatEditor
            levelLabel="agent"
            agents={heartbeatAgents}
            onUpdate={async (linkId, config) => {
              await api.patch(`/api/subaccounts/${activeClientId}/agents/${linkId}`, config);
              const { data } = await api.get(`/api/subaccounts/${activeClientId}/agents`);
              setAgents(data as Omit<AgentNode, 'children'>[]);
            }}
          />
        </div>
      )}

      {/* List view — sortable/filterable table */}
      {viewMode === 'list' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <input
              type="text"
              placeholder="Filter agents…"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              className="flex-1 max-w-xs text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {listFilter && (
              <button onClick={() => setListFilter('')} className="btn btn-xs btn-ghost text-slate-400">Clear</button>
            )}
            {listSort.col !== 'hierarchy' && (
              <button onClick={() => setListSort({ col: 'hierarchy', dir: 'asc' })} className="btn btn-xs btn-ghost text-indigo-500">
                Reset order
              </button>
            )}
            <span className="ml-auto text-[12px] text-slate-400">{listAgents.length} agent{listAgents.length !== 1 ? 's' : ''}</span>
          </div>
          <table className="data-table w-full">
            <thead>
              <tr>
                {([
                  { col: 'name' as const, label: 'Name' },
                  { col: 'title' as const, label: 'Title' },
                  { col: 'status' as const, label: 'Status' },
                  { col: 'live' as const, label: 'Live' },
                ] as { col: 'name' | 'title' | 'status' | 'live'; label: string }[]).map(({ col, label }) => (
                  <th
                    key={col}
                    onClick={() => setListSort((s) => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })}
                    className="cursor-pointer select-none whitespace-nowrap"
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {listSort.col === col
                        ? <span className="text-indigo-500">{listSort.dir === 'asc' ? '↑' : '↓'}</span>
                        : <span className="text-slate-300">↕</span>}
                    </span>
                  </th>
                ))}
                <th className="whitespace-nowrap">Reports To</th>
              </tr>
            </thead>
            <tbody>
              {listAgents.map((a: any) => {
                const isLive = liveAgentIds.has(a.agentId);
                const parentAgent = a.parentSubaccountAgentId
                  ? agents.find((p: any) => p.id === a.parentSubaccountAgentId)
                  : null;
                return (
                  <tr key={a.id} onClick={() => navigate(`/agents/${a.agentId}`)} className="cursor-pointer">
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[16px] bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                          {a.agent.icon || '🤖'}
                        </div>
                        <span className="font-medium text-[13px] text-slate-900">{a.agent.name}</span>
                      </div>
                    </td>
                    <td className="text-[13px] text-slate-500">{a.agentTitle ?? '—'}</td>
                    <td>
                      <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${a.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {a.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`inline-block w-2 h-2 rounded-full${isLive ? ' animate-pulse' : ''}`}
                        style={{ background: isLive ? '#22c55e' : (STATUS_DOT[a.agent.status] ?? '#cbd5e1') }}
                      />
                    </td>
                    <td className="text-[13px] text-slate-500">{parentAgent ? parentAgent.agent.name : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {listAgents.length === 0 && listFilter && (
            <div className="py-8 text-center text-[13px] text-slate-400">No agents match "{listFilter}"</div>
          )}
        </div>
      )}
    </div>
  );
}
