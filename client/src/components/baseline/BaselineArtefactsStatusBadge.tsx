import type { ArtefactStatus } from '../../../../shared/constants/baselineArtefacts';

const STATUS_DOT: Record<ArtefactStatus, string> = {
  not_started: 'bg-slate-200',
  in_progress:  'bg-amber-400',
  completed:    'bg-emerald-500',
  skipped:      'bg-slate-400',
};

const STATUS_LABEL: Record<ArtefactStatus, string> = {
  not_started: 'Not started',
  in_progress:  'In progress',
  completed:    'Completed',
  skipped:      'Skipped',
};

export default function BaselineArtefactsStatusBadge({
  status,
  slug: _slug,
}: {
  status: ArtefactStatus;
  slug: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={STATUS_LABEL[status]}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
      <span className="text-[11px] text-slate-500">{STATUS_LABEL[status]}</span>
    </span>
  );
}
