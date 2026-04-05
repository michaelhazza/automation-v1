import { useState, useEffect } from 'react';
import api from '../lib/api';

interface ChainRun {
  id: string;
  parentRunId: string | null;
  parentSpawnRunId: string | null;
  isSubAgent: boolean;
  handoffDepth: number;
  runSource: string;
  runType: string;
  status: string;
  agentName: string;
  subaccountName: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalToolCalls: number | null;
  errorMessage: string | null;
  errorDetail: Record<string, unknown> | null;
  costCents: number | null;
}

interface ChainResponse {
  runs: ChainRun[];
  metadata: {
    rootRunId: string;
    totalNodes: number;
    isComplete: boolean;
    truncated: boolean;
    truncationReason?: string;
  };
}

interface Props {
  runId: string;
  onSelectRun: (runId: string) => void;
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  completed: { icon: '✓', color: 'text-green-500' },
  failed: { icon: '✗', color: 'text-red-500' },
  running: { icon: '◐', color: 'text-blue-500 animate-pulse' },
  pending: { icon: '○', color: 'text-slate-400' },
  timeout: { icon: '✗', color: 'text-orange-500' },
  cancelled: { icon: '—', color: 'text-slate-400' },
  loop_detected: { icon: '⟳', color: 'text-amber-500' },
  budget_exceeded: { icon: '✗', color: 'text-red-400' },
};

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number | null): string {
  if (!tokens) return '—';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

function formatCost(cents: number | null): string {
  if (cents === null || cents === 0) return '';
  if (cents < 100) return `${cents}c`;
  return `$${(cents / 100).toFixed(2)}`;
}

const MAX_RENDER_DEPTH = 8;

function buildTree(runs: ChainRun[]): Map<string | null, ChainRun[]> {
  const tree = new Map<string | null, ChainRun[]>();
  for (const run of runs) {
    // Explicit precedence: handoff parent > spawn parent > root
    const parentKey =
      run.parentRunId !== null ? run.parentRunId
      : run.parentSpawnRunId !== null ? run.parentSpawnRunId
      : null;
    if (!tree.has(parentKey)) tree.set(parentKey, []);
    tree.get(parentKey)!.push(run);
  }
  return tree;
}

function TreeNode({
  run,
  tree,
  depth,
  selectedId,
  onSelect,
}: {
  run: ChainRun;
  tree: Map<string | null, ChainRun[]>;
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const status = STATUS_ICONS[run.status] ?? STATUS_ICONS.pending;
  const children = tree.get(run.id) ?? [];
  const isSelected = run.id === selectedId;
  const label = run.isSubAgent ? `Sub: ${run.agentName}` :
    run.runSource === 'handoff' ? `Handoff: ${run.agentName}` : run.agentName;

  return (
    <div>
      <button
        onClick={() => onSelect(run.id)}
        className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-start gap-2 hover:bg-slate-100 transition-colors ${
          isSelected ? 'bg-indigo-50 ring-1 ring-indigo-200' : ''
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <span className={`${status.color} font-mono text-xs mt-0.5 shrink-0`}>{status.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{label}</div>
          <div className="text-xs text-slate-500 flex gap-2">
            <span>{formatDuration(run.durationMs)}</span>
            <span>{formatTokens(run.totalTokens)}t</span>
            {run.costCents ? <span>{formatCost(run.costCents)}</span> : null}
          </div>
          {run.errorMessage && (
            <div className="text-xs text-red-500 truncate mt-0.5">{run.errorMessage}</div>
          )}
        </div>
      </button>
      {depth < MAX_RENDER_DEPTH ? (
        children.map(child => (
          <TreeNode key={child.id} run={child} tree={tree} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
        ))
      ) : children.length > 0 ? (
        <div className="text-xs text-slate-400 italic" style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}>
          +{children.length} more (depth limit)
        </div>
      ) : null}
    </div>
  );
}

export default function TraceChainSidebar({ runId, onSelectRun }: Props) {
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/agent-runs/${runId}/chain`)
      .then(res => { if (!cancelled) setChain(res.data); })
      .catch(() => { if (!cancelled) setChain(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  if (loading) {
    return (
      <div className="w-72 border-r border-slate-200 bg-white p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-24" />
          <div className="h-3 bg-slate-100 rounded w-full" />
          <div className="h-3 bg-slate-100 rounded w-3/4" />
        </div>
      </div>
    );
  }

  if (!chain || chain.runs.length <= 1) return null;

  const tree = buildTree(chain.runs);
  const rootRuns = tree.get(null) ?? [];
  const totalDuration = chain.runs.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const totalTokens = chain.runs.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
  const totalCost = chain.runs.reduce((sum, r) => sum + (r.costCents ?? 0), 0);

  if (collapsed) {
    return (
      <div className="w-10 border-r border-slate-200 bg-white flex flex-col items-center pt-3">
        <button onClick={() => setCollapsed(false)} className="text-slate-400 hover:text-slate-600" title="Expand trace chain">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 border-r border-slate-200 bg-white flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Trace Chain</span>
        <button onClick={() => setCollapsed(true)} className="text-slate-400 hover:text-slate-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">
        <span>{chain.metadata.totalNodes} runs</span>
        <span className="mx-1.5">·</span>
        <span>{formatDuration(totalDuration)}</span>
        <span className="mx-1.5">·</span>
        <span>{formatTokens(totalTokens)} tokens</span>
        {totalCost > 0 && <><span className="mx-1.5">·</span><span>{formatCost(totalCost)}</span></>}
        {!chain.metadata.isComplete && (
          <div className="mt-1 text-amber-600">
            Chain incomplete: {chain.metadata.truncationReason}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-0.5">
        {rootRuns.map(run => (
          <TreeNode key={run.id} run={run} tree={tree} depth={0} selectedId={runId} onSelect={onSelectRun} />
        ))}
      </div>
    </div>
  );
}
