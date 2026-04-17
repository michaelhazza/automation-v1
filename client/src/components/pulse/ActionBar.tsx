import type { PulseItem, PulseLane } from '../../hooks/usePulseAttention';

interface ActionBarProps {
  item: PulseItem;
  laneId: PulseLane;
  onApprove: (item: PulseItem) => void;
  onReject: (item: PulseItem) => void;
}

export function ActionBar({ item, laneId, onApprove, onReject }: ActionBarProps) {
  if (item.kind === 'task') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700">
          View task
        </button>
      </div>
    );
  }

  if (item.kind === 'failed_run') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button className="rounded bg-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
          View run
        </button>
        <button className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">
          Dismiss
        </button>
      </div>
    );
  }

  if (item.kind === 'health_finding') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">
          View finding
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        onClick={() => onApprove(item)}
        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
      >
        Approve
      </button>
      <button
        onClick={() => onReject(item)}
        className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
      >
        Reject
      </button>
      {laneId === 'major' && item.ackText && (
        <span className="text-xs text-amber-600">Requires acknowledgment</span>
      )}
    </div>
  );
}
