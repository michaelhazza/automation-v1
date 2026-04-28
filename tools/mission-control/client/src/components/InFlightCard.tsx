import type { CiStatus, InFlightItem, Phase } from '../lib/api.js';

const PHASE_COLOR: Record<Phase, string> = {
  PLANNING: 'bg-amber-900/40 text-amber-200 border-amber-700/50',
  BUILDING: 'bg-blue-900/40 text-blue-200 border-blue-700/50',
  REVIEWING: 'bg-purple-900/40 text-purple-200 border-purple-700/50',
  MERGE_READY: 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50',
  MERGED: 'bg-slate-800/40 text-slate-300 border-slate-700/50',
  NONE: 'bg-slate-800/40 text-slate-400 border-slate-700/50',
};

const CI_DOT: Record<CiStatus, string> = {
  passing: 'bg-emerald-500',
  failing: 'bg-red-500',
  pending: 'bg-amber-500 animate-pulse',
  unknown: 'bg-slate-600',
};

const VERDICT_COLOR: Record<string, string> = {
  APPROVED: 'text-emerald-300',
  CONFORMANT: 'text-emerald-300',
  CONFORMANT_AFTER_FIXES: 'text-emerald-300',
  PASS: 'text-emerald-300',
  PASS_WITH_DEFERRED: 'text-emerald-200',
  READY_FOR_BUILD: 'text-emerald-300',

  CHANGES_REQUESTED: 'text-amber-300',
  NEEDS_DISCUSSION: 'text-amber-300',
  NEEDS_REVISION: 'text-amber-300',

  NON_CONFORMANT: 'text-red-300',
  FAIL: 'text-red-300',
};

function VerdictPill({ verdict }: { verdict: string | null }) {
  if (!verdict) {
    return <span className="text-slate-500 text-xs">in progress</span>;
  }
  const cls = VERDICT_COLOR[verdict] ?? 'text-slate-300';
  return <span className={`text-xs font-mono ${cls}`}>{verdict}</span>;
}

function CiBadge({ status }: { status: CiStatus }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
      <span className={`inline-block w-2 h-2 rounded-full ${CI_DOT[status]}`} />
      ci: {status}
    </span>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function InFlightCard({ item }: { item: InFlightItem }) {
  const phasePill = (
    <span
      className={`inline-block text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border ${PHASE_COLOR[item.phase]}`}
    >
      {item.phase.replace(/_/g, ' ')}
    </span>
  );

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-slate-100 truncate">
              {item.build_slug}
            </h2>
            {phasePill}
          </div>
          {item.branch && (
            <p className="mt-1 text-xs text-slate-500 font-mono truncate">
              {item.branch}
            </p>
          )}
        </div>
        {item.pr && (
          <a
            href={item.pr.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-sm text-slate-300 hover:text-white"
          >
            PR #{item.pr.number}
            <span className="ml-1 text-xs text-slate-500">({item.pr.state})</span>
          </a>
        )}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs">
        {item.pr && <CiBadge status={item.pr.ci_status} />}
        {item.latest_review ? (
          <span className="text-slate-400">
            <span className="text-slate-500">{item.latest_review.kind}:</span>{' '}
            <VerdictPill verdict={item.latest_review.verdict} />
            <span className="ml-2 text-slate-600">
              {timeAgo(item.latest_review.timestamp)}
            </span>
          </span>
        ) : (
          <span className="text-slate-500 text-xs">no reviews yet</span>
        )}
      </div>

      {item.progress && item.progress.total_chunks !== null && (
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
          <span>
            {item.progress.completed_chunks ?? 0} / {item.progress.total_chunks} chunks
          </span>
          {item.progress.last_updated && (
            <span className="text-slate-600">updated {item.progress.last_updated}</span>
          )}
        </div>
      )}
    </div>
  );
}
