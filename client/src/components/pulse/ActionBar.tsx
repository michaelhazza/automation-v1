import type { PulseItem, PulseLane } from '../../hooks/usePulseAttention';

interface ActionBarProps {
  item: PulseItem;
  laneId: PulseLane;
  onApprove: (item: PulseItem) => void;
  onReject: (item: PulseItem) => void;
  pending?: boolean;
}

export function ActionBar({ item, laneId, onApprove, onReject, pending }: ActionBarProps) {
  if (item.kind === 'task') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-xs btn-primary">
          View task
        </button>
      </div>
    );
  }

  if (item.kind === 'failed_run') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-xs bg-slate-600 text-white hover:bg-slate-700">
          View run
        </button>
        <button className="btn btn-xs btn-ghost">
          Dismiss
        </button>
      </div>
    );
  }

  if (item.kind === 'health_finding') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-xs btn-ghost">
          View finding
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        onClick={() => onApprove(item)}
        disabled={pending}
        className="btn btn-xs btn-success disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Processing…' : 'Approve'}
      </button>
      <button
        onClick={() => onReject(item)}
        disabled={pending}
        className="btn btn-xs text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Reject
      </button>
      {laneId === 'major' && item.ackText && (
        <span className="text-xs text-amber-600">Requires acknowledgment</span>
      )}
    </div>
  );
}
