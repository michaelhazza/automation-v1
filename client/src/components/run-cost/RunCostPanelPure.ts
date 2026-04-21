// ---------------------------------------------------------------------------
// RunCostPanel — pure logic module.
//
// Spec: tasks/hermes-audit-tier-1-spec.md §5.2, §5.3, §5.6 (Phase A).
//
// The `RunCostPanel.tsx` component delegates every branch decision and
// every user-facing string to the functions here so the behaviour can be
// pinned without a browser runtime. Matches the codebase convention
// established by `DeliveryChannelsPure.ts` (see that file's companion
// test). The spec's §9 framing deviation allowed for a React Testing
// Library test file; we substituted the codebase's established
// extract-pure pattern to avoid adding a net-new test dependency.
// Coverage of the §9.1 matrix (loading, error, zero-cost, compact single
// line, full table with mixed call-site, app-only, worker-only) is pinned
// by `RunCostPanel.test.ts` against the pure module.
// ---------------------------------------------------------------------------

import type { RunCostResponse } from '../../../../shared/types/runCost';

export type RunCostRenderMode =
  | { kind: 'inProgress' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'zero' }
  | { kind: 'data'; data: RunCostResponse };

export type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: RunCostResponse };

/**
 * Decide which branch the component should render given its props and
 * fetch state. Keeps the render-time branching JSX-agnostic so the full
 * §9.1 matrix is pinned by pure tests.
 */
export function selectRenderMode(
  runIsTerminal: boolean,
  state: FetchState,
): RunCostRenderMode {
  if (!runIsTerminal) return { kind: 'inProgress' };
  if (state.status === 'loading' || state.status === 'idle') return { kind: 'loading' };
  if (state.status === 'error') return { kind: 'error' };
  const { data } = state;
  const isZero = data.totalCostCents === 0 && data.llmCallCount === 0;
  if (isZero) return { kind: 'zero' };
  return { kind: 'data', data };
}

/**
 * Format a cost value (integer cents) per §5.2 total-cost rules:
 *   cost = 0              → "$0.00"
 *   0 < |cost| < $0.01    → two significant figures, e.g. "$0.00038"
 *   $0.01 ≤ |cost| < $1   → four decimal places,      e.g. "$0.4712"
 *   $1   ≤ |cost| < $1000 → two decimal places,       e.g. "$12.47"
 *   $1000 ≤ |cost|        → thousands separator, no decimals, e.g. "$12,345"
 */
export function formatCost(cents: number): string {
  if (cents === 0) return '$0.00';
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  if (abs < 0.01) {
    return `${sign}$${abs.toPrecision(2)}`;
  }
  if (abs < 1) {
    return `${sign}$${abs.toFixed(4)}`;
  }
  if (abs < 1000) {
    return `${sign}$${abs.toFixed(2)}`;
  }
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

/**
 * Format a token count per §5.2 call-count rules. Tokens get a `k` or `M`
 * suffix when ≥ 1,000 / 1,000,000 to keep the string compact. Single
 * decimal below 10k / 10M; integer above.
 */
export function formatTokens(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  const m = tokens / 1_000_000;
  return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/**
 * Compose the second-line summary shown under the total cost: call count
 * plus input/output token totals. Single source of truth for the string
 * template so tests can pin it at the character level.
 */
export function buildTokensLabel(data: RunCostResponse): string {
  const noun = data.llmCallCount === 1 ? 'call' : 'calls';
  return (
    `${data.llmCallCount} LLM ${noun} · ` +
    `${formatTokens(data.totalTokensIn)} tokens in / ${formatTokens(data.totalTokensOut)} tokens out`
  );
}
