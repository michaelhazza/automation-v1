import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User, getActiveClientId, getActiveClientName } from '../lib/auth';
import HeartbeatEditor from '../components/HeartbeatEditor';
// Inline SVG icons (matching codebase convention — no lucide-react dependency)
const Ico = ({ children, ...props }: { children: React.ReactNode } & React.SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>
);
const ZoomIn = (props: React.SVGProps<SVGSVGElement>) => <Ico {...props}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></Ico>;
const ZoomOut = (props: React.SVGProps<SVGSVGElement>) => <Ico {...props}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></Ico>;
const Maximize2 = (props: React.SVGProps<SVGSVGElement>) => <Ico {...props}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></Ico>;
const Plus = (props: React.SVGProps<SVGSVGElement>) => <Ico {...props}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Ico>;
const LayoutGrid = (props: React.SVGProps<SVGSVGElement>) => <Ico {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>;
const GitBranch = (props: React.SVGProps<SVGSVGElement>) => <Ico {...props}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></Ico>;

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentNode {
  id: string;
  agentId: string;
  agentRole: string | null;
  agentTitle: string | null;
  parentSubaccountAgentId: string | null;
  isActive: boolean;
  agent: { name: string; icon: string | null; status: string };
  children: AgentNode[];
}

interface LayoutNode {
  node: AgentNode;
  x: number;
  y: number;
}

interface Edge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

// ── Layout constants ───────────────────────────────────────────────────────

const CARD_W = 200;
const CARD_H = 90;
const GAP_X = 32;
const GAP_Y = 80;
const PAD = 60;

// ── Tree layout algorithm ──────────────────────────────────────────────────

function subtreeWidth(node: AgentNode): number {
  if (node.children.length === 0) return CARD_W;
  const childrenWidth = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  return Math.max(CARD_W, childrenWidth + GAP_X * (node.children.length - 1));
}

function layoutTree(node: AgentNode, x: number, y: number): LayoutNode[] {
  const result: LayoutNode[] = [{ node, x, y }];
  if (node.children.length === 0) return result;

  const totalW = node.children.reduce((s, c) => s + subtreeWidth(c), 0) + GAP_X * (node.children.length - 1);
  let cx = x - totalW / 2;

  for (const child of node.children) {
    const w = subtreeWidth(child);
    const childX = cx + w / 2;
    result.push(...layoutTree(child, childX, y + CARD_H + GAP_Y));
    cx += w + GAP_X;
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
    offsetX += w + GAP_X * 2;
  }
  return layouts;
}

function collectEdges(layout: LayoutNode[]): Edge[] {
  const posMap = new Map<string, { x: number; y: number }>();
  for (const l of layout) posMap.set(l.node.id, { x: l.x, y: l.y });

  const edges: Edge[] = [];
  for (const l of layout) {
    if (l.node.parentSubaccountAgentId) {
      const parent = posMap.get(l.node.parentSubaccountAgentId);
      if (parent) {
        edges.push({
          fromX: parent.x,
          fromY: parent.y + CARD_H,
          toX: l.x,
          toY: l.y,
        });
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

const ROLE_CLS: Record<string, string> = {
  ceo: 'bg-amber-100 text-amber-800',
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function OrgChartPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const activeClientId = getActiveClientId();
  const activeClientName = getActiveClientName();

  const [agents, setAgents] = useState<Omit<AgentNode, 'children'>[]>([]);
  const [heartbeatAgents, setHeartbeatAgents] = useState<{ id: string; agentId: string; name: string; icon: string | null; heartbeatEnabled: boolean; heartbeatIntervalHours: number | null; heartbeatOffsetHours: number; heartbeatOffsetMinutes: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'chart' | 'list'>('chart');
  const [liveAgentIds, setLiveAgentIds] = useState<Set<string>>(new Set());

  // Pan & zoom
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInit = useRef(false);

  useEffect(() => {
    if (!activeClientId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/subaccounts/${activeClientId}/agents`),
      api.get('/api/agents').catch((err) => { console.error('[OrgChart] Failed to fetch org agents:', err); return { data: [] }; }),
      api.get(`/api/subaccounts/${activeClientId}/live-status`).catch(() => ({ data: { runningAgentIds: [] } })),
    ]).then(([saRes, _orgRes, liveRes]) => {
      const liveIds = new Set<string>((liveRes.data?.runningAgentIds ?? []) as string[]);
      setLiveAgentIds(liveIds);
      const saData = saRes.data as any[];
      setAgents(saData);
      // Map subaccount agents to heartbeat format (these are the execution-level configs)
      setHeartbeatAgents(saData.filter((a: any) => a.isActive).map((a: any) => ({
        id: a.id, // subaccount agent link ID
        agentId: a.agentId,
        name: a.agent?.name ?? 'Unknown',
        icon: a.agent?.icon ?? null,
        heartbeatEnabled: a.heartbeatEnabled ?? false,
        heartbeatIntervalHours: a.heartbeatIntervalHours ?? null,
        heartbeatOffsetHours: a.heartbeatOffsetHours ?? 9,
        heartbeatOffsetMinutes: a.heartbeatOffsetMinutes ?? 0,
      })));
    }).catch((err) => { console.error('[OrgChart] Failed to load org chart data:', err); setAgents([]); setHeartbeatAgents([]); })
      .finally(() => setLoading(false));
  }, [activeClientId]);

  const roots = useMemo(() => buildTree(agents), [agents]);
  const layout = useMemo(() => layoutForest(roots), [roots]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

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

  // Auto-fit on first load
  useEffect(() => {
    if (hasInit.current || layout.length === 0 || !containerRef.current) return;
    hasInit.current = true;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / bounds.w;
    const scaleY = rect.height / bounds.h;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);
    setZoom(Math.max(0.3, Math.min(fitZoom, 1.2)));
    setPan({
      x: rect.width / 2 - (bounds.minX + bounds.w / 2) * fitZoom,
      y: rect.height / 2 - (bounds.minY + bounds.h / 2) * fitZoom,
    });
  }, [layout, bounds]);

  // Mouse handlers for pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-card]')) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // Scroll zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.max(0.3, Math.min(2, z + delta)));
  }, []);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current || layout.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / bounds.w;
    const scaleY = rect.height / bounds.h;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);
    setZoom(Math.max(0.3, fitZoom));
    setPan({
      x: rect.width / 2 - (bounds.minX + bounds.w / 2) * fitZoom,
      y: rect.height / 2 - (bounds.minY + bounds.h / 2) * fitZoom,
    });
  }, [layout, bounds]);

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
        <p className="text-[13px] text-slate-500 max-w-sm mb-4">Create your first agent to see the org chart.</p>
        <button
          onClick={() => navigate('/admin/agents')}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg cursor-pointer border-0 transition-colors"
        >
          <Plus size={14} />
          Add Agent
        </button>
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
          </div>

          {/* Zoom controls (chart mode only) */}
          {viewMode === 'chart' && (
            <>
              <div className="w-px h-5 bg-slate-200" />
              <span className="text-[12px] text-slate-400 font-mono">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer" title="Zoom in">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer" title="Zoom out">
                <ZoomOut size={14} />
              </button>
              <button onClick={fitToScreen} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer" title="Fit to view">
                <Maximize2 size={14} />
              </button>
            </>
          )}

          <div className="w-px h-5 bg-slate-200" />

          {/* Add Agent */}
          <button
            onClick={() => navigate('/admin/agents')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold rounded-lg cursor-pointer border-0 transition-colors"
          >
            <Plus size={14} />
            Add Agent
          </button>
        </div>
      </div>

      {/* Chart view */}
      {viewMode === 'chart' && (
        <>
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            className={`relative overflow-hidden bg-white border border-slate-200 rounded-xl ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ userSelect: 'none', height: 'min(500px, calc(100vh - 300px))' }}
          >
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            >
              {/* SVG connectors */}
              <svg
                style={{ position: 'absolute', top: 0, left: 0, width: bounds.w + Math.abs(bounds.minX) * 2, height: bounds.h + Math.abs(bounds.minY) * 2, pointerEvents: 'none', overflow: 'visible' }}
              >
                {edges.map((e, i) => {
                  const midY = e.fromY + (e.toY - e.fromY) / 2;
                  return (
                    <path
                      key={i}
                      d={`M ${e.fromX} ${e.fromY} C ${e.fromX} ${midY}, ${e.toX} ${midY}, ${e.toX} ${e.toY}`}
                      fill="none"
                      stroke="#cbd5e1"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </svg>

              {/* Agent cards */}
              {layout.map((l) => {
                const a = l.node;
                const dotColor = STATUS_DOT[a.agent.status] ?? STATUS_DOT.inactive;
                const roleCls = a.agentRole ? ROLE_CLS[a.agentRole] ?? 'bg-slate-100 text-slate-600' : null;
                const isLive = liveAgentIds.has(a.agentId);

                return (
                  <div
                    key={a.id}
                    data-card
                    onClick={() => navigate(`/agents/${a.agentId}`)}
                    className="absolute bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer"
                    style={{
                      width: CARD_W,
                      height: CARD_H,
                      transform: `translate(${l.x - CARD_W / 2}px, ${l.y}px)`,
                    }}
                  >
                    <div className="flex items-start gap-2.5 p-3 h-full">
                      {/* Icon */}
                      <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[18px] bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                        {a.agent.icon || '🤖'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span
                            className={`w-[6px] h-[6px] rounded-full shrink-0${isLive ? ' animate-pulse' : ''}`}
                            style={{ background: dotColor }}
                          />
                          <span className="font-semibold text-[13px] text-slate-900 truncate">{a.agent.name}</span>
                        </div>
                        {a.agentTitle && (
                          <div className="text-[11px] text-slate-500 truncate mb-1">{a.agentTitle}</div>
                        )}
                        {roleCls && (
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${roleCls}`}>
                            {a.agentRole}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Heartbeat Schedule */}
          <div className="mt-6">
            <HeartbeatEditor
              levelLabel="agent"
              agents={heartbeatAgents}
              onUpdate={async (linkId, config) => {
                await api.patch(`/api/subaccounts/${activeClientId}/agents/${linkId}`, config);
                const { data } = await api.get(`/api/subaccounts/${activeClientId}/agents`);
                setHeartbeatAgents((data as any[]).filter((a: any) => a.isActive).map((a: any) => ({
                  id: a.id, agentId: a.agentId,
                  name: a.agent?.name ?? 'Unknown', icon: a.agent?.icon ?? null,
                  heartbeatEnabled: a.heartbeatEnabled ?? false,
                  heartbeatIntervalHours: a.heartbeatIntervalHours ?? null,
                  heartbeatOffsetHours: a.heartbeatOffsetHours ?? 9,
                  heartbeatOffsetMinutes: a.heartbeatOffsetMinutes ?? 0,
                })));
              }}
            />
          </div>
        </>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {agents.map((a) => {
            const dotColor = STATUS_DOT[a.agent.status] ?? STATUS_DOT.inactive;
            const roleCls = a.agentRole ? ROLE_CLS[a.agentRole] ?? 'bg-slate-100 text-slate-600' : null;
            const isLive = liveAgentIds.has(a.agentId);
            const parentAgent = a.parentSubaccountAgentId
              ? agents.find((p) => p.id === a.parentSubaccountAgentId)
              : null;

            return (
              <div
                key={a.id}
                onClick={() => navigate(`/agents/${a.agentId}`)}
                className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-[20px] bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                    {a.agent.icon || '🤖'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className={`w-[7px] h-[7px] rounded-full shrink-0${isLive ? ' animate-pulse' : ''}`}
                        style={{ background: dotColor }}
                      />
                      <span className="font-semibold text-[14px] text-slate-900 truncate">{a.agent.name}</span>
                    </div>
                    {a.agentTitle && (
                      <div className="text-[12px] text-slate-500 truncate mb-1.5">{a.agentTitle}</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {roleCls && (
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${roleCls}`}>
                          {a.agentRole}
                        </span>
                      )}
                      <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${a.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {a.isActive ? 'active' : 'inactive'}
                      </span>
                    </div>
                    {parentAgent && (
                      <div className="text-[11px] text-slate-400 mt-1.5 truncate">
                        Reports to: {parentAgent.agent.name}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
