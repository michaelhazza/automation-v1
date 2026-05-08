/**
 * client/src/components/runtimeCheck/RuntimeCheckSummaryStrip.tsx
 *
 * Aggregate per-run runtime-check counts shown at the top of the Run-trace page.
 * Spec: tasks/builds/trust-verification-layer/spec.md §14.
 *
 * Only renders when at least one count is > 0.
 * "Fail" count links to Inbox (scoped by runId) only when the viewer holds
 * subaccount.review.view / org.review.view (passed as canViewInbox).
 */

interface RuntimeCheckSummaryStripProps {
  passCount: number;
  failCount: number;
  pendingCount: number;
  runId: string;
  canViewInbox: boolean;
}

export function RuntimeCheckSummaryStrip({
  passCount,
  failCount,
  pendingCount,
  runId,
  canViewInbox,
}: RuntimeCheckSummaryStripProps) {
  const total = passCount + failCount + pendingCount;
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] text-slate-600 mb-3">
      <span className="font-medium text-slate-500">Checks:</span>

      <span className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
        <span>Pass: {passCount}</span>
      </span>

      <span className="text-slate-300">|</span>

      {failCount > 0 && canViewInbox ? (
        <a
          href={`/inbox?runId=${encodeURIComponent(runId)}`}
          className="inline-flex items-center gap-1 text-red-600 hover:underline"
        >
          <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
          <span>Fail: {failCount}</span>
        </a>
      ) : (
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
          <span>Fail: {failCount}</span>
        </span>
      )}

      <span className="text-slate-300">|</span>

      <span className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-slate-400 shrink-0" />
        <span>Pending: {pendingCount}</span>
      </span>
    </div>
  );
}
