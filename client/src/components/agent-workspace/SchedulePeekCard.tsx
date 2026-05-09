interface Props {
  schedulePeek: {
    nextRunAt: string | null;
    trigger: string | null;
    label: string | null;
  } | null;
}

function formatNextRun(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'in less than a minute';
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `in ${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SchedulePeekCard({ schedulePeek }: Props) {
  const hasSchedule = schedulePeek !== null && schedulePeek.nextRunAt !== null;

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Schedule</h4>
      {!hasSchedule ? (
        <p className="text-xs text-slate-400 text-center py-4">No schedule configured.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-slate-700">
            <span className="font-medium">Next run:</span>{' '}
            {formatNextRun(schedulePeek!.nextRunAt!)}
          </p>
          {schedulePeek!.trigger && (
            <p className="text-xs text-slate-500">
              <span className="font-medium">Trigger:</span>{' '}
              {schedulePeek!.label ?? schedulePeek!.trigger}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
