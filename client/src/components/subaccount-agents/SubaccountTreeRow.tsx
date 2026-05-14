import { useState } from 'react';
import { RoleBadge } from './RoleBadge';
import { StatusBadge } from './StatusBadge';

export interface TreeNode {
  id: string;
  agentId: string;
  parentSubaccountAgentId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  isActive: boolean;
  agent: { name: string; slug: string; status: string; isDraft?: boolean; requiresPrompt?: boolean };
  children: TreeNode[];
}

export function SubaccountTreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <tr className="hover:bg-slate-50 transition-colors">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-5 h-5 flex items-center justify-center bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-700 text-[12px] transition-transform"
                style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                &#9654;
              </button>
            ) : <span className="w-5" />}
            <span className="font-semibold text-slate-800 text-[14px]">{node.agent.name}</span>
            {node.agent.requiresPrompt && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                Requires prompt
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5"><RoleBadge role={node.agentRole} /></td>
        <td className="px-4 py-2.5 text-[13px] text-slate-600">{node.agentTitle || '—'}</td>
        <td className="px-4 py-2.5"><StatusBadge status={node.agent.status} /></td>
        <td className="px-4 py-2.5">
          <span className={`inline-block w-2 h-2 rounded-full ${node.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
        </td>
      </tr>
      {expanded && hasChildren && node.children.map((child) => (
        <SubaccountTreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
