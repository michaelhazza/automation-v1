/**
 * client/src/components/runtimeCheck/RuntimeCheckBadge.tsx
 *
 * Three-state operator badge for runtime check results.
 * Spec: tasks/builds/trust-verification-layer/spec.md §6.2, §14.
 *
 * Internally maps five RuntimeCheckState values to three visible states via
 * collapseToOperatorBadge (F6 invariant — the ONLY render-time projection).
 */

import type { RuntimeCheckState } from '../../../../shared/types/runtimeCheck';
import { collapseToOperatorBadge, formatBadgeTooltip } from '../../lib/runtimeCheckBadgePure';

interface RuntimeCheckBadgeProps {
  state: RuntimeCheckState;
  reasonText: string;
  suggestedFix: string | null;
  onClick?: () => void;
}

const DOT_CLASS: Record<string, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-red-500',
  pending: 'bg-slate-400',
};

const LABEL: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  pending: 'Pending',
};

export function RuntimeCheckBadge({ state, reasonText, suggestedFix, onClick }: RuntimeCheckBadgeProps) {
  const badge = collapseToOperatorBadge(state);
  const tooltip = formatBadgeTooltip({ state, reasonText, suggestedFix });

  const inner = (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-600" title={tooltip}>
      <span className={`size-1.5 rounded-full shrink-0 ${DOT_CLASS[badge]}`} />
      {LABEL[badge]}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        {inner}
      </button>
    );
  }

  return inner;
}
