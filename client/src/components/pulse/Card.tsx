import { useState } from 'react';
import type { PulseItem, PulseLane } from '../../hooks/usePulseAttention';
import { ActionBar } from './ActionBar';

interface CardProps {
  item: PulseItem;
  laneId: PulseLane;
  onApprove: (item: PulseItem) => void;
  onReject: (item: PulseItem) => void;
}

export function Card({ item, laneId, onApprove, onReject }: CardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KindBadge kind={item.kind} />
            <h4 className="text-sm font-medium text-slate-800 truncate">{item.title}</h4>
          </div>
          {item.reasoning && (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">{item.reasoning}</p>
          )}
          <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
            {item.subaccountName && <span>{item.subaccountName}</span>}
            {item.agentName && <span>· {item.agentName}</span>}
            {item.costSummary && <span>· {item.costSummary}</span>}
            <span>· {formatRelativeTime(item.createdAt)}</span>
          </div>
        </div>
        {item.evidence && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-indigo-500 hover:text-indigo-700 whitespace-nowrap"
          >
            {expanded ? 'Hide evidence' : 'Show evidence'}
          </button>
        )}
      </div>
      {expanded && item.evidence && (
        <div className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-600 overflow-auto max-h-48">
          <pre className="whitespace-pre-wrap">{JSON.stringify(item.evidence, null, 2)}</pre>
        </div>
      )}
      <ActionBar item={item} laneId={laneId} onApprove={onApprove} onReject={onReject} />
    </div>
  );
}

function KindBadge({ kind }: { kind: PulseItem['kind'] }) {
  const styles: Record<string, string> = {
    review: 'bg-indigo-100 text-indigo-700',
    task: 'bg-green-100 text-green-700',
    failed_run: 'bg-red-100 text-red-700',
    health_finding: 'bg-yellow-100 text-yellow-700',
  };
  const labels: Record<string, string> = {
    review: 'Review',
    task: 'Task',
    failed_run: 'Failed Run',
    health_finding: 'Health',
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[kind] || 'bg-slate-100 text-slate-600'}`}>
      {labels[kind] || kind}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
