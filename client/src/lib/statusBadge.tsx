/**
 * statusBadge.tsx — Brain Tree OS adoption P3.
 *
 * Shared status badge component and colour map for agent run status display.
 * Hoisted from RunTraceViewerPage so SessionLogCardList and other consumers
 * use the same source of truth.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P3
 */

export const STATUS_BADGE_STYLES: Record<string, string> = {
  completed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:          'bg-red-50 text-red-700 border-red-200',
  running:         'bg-blue-50 text-blue-700 border-blue-200',
  // IEE delegated — waiting on a worker-side run to complete.
  delegated:       'bg-indigo-50 text-indigo-700 border-indigo-200',
  pending:         'bg-slate-100 text-slate-600 border-slate-200',
  timeout:         'bg-amber-50 text-amber-700 border-amber-200',
  cancelled:       'bg-slate-100 text-slate-400 border-slate-200',
  loop_detected:   'bg-amber-100 text-amber-800 border-amber-200',
  budget_exceeded: 'bg-amber-100 text-amber-800 border-amber-200',
  awaiting_clarification: 'bg-violet-50 text-violet-700 border-violet-200',
  // Orchestrator capability-aware routing (spec §8.3)
  routed:                      'bg-sky-50 text-sky-700 border-sky-200',
  awaiting_configuration:      'bg-violet-50 text-violet-700 border-violet-200',
  blocked_on_feature_request:  'bg-amber-50 text-amber-700 border-amber-200',
  routing_failed:              'bg-red-50 text-red-700 border-red-200',
  routing_timeout:             'bg-amber-50 text-amber-700 border-amber-200',
  configuration_partial:       'bg-amber-50 text-amber-700 border-amber-200',
  configuration_failed:        'bg-red-50 text-red-700 border-red-200',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE_STYLES[status] ?? STATUS_BADGE_STYLES.pending;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
