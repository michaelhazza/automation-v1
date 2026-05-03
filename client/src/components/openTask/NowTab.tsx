/**
 * NowTab — agent org-chart view showing live delegation tree.
 *
 * Uses a simple HTML/CSS tree layout with SVG edges. No external charting
 * library. Status dots per agent: done (green), working (blue pulsing), idle (grey).
 *
 * Spec: docs/workflows-dev-spec.md §9.4.1.
 */

import type { AgentNode } from '../../hooks/useTaskProjectionPure.js';

interface AgentTreeData {
  rootAgentId: string | null;
  nodes: AgentNode[];
}

interface NowTabProps {
  agentTree: AgentTreeData;
}

const STATUS_DOT: Record<AgentNode['status'], string> = {
  working: 'bg-blue-400 [animation:pulse_1.5s_ease-in-out_infinite]',
  done:    'bg-emerald-400',
  idle:    'bg-slate-500',
};

const STATUS_LABEL: Record<AgentNode['status'], string> = {
  working: 'working',
  done:    'done',
  idle:    'idle',
};

function AgentNodeCard({ node }: { node: AgentNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 min-w-[140px] max-w-[200px]">
      <span
        className={`shrink-0 w-2.5 h-2.5 rounded-full ${STATUS_DOT[node.status]}`}
        title={STATUS_LABEL[node.status]}
      />
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-slate-200 truncate" title={node.agentId}>
          {node.agentId.slice(0, 8)}
        </p>
        <p className="text-[10px] text-slate-500">{STATUS_LABEL[node.status]}</p>
      </div>
    </div>
  );
}

/**
 * Recursively render a subtree rooted at agentId.
 */
function AgentSubtree({ agentId, nodeMap, childMap, depth }: {
  agentId: string;
  nodeMap: Map<string, AgentNode>;
  childMap: Map<string, string[]>;
  depth: number;
}) {
  const node = nodeMap.get(agentId);
  const children = childMap.get(agentId) ?? [];

  return (
    <div className="flex flex-col items-center gap-2">
      {node && <AgentNodeCard node={node} />}

      {children.length > 0 && (
        <div className="flex flex-col items-center gap-0.5">
          {/* Vertical connector */}
          <div className="w-px h-4 bg-slate-600" />
          <div className="flex gap-4 items-start">
            {children.map((childId) => (
              <div key={childId} className="flex flex-col items-center">
                <AgentSubtree
                  agentId={childId}
                  nodeMap={nodeMap}
                  childMap={childMap}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NowTab({ agentTree }: NowTabProps) {
  const { rootAgentId, nodes } = agentTree;

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <p className="text-[13px] text-slate-500 italic">No agents active yet.</p>
      </div>
    );
  }

  const nodeMap = new Map(nodes.map((n) => [n.agentId, n]));

  // Build parent-to-children map
  const childMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentAgentId) {
      const existing = childMap.get(node.parentAgentId) ?? [];
      childMap.set(node.parentAgentId, [...existing, node.agentId]);
    }
  }

  // Root: either the designated rootAgentId or the first node without a parent
  const effectiveRoot = rootAgentId
    ?? nodes.find((n) => !n.parentAgentId)?.agentId
    ?? nodes[0]?.agentId;

  // Nodes not reachable from root (orphans due to partial state) rendered separately
  const reachable = new Set<string>();
  function markReachable(id: string) {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const child of childMap.get(id) ?? []) markReachable(child);
  }
  if (effectiveRoot) markReachable(effectiveRoot);
  const orphans = nodes.filter((n) => !reachable.has(n.agentId));

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-6">
      {effectiveRoot && (
        <div className="flex justify-center">
          <AgentSubtree
            agentId={effectiveRoot}
            nodeMap={nodeMap}
            childMap={childMap}
            depth={0}
          />
        </div>
      )}

      {orphans.length > 0 && (
        <div className="border-t border-slate-700/40 pt-4">
          <p className="text-[11px] text-slate-600 mb-2">Other agents</p>
          <div className="flex flex-wrap gap-2">
            {orphans.map((n) => (
              <AgentNodeCard key={n.agentId} node={n} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
