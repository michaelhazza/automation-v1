// Shared helpers for operator-backend UI components.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §5.1, §13.2
// Mockups: r3 (completed), r4 (failed), r5 (cancelled), r14 (chain-link),
//          r15 (auto-extend/amber)

// ── Status-pill colour map ────────────────────────────────────────────────────
//
// Maps agent_runs.status values (operator-managed paths) to Tailwind colour
// class pairs. Matches the badge-colour logic in TaskHeader.tsx and the
// prototype CSS in r14-taskheader-chain-link-status.html.
//
// Non-operator statuses (running, paused, stopped) are handled by the
// existing TaskHeader badgeColor logic and are not duplicated here.

export type OperatorTaskStatus =
  | 'delegated'
  | 'paused_for_chain_continuation'
  | 'paused_chain_failure'
  | 'paused_budget_exceeded'
  | 'paused_wall_clock_exceeded'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StatusPillColour {
  bg: string;
  text: string;
}

export const OPERATOR_STATUS_PILL_COLOURS: Record<OperatorTaskStatus, StatusPillColour> = {
  delegated: { bg: 'bg-green-100', text: 'text-green-700' },
  paused_for_chain_continuation: { bg: 'bg-amber-100', text: 'text-amber-700' },
  paused_chain_failure: { bg: 'bg-amber-100', text: 'text-amber-700' },
  paused_budget_exceeded: { bg: 'bg-amber-100', text: 'text-amber-700' },
  paused_wall_clock_exceeded: { bg: 'bg-amber-100', text: 'text-amber-700' },
  completed: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  failed: { bg: 'bg-red-100', text: 'text-red-700' },
  cancelled: { bg: 'bg-slate-100', text: 'text-slate-500' },
};

export function getOperatorStatusPillColour(status: string): StatusPillColour {
  return (
    OPERATOR_STATUS_PILL_COLOURS[status as OperatorTaskStatus] ?? {
      bg: 'bg-slate-100',
      text: 'text-slate-500',
    }
  );
}

// ── Chain-link indicator text formatter ───────────────────────────────────────
//
// Produces the inline text shown next to the status badge in TaskHeader.
// Three variants (per mockup r14 and spec §3.9 item 9):
//
//   - Running, known estimate:  "link 3 of ~12"
//   - Running, unknown:         "link 3 of --"
//   - Terminal:                 "6 sessions, 12h 4m total"
//
// Pure function — no side effects; testable without a DOM.

export interface ChainLinkRunningParams {
  chainSeq: number;
  estimatedTotalLinks: number | null;
}

export interface ChainLinkTerminalParams {
  totalLinks: number;
  totalElapsedMs: number;
}

export function formatChainLinkRunning(params: ChainLinkRunningParams): string {
  const { chainSeq, estimatedTotalLinks } = params;
  if (estimatedTotalLinks === null) {
    return `link ${chainSeq} of —`;
  }
  return `link ${chainSeq} of ~${estimatedTotalLinks}`;
}

export function formatChainLinkTerminal(params: ChainLinkTerminalParams): string {
  const { totalLinks, totalElapsedMs } = params;
  const totalMinutes = Math.floor(totalElapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const sessionWord = totalLinks === 1 ? 'session' : 'sessions';
  const timePart =
    hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
  return `${totalLinks} ${sessionWord}, ${timePart} total`;
}
