// ---------------------------------------------------------------------------
// BaselineArtefactsStatusBadge — compact inline status dot for a baseline artefact.
// Spec: F1 §4B. Inline state indicator; not a dashboard.
// ---------------------------------------------------------------------------

export interface BaselineArtefactsStatusBadgeProps {
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  slug?: string;
}

const DOT_CLASSES: Record<string, string> = {
  completed:   'w-2.5 h-2.5 rounded-full bg-emerald-500',
  in_progress: 'w-2.5 h-2.5 rounded-full bg-amber-400',
  not_started: 'w-2.5 h-2.5 rounded-full bg-slate-300',
  skipped:     'w-2.5 h-2.5 rounded-full bg-slate-300 border border-dashed border-slate-400',
};

const STATUS_LABELS: Record<string, string> = {
  completed:   'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
  skipped:     'Skipped',
};

export default function BaselineArtefactsStatusBadge({
  status,
  slug,
}: BaselineArtefactsStatusBadgeProps) {
  const dotCls = DOT_CLASSES[status] ?? DOT_CLASSES.not_started;
  const label = STATUS_LABELS[status] ?? status;
  const title = slug ? `${slug}: ${label}` : label;

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={title}
      aria-label={label}
    >
      <span className={dotCls} />
      <span className="text-[12px] text-slate-500">{label}</span>
    </span>
  );
}
