// client/src/components/run-trace/RunTraceHeadline.tsx
// One-line headline badge row above the run trace tree view (spec §5.1.1–§5.1.5).
// Shows: [controller label] [approval status] [duration] [cost]
// No "Details" link in Phase 1 (§5.1.4). No em-dashes.

import type { ControllerStyle } from '../../../../shared/types/controllerStyle.js';
import { formatControllerLabel, formatDuration, formatCost } from '../../lib/runTraceFormatters.js';

export interface RunTraceHeadlineProps {
  controllerStyle: ControllerStyle;
  /** Result of formatApprovalStatus — null hides the approval badge. */
  approvalStatus: string | null;
  durationMs: number | null;
  costCents: number | null;
}

// Badge colors by semantic meaning.
const BADGE_BASE = 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium';
const BADGE_NEUTRAL = `${BADGE_BASE} bg-slate-100 text-slate-600`;
const BADGE_GREEN = `${BADGE_BASE} bg-emerald-50 text-emerald-700`;
const BADGE_AMBER = `${BADGE_BASE} bg-amber-50 text-amber-700`;
const BADGE_RED = `${BADGE_BASE} bg-red-50 text-red-700`;
const BADGE_SLATE = `${BADGE_BASE} bg-slate-50 text-slate-500`;

function approvalBadgeClass(status: string): string {
  if (status === 'auto-approved' || status.startsWith('approved by')) return BADGE_GREEN;
  if (status === 'awaiting approval') return BADGE_AMBER;
  if (status === 'blocked by policy' || status === 'failed' || status === 'failed before execution') {
    return BADGE_RED;
  }
  return BADGE_NEUTRAL;
}

export function RunTraceHeadline({
  controllerStyle,
  approvalStatus,
  durationMs,
  costCents,
}: RunTraceHeadlineProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      {/* Controller style badge — always shown */}
      <span className={BADGE_NEUTRAL}>
        {formatControllerLabel(controllerStyle)}
      </span>

      {/* Approval status badge — hidden for silent native-run case (approvalStatus === null) */}
      {approvalStatus !== null && (
        <span className={approvalBadgeClass(approvalStatus)}>
          {approvalStatus}
        </span>
      )}

      {/* Duration badge */}
      {durationMs !== null && durationMs >= 0 && (
        <span className={BADGE_SLATE}>
          {formatDuration(durationMs)}
        </span>
      )}

      {/* Cost badge */}
      {costCents !== null && costCents >= 0 && (
        <span className={BADGE_SLATE}>
          {formatCost(costCents)}
        </span>
      )}
    </div>
  );
}
