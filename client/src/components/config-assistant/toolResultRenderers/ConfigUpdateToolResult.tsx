import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Dual-path UX renderer for config_update_organisation_config tool results
// (spec §6.3). The service returns one of three shapes; this component
// branches on them to show distinct operator-facing copy.
// ---------------------------------------------------------------------------

type AppliedInline = {
  kind: 'applied_inline';
  path: string;
  configHistoryVersion: number;
  orgId: string | null;
};

type QueuedForReview = {
  kind: 'queued_for_review';
  path: string;
  actionId: string;
};

type ErrorResult = {
  kind: 'error';
  message: string;
  errorCode: string | null;
};

type ParsedConfigUpdateResult =
  | AppliedInline
  | QueuedForReview
  | ErrorResult
  | { kind: 'unknown' };

export function parseConfigUpdateToolResult(result: unknown): ParsedConfigUpdateResult {
  if (typeof result !== 'object' || result === null) return { kind: 'unknown' };
  const r = result as Record<string, unknown>;

  if (r.committed === true) {
    const path = typeof r.path === 'string' ? r.path : '';
    const configHistoryVersion = typeof r.configHistoryVersion === 'number' ? r.configHistoryVersion : 0;
    const orgId = typeof r.organisationId === 'string' ? r.organisationId : null;
    return { kind: 'applied_inline', path, configHistoryVersion, orgId };
  }

  if (r.committed === false && r.requiresApproval === true) {
    return {
      kind: 'queued_for_review',
      path: typeof r.path === 'string' ? r.path : '',
      actionId: typeof r.actionId === 'string' ? r.actionId : '',
    };
  }

  if (r.committed === false && typeof r.errorCode === 'string') {
    return {
      kind: 'error',
      message: typeof r.message === 'string' ? r.message : 'Configuration change rejected',
      errorCode: r.errorCode,
    };
  }

  return { kind: 'unknown' };
}

export default function ConfigUpdateToolResult({ result }: { result: unknown }) {
  const parsed = parseConfigUpdateToolResult(result);

  switch (parsed.kind) {
    case 'applied_inline':
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 my-2">
          <div className="font-semibold text-emerald-800 text-[13px]">Applied.</div>
          <div className="text-[12px] text-emerald-700 mt-1">
            <span className="font-mono">{parsed.path}</span> is now live and recorded as <span className="font-mono">config_history</span> version <strong>{parsed.configHistoryVersion}</strong>.
          </div>
          {parsed.orgId && (
            <Link
              to={`/admin/config-history?entityType=organisation_operational_config&entityId=${parsed.orgId}`}
              className="inline-block mt-2 text-[12px] font-semibold text-emerald-700 hover:underline"
            >
              View history →
            </Link>
          )}
        </div>
      );
    case 'queued_for_review':
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 my-2">
          <div className="font-semibold text-amber-800 text-[13px]">Sent to review queue.</div>
          <div className="text-[12px] text-amber-700 mt-1">
            This is a sensitive change — <span className="font-mono">{parsed.path}</span> requires operator approval before it takes effect. Your proposal is queued as action <span className="font-mono">{parsed.actionId.slice(0, 8)}</span>. Approve it from the review queue to apply.
          </div>
          <Link
            to={`/admin/review-queue?focus=${parsed.actionId}`}
            className="inline-block mt-2 text-[12px] font-semibold text-amber-700 hover:underline"
          >
            Open review queue →
          </Link>
        </div>
      );
    case 'error':
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 my-2">
          <div className="font-semibold text-red-800 text-[13px]">Couldn't apply this change.</div>
          <div className="text-[12px] text-red-700 mt-1">{parsed.message}</div>
          {parsed.errorCode && <div className="text-[11px] text-red-500 mt-1 font-mono">{parsed.errorCode}</div>}
        </div>
      );
    case 'unknown':
      // Defence-in-depth fallback per spec §6.7 res 1 — render raw JSON rather
      // than a blank card when the shape drifts. Logged so we catch shape drift.
      // eslint-disable-next-line no-console
      console.warn('[ConfigUpdateToolResult] unrecognised tool-result shape', result);
      return (
        <pre className="bg-slate-100 rounded p-2 text-[11px] text-slate-600 font-mono overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}
