import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';

// ---------------------------------------------------------------------------
// Types (mirroring shared/types/delegation.ts DelegationGraph* shapes)
// ---------------------------------------------------------------------------

interface DelegationGraphNode {
  runId: string;
  agentId: string;
  agentName: string;
  isSubAgent: boolean;
  delegationScope: 'children' | 'descendants' | 'subaccount' | null;
  hierarchyDepth: number | null;
  delegationDirection: 'down' | 'up' | 'lateral' | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface DelegationGraphEdge {
  parentRunId: string;
  childRunId: string;
  kind: 'spawn' | 'handoff';
}

interface DelegationGraphResponse {
  rootRunId: string;
  nodes: DelegationGraphNode[];
  edges: DelegationGraphEdge[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'completed'
      ? 'bg-emerald-400'
      : status === 'failed' || status === 'error'
      ? 'bg-red-400'
      : status === 'running' || status === 'delegated'
      ? 'bg-indigo-400 animate-pulse'
      : 'bg-slate-300';
  return <span className={`inline-block w-2 h-2 rounded-full ${color} flex-shrink-0`} />;
}

function DirectionBadge({ direction }: { direction: DelegationGraphNode['delegationDirection'] }) {
  if (!direction) return null;
  const styles: Record<string, string> = {
    down: 'text-emerald-700 border-emerald-300',
    up: 'text-amber-700 border-amber-300 border-dashed',
    lateral: 'text-amber-600 border-amber-200 border-dotted',
  };
  const arrows: Record<string, string> = { down: '↓', up: '↑', lateral: '↔' };
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border ${styles[direction] ?? ''}`}
    >
      {arrows[direction]} {direction}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: DelegationGraphNode['delegationScope'] }) {
  if (!scope) return null;
  return (
    <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
      {scope}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Recursive tree node
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  nodeId: string;
  nodeMap: Map<string, DelegationGraphNode>;
  childrenMap: Map<string, DelegationGraphEdge[]>;
  depth: number;
  onSelectRun: (runId: string) => void;
}

function TreeNode({ nodeId, nodeMap, childrenMap, depth, onSelectRun }: TreeNodeProps) {
  const [collapsed, setCollapsed] = useState(depth > 0);
  const node = nodeMap.get(nodeId);
  if (!node) return null;

  const outboundEdges = childrenMap.get(nodeId) ?? [];
  const hasChildren = outboundEdges.length > 0;

  return (
    <div className={depth > 0 ? 'ml-5 border-l border-slate-200 pl-3' : ''}>
      <div className="flex items-center gap-2 py-1.5">
        {hasChildren && (
          <button
            className="text-slate-400 hover:text-slate-600 text-[11px] w-4 flex-shrink-0"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        )}
        {!hasChildren && <span className="w-4 flex-shrink-0" />}

        <StatusDot status={node.status} />

        <button
          className="text-[13px] font-medium text-slate-800 hover:text-indigo-600 transition-colors text-left"
          onClick={() => onSelectRun(node.runId)}
          title={`Run ${node.runId}`}
        >
          {node.agentName}
        </button>

        <span className="text-[11px] text-slate-400">{node.status}</span>

        <DirectionBadge direction={node.delegationDirection} />
        <ScopeBadge scope={node.delegationScope} />

        {node.hierarchyDepth !== null && (
          <span className="text-[10px] text-slate-400">depth {node.hierarchyDepth}</span>
        )}
      </div>

      {!collapsed &&
        outboundEdges.map((edge) => {
          const childNode = nodeMap.get(edge.childRunId);
          const dir = childNode?.delegationDirection ?? null;
          const edgeColor =
            dir === 'down'
              ? 'text-emerald-600'
              : dir === 'up'
              ? 'text-amber-600'
              : dir === 'lateral'
              ? 'text-amber-500'
              : 'text-slate-400';
          return (
            <div key={`${edge.kind}-${edge.childRunId}`}>
              <div className={`flex items-center gap-1 ml-4 text-[10px] ${edgeColor} mb-0.5`}>
                <span className="font-mono">{edge.kind === 'handoff' ? '⇢ handoff' : '→ spawn'}</span>
              </div>
              <TreeNode
                nodeId={edge.childRunId}
                nodeMap={nodeMap}
                childrenMap={childrenMap}
                depth={depth + 1}
                onSelectRun={onSelectRun}
              />
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DelegationGraphViewProps {
  runId: string;
}

export default function DelegationGraphView({ runId }: DelegationGraphViewProps) {
  const navigate = useNavigate();
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [graph, setGraph] = useState<DelegationGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    api
      .get<DelegationGraphResponse>(`/api/agent-runs/${runId}/delegation-graph`)
      .then(({ data }) => setGraph(data))
      .catch((err: unknown) => {
        const data = (err as { response?: { data?: unknown } }).response?.data;
        const errField = (data as { error?: unknown } | undefined)?.error;
        const message =
          typeof errField === 'string'
            ? errField
            : (errField as { message?: string } | undefined)?.message ??
              'Failed to load delegation graph';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [runId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleSelectRun = useCallback(
    (targetRunId: string) => {
      if (subaccountId) {
        navigate(`/admin/subaccounts/${subaccountId}/runs/${targetRunId}`, {
          state: { initialTab: 'delegation-graph' },
        });
      } else {
        navigate(`/run-trace/${targetRunId}`, { state: { initialTab: 'delegation-graph' } });
      }
    },
    [navigate, subaccountId],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-400 py-2">
        <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
        Loading delegation graph…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-[13px] text-red-500 py-2">
        {error}
        <button
          className="ml-3 text-indigo-500 hover:text-indigo-700 underline"
          onClick={fetchGraph}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!graph) return null;

  // Build lookup structures
  const nodeMap = new Map<string, DelegationGraphNode>(graph.nodes.map((n) => [n.runId, n]));

  // childrenMap: parentRunId → edges leaving that parent
  const childrenMap = new Map<string, DelegationGraphEdge[]>();
  for (const edge of graph.edges) {
    const existing = childrenMap.get(edge.parentRunId) ?? [];
    existing.push(edge);
    childrenMap.set(edge.parentRunId, existing);
  }

  const hasChildren = graph.edges.length > 0;

  return (
    <div>
      {graph.truncated && (
        <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
          Graph truncated — some deep descendants not shown (limit: 6 levels)
        </div>
      )}

      {!hasChildren && (
        <p className="text-[13px] text-slate-400">No delegated runs yet.</p>
      )}

      {hasChildren && (
        <div className="text-[13px]">
          <TreeNode
            nodeId={graph.rootRunId}
            nodeMap={nodeMap}
            childrenMap={childrenMap}
            depth={0}
            onSelectRun={handleSelectRun}
          />
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          className="text-[12px] text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
          onClick={fetchGraph}
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
