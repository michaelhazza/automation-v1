import { useState } from 'react';

const ROLE_CLS: Record<string, string> = {
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

export interface TemplateSlotNode {
  id: string;
  blueprintSlug: string;
  blueprintName: string | null;
  blueprintRole: string | null;
  blueprintTitle: string | null;
  systemAgentId: string | null;
  children?: TemplateSlotNode[];
}

export function TemplateSlotRow({ slot, depth }: { slot: TemplateSlotNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const children = slot.children ?? [];
  const hasChildren = children.length > 0;

  return (
    <>
      <tr className="hover:bg-slate-50 transition-colors">
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-4 h-4 flex items-center justify-center bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-700 text-[11px] transition-transform"
                style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                &#9654;
              </button>
            ) : <span className="w-4" />}
            <span className="font-medium text-slate-800 text-[13px]">
              {slot.blueprintName || slot.blueprintSlug}
            </span>
            {slot.systemAgentId && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">System</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2">
          {slot.blueprintRole && (
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${ROLE_CLS[slot.blueprintRole] ?? 'bg-slate-100 text-slate-600'}`}>
              {slot.blueprintRole}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-[12px] text-slate-500">
          {slot.blueprintTitle || '—'}
        </td>
      </tr>
      {expanded && children.map((child) => (
        <TemplateSlotRow key={child.id} slot={child} depth={depth + 1} />
      ))}
    </>
  );
}
