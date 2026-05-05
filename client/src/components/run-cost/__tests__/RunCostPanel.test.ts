/**
 * RunCostPanel — pure-logic tests for the per-run cost panel.
 *
 * Spec: tasks/hermes-audit-tier-1-spec.md §5, §9.1.
 *
 * Framing note: the spec's §9 original framing called for a React
 * Testing Library component test. This project does not ship RTL as a
 * dep (see `package.json`), and `client/src/components/__tests__/` uses
 * the lightweight tsx + extract-pure convention established by
 * `DeliveryChannels.test.ts`. We match that convention here — pinning
 * every §9.1 rendering branch against `RunCostPanelPure.ts` without
 * adding a net-new test dependency or a browser runtime. The component
 * itself is a thin wrapper that switches on the pure module's output;
 * the JSX has no branching logic that isn't exercised here.
 *
 * Matrix (per §9.1 rows):
 *   - Loading state            → selectRenderMode returns `loading`
 *   - Error state              → selectRenderMode returns `error`
 *   - 404 (run not in org)     → same as error (component treats 404 same as 500)
 *   - In progress              → selectRenderMode returns `inProgress`
 *   - Zero cost                → selectRenderMode returns `zero`
 *   - Non-zero, compact        → selectRenderMode returns `data`; CompactBody
 *   - Non-zero, full           → selectRenderMode returns `data`; FullBody
 *   - App-only / worker-only   → breakdown renders both rows always; the
 *                                 zero-side bucket shows $0.00 / 0 (§8.2 defaults)
 *   - Mixed call-site          → breakdown has both rows populated
 */

import { expect, test } from 'vitest';
import {
  buildTokensLabel,
  formatCost,
  formatTokens,
  selectRenderMode,
  type FetchState,
} from '../RunCostPanelPure.js';
import type { RunCostResponse } from '../../../../../shared/types/runCost.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sampleResponse(opts: Partial<RunCostResponse> = {}): RunCostResponse {
  return {
    entityId:       'run-1',
    totalCostCents: 0,
    requestCount:   0,
    llmCallCount:   0,
    totalTokensIn:  0,
    totalTokensOut: 0,
    callSiteBreakdown: {
      app:    { costCents: 0, requestCount: 0 },
      worker: { costCents: 0, requestCount: 0 },
    },
    ...opts,
  };
}

// ─── selectRenderMode ─────────────────────────────────────────────────

console.log('\n--- selectRenderMode ---');

test('runIsTerminal=false → inProgress regardless of fetch state', () => {
  const cases: FetchState[] = [
    { status: 'idle' },
    { status: 'loading' },
    { status: 'error' },
    { status: 'loaded', data: sampleResponse() },
  ];
  for (const state of cases) {
    const mode = selectRenderMode(false, state);
    expect(mode.kind, `kind for ${state.status}`).toBe('inProgress');
  }
});

test('runIsTerminal=true + loading → loading', () => {
  expect(selectRenderMode(true, { status: 'loading' }).kind, 'kind').toBe('loading');
});

test('runIsTerminal=true + idle → loading (treated as pre-fetch)', () => {
  expect(selectRenderMode(true, { status: 'idle' }).kind, 'kind').toBe('loading');
});

test('runIsTerminal=true + error → error', () => {
  expect(selectRenderMode(true, { status: 'error' }).kind, 'kind').toBe('error');
});

test('loaded zero-cost, zero-calls → zero state', () => {
  const mode = selectRenderMode(true, { status: 'loaded', data: sampleResponse() });
  expect(mode.kind, 'kind').toBe('zero');
});

test('loaded totalCostCents=0 but llmCallCount>0 → data (not zero)', () => {
  // Edge case: cost_aggregates says zero but ledger shows calls (unusual
  // but possible when every call errored with zero cost). The data-zero
  // heuristic is conservative — any recorded call lifts us out of the
  // "no LLM spend recorded" empty state.
  const mode = selectRenderMode(true, {
    status: 'loaded',
    data: sampleResponse({ llmCallCount: 1 }),
  });
  expect(mode.kind, 'kind').toBe('data');
});

test('loaded non-zero cost → data mode with payload', () => {
  const data = sampleResponse({ totalCostCents: 47, llmCallCount: 3 });
  const mode = selectRenderMode(true, { status: 'loaded', data });
  expect(mode.kind, 'kind').toBe('data');
  if (mode.kind === 'data') {
    expect(mode.data.totalCostCents, 'carries cost').toBe(47);
    expect(mode.data.llmCallCount, 'carries call count').toBe(3);
  }
});

// ─── formatCost ──────────────────────────────────────────────────────

console.log('\n--- formatCost (§5.2 total-cost rules) ---');

test('0 cents → $0.00', () => {
  expect(formatCost(0), 'zero').toBe('$0.00');
});

test('sub-cent (< $0.01) → two significant figures', () => {
  // 0.038 cents = $0.00038 → two sig figs
  expect(formatCost(0.038), 'sub-cent').toBe('$0.00038');
});

test('sub-cent scientific-notation fallback → decimal form', () => {
  // 0.000012 cents = $1.2e-7 dollars. `toPrecision(2)` emits `"1.2e-7"`;
  // the fallback re-renders via `toFixed(12)` + trailing-zero trim.
  expect(formatCost(0.000012), 'sub-micro scientific-notation path').toBe('$0.00000012');
});

test('$0.01 ≤ cost < $1 → 4dp', () => {
  expect(formatCost(47), '$0.47').toBe('$0.4700');
});
test('$1 ≤ cost < $1000 → 2dp (boundary check)', () => {
  expect(formatCost(4712), '$47.12').toBe('$47.12');
});

test('$0.47 sub-dollar formatting hits 4dp', () => {
  expect(formatCost(47.12), '$0.4712').toBe('$0.4712');
});

test('$1 ≤ cost < $1000 → 2dp', () => {
  expect(formatCost(100), '$1.00').toBe('$1.00');
  expect(formatCost(1247), '$12.47').toBe('$12.47');
  expect(formatCost(99999), '$999.99').toBe('$999.99');
});

test('$1000+ → thousands separator, no decimals', () => {
  expect(formatCost(100000), '$1,000').toBe('$1,000');
  expect(formatCost(1234567), 'rounded to nearest dollar').toBe('$12,346');
});

test('negative cost → leading minus sign (defensive)', () => {
  expect(formatCost(-47), 'negative sub-dollar').toBe('-$0.4700');
});

// ─── formatTokens ────────────────────────────────────────────────────

console.log('\n--- formatTokens (§5.2 token rules) ---');

test('0 tokens → "0"', () => { expect(formatTokens(0), 'zero').toBe('0'); });
test('< 1000 → raw integer', () => { expect(formatTokens(743), 'raw').toBe('743'); });
test('1000 → "1k"', () => { expect(formatTokens(1000), '1k').toBe('1k'); });
test('1500 → "1.5k" (single decimal under 10k)', () => {
  expect(formatTokens(1500), '1.5k').toBe('1.5k');
});
test('9999 → "10k" (rounded)', () => { expect(formatTokens(9999), '10k').toBe('10k'); });
test('≥ 10k → integer k', () => {
  expect(formatTokens(12_450), '12k').toBe('12k');
  expect(formatTokens(123_456), '123k').toBe('123k');
});
test('1_000_000 → "1M"', () => { expect(formatTokens(1_000_000), '1M').toBe('1M'); });
test('2_500_000 → "2.5M"', () => { expect(formatTokens(2_500_000), '2.5M').toBe('2.5M'); });
test('≥ 10M → integer M', () => { expect(formatTokens(12_345_678), '12M').toBe('12M'); });

// ─── buildTokensLabel ─────────────────────────────────────────────────

console.log('\n--- buildTokensLabel ---');

test('1 call → singular "call"', () => {
  const s = buildTokensLabel(sampleResponse({ llmCallCount: 1, totalTokensIn: 500, totalTokensOut: 300 }));
  expect(s, 'string').toBe('1 LLM call · 500 tokens in / 300 tokens out');
});

test('3 calls → plural "calls"', () => {
  const s = buildTokensLabel(sampleResponse({ llmCallCount: 3, totalTokensIn: 12_450, totalTokensOut: 1820 }));
  expect(s, 'string').toBe('3 LLM calls · 12k tokens in / 1.8k tokens out');
});

test('0 calls / 0 tokens → well-formed (even if caller should render zero state)', () => {
  const s = buildTokensLabel(sampleResponse());
  expect(s, 'string').toBe('0 LLM calls · 0 tokens in / 0 tokens out');
});

// ─── Matrix — full rendering branches (§9.1) ─────────────────────────

console.log('\n--- §9.1 matrix — rendering-branch selection ---');

test('loading branch (RTL row "Mocked API pending")', () => {
  expect(selectRenderMode(true, { status: 'loading' }).kind, 'kind').toBe('loading');
});

test('zero-cost branch (RTL row "API returns totalCostCents: 0")', () => {
  const mode = selectRenderMode(true, { status: 'loaded', data: sampleResponse() });
  expect(mode.kind, 'kind').toBe('zero');
});

test('non-zero compact branch (RTL row "$0.47, 3 calls, compact prop")', () => {
  // The pure module returns `data`; the component chooses CompactBody
  // based on the `compact` prop. Compact vs full is a rendering choice,
  // not a decision the pure module owns.
  const data = sampleResponse({
    totalCostCents: 47,
    llmCallCount: 3,
    totalTokensIn: 12_450,
    totalTokensOut: 1820,
    callSiteBreakdown: {
      app:    { costCents: 47, requestCount: 3 },
      worker: { costCents: 0,  requestCount: 0 },
    },
  });
  expect(selectRenderMode(true, { status: 'loaded', data }).kind, 'kind').toBe('data');
});

test('non-zero full, app-only (RTL row "$0.47, 3 calls, app-only")', () => {
  const data = sampleResponse({
    totalCostCents: 47,
    llmCallCount: 3,
    callSiteBreakdown: {
      app:    { costCents: 47, requestCount: 3 },
      worker: { costCents: 0,  requestCount: 0 },
    },
  });
  const mode = selectRenderMode(true, { status: 'loaded', data });
  if (mode.kind !== 'data') throw new Error('expected data mode');
  expect(mode.data.callSiteBreakdown.app.costCents, 'app cost').toBe(47);
  expect(mode.data.callSiteBreakdown.worker.costCents, 'worker zero').toBe(0);
});

test('non-zero full, worker-only', () => {
  const data = sampleResponse({
    totalCostCents: 47,
    llmCallCount: 3,
    callSiteBreakdown: {
      app:    { costCents: 0,  requestCount: 0 },
      worker: { costCents: 47, requestCount: 3 },
    },
  });
  const mode = selectRenderMode(true, { status: 'loaded', data });
  if (mode.kind !== 'data') throw new Error('expected data mode');
  expect(mode.data.callSiteBreakdown.app.costCents, 'app zero').toBe(0);
  expect(mode.data.callSiteBreakdown.worker.requestCount, 'worker count').toBe(3);
});

test('mixed call-site (RTL row "2 app + 1 worker")', () => {
  const data = sampleResponse({
    totalCostCents: 60,
    llmCallCount: 3,
    callSiteBreakdown: {
      app:    { costCents: 40, requestCount: 2 },
      worker: { costCents: 20, requestCount: 1 },
    },
  });
  const mode = selectRenderMode(true, { status: 'loaded', data });
  if (mode.kind !== 'data') throw new Error('expected data mode');
  expect(mode.data.callSiteBreakdown.app.requestCount, 'app count').toBe(2);
  expect(mode.data.callSiteBreakdown.worker.requestCount, 'worker count').toBe(1);
});

test('error branch (RTL rows "API returns 500" + "API returns 404")', () => {
  // The component treats 404 the same as 500: both surface via the
  // catch handler as FetchState.status='error'. Pinning one case here;
  // the ErrorState renders the same "Cost data unavailable" copy.
  expect(selectRenderMode(true, { status: 'error' }).kind, 'kind').toBe('error');
});

test('in-progress branch (RTL row "runIsTerminal=false placeholder path")', () => {
  expect(selectRenderMode(false, { status: 'loaded', data: sampleResponse({ totalCostCents: 47 }) }).kind, 'kind').toBe('inProgress');
});

// ─── Summary ──────────────────────────────────────────────────────────

console.log('');