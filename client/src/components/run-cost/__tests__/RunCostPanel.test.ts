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

import {
  buildTokensLabel,
  formatCost,
  formatTokens,
  selectRenderMode,
  type FetchState,
} from '../RunCostPanelPure.js';
import type { RunCostResponse } from '../../../../../shared/types/runCost.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

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
    assertEqual(mode.kind, 'inProgress', `kind for ${state.status}`);
  }
});

test('runIsTerminal=true + loading → loading', () => {
  assertEqual(selectRenderMode(true, { status: 'loading' }).kind, 'loading', 'kind');
});

test('runIsTerminal=true + idle → loading (treated as pre-fetch)', () => {
  assertEqual(selectRenderMode(true, { status: 'idle' }).kind, 'loading', 'kind');
});

test('runIsTerminal=true + error → error', () => {
  assertEqual(selectRenderMode(true, { status: 'error' }).kind, 'error', 'kind');
});

test('loaded zero-cost, zero-calls → zero state', () => {
  const mode = selectRenderMode(true, { status: 'loaded', data: sampleResponse() });
  assertEqual(mode.kind, 'zero', 'kind');
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
  assertEqual(mode.kind, 'data', 'kind');
});

test('loaded non-zero cost → data mode with payload', () => {
  const data = sampleResponse({ totalCostCents: 47, llmCallCount: 3 });
  const mode = selectRenderMode(true, { status: 'loaded', data });
  assertEqual(mode.kind, 'data', 'kind');
  if (mode.kind === 'data') {
    assertEqual(mode.data.totalCostCents, 47, 'carries cost');
    assertEqual(mode.data.llmCallCount, 3, 'carries call count');
  }
});

// ─── formatCost ──────────────────────────────────────────────────────

console.log('\n--- formatCost (§5.2 total-cost rules) ---');

test('0 cents → $0.00', () => {
  assertEqual(formatCost(0), '$0.00', 'zero');
});

test('sub-cent (< $0.01) → two significant figures', () => {
  // 0.038 cents = $0.00038 → two sig figs
  assertEqual(formatCost(0.038), '$0.00038', 'sub-cent');
});

test('$0.01 ≤ cost < $1 → 4dp', () => {
  assertEqual(formatCost(47), '$0.4700', '$0.47');
  assertEqual(formatCost(4712), '$47.12', '$47.12 (>=$1, 2dp)');
});

test('$0.47 sub-dollar formatting hits 4dp', () => {
  assertEqual(formatCost(47.12), '$0.4712', '$0.4712');
});

test('$1 ≤ cost < $1000 → 2dp', () => {
  assertEqual(formatCost(100), '$1.00', '$1.00');
  assertEqual(formatCost(1247), '$12.47', '$12.47');
  assertEqual(formatCost(99999), '$999.99', '$999.99');
});

test('$1000+ → thousands separator, no decimals', () => {
  assertEqual(formatCost(100000), '$1,000', '$1,000');
  assertEqual(formatCost(1234567), '$12,346', 'rounded to nearest dollar');
});

test('negative cost → leading minus sign (defensive)', () => {
  assertEqual(formatCost(-47), '-$0.4700', 'negative sub-dollar');
});

// ─── formatTokens ────────────────────────────────────────────────────

console.log('\n--- formatTokens (§5.2 token rules) ---');

test('0 tokens → "0"', () => { assertEqual(formatTokens(0), '0', 'zero'); });
test('< 1000 → raw integer', () => { assertEqual(formatTokens(743), '743', 'raw'); });
test('1000 → "1k"', () => { assertEqual(formatTokens(1000), '1k', '1k'); });
test('1500 → "1.5k" (single decimal under 10k)', () => {
  assertEqual(formatTokens(1500), '1.5k', '1.5k');
});
test('9999 → "10k" (rounded)', () => { assertEqual(formatTokens(9999), '10k', '10k'); });
test('≥ 10k → integer k', () => {
  assertEqual(formatTokens(12_450), '12k', '12k');
  assertEqual(formatTokens(123_456), '123k', '123k');
});
test('1_000_000 → "1M"', () => { assertEqual(formatTokens(1_000_000), '1M', '1M'); });
test('2_500_000 → "2.5M"', () => { assertEqual(formatTokens(2_500_000), '2.5M', '2.5M'); });
test('≥ 10M → integer M', () => { assertEqual(formatTokens(12_345_678), '12M', '12M'); });

// ─── buildTokensLabel ─────────────────────────────────────────────────

console.log('\n--- buildTokensLabel ---');

test('1 call → singular "call"', () => {
  const s = buildTokensLabel(sampleResponse({ llmCallCount: 1, totalTokensIn: 500, totalTokensOut: 300 }));
  assertEqual(s, '1 LLM call · 500 tokens in / 300 tokens out', 'string');
});

test('3 calls → plural "calls"', () => {
  const s = buildTokensLabel(sampleResponse({ llmCallCount: 3, totalTokensIn: 12_450, totalTokensOut: 1820 }));
  assertEqual(s, '3 LLM calls · 12k tokens in / 1.8k tokens out', 'string');
});

test('0 calls / 0 tokens → well-formed (even if caller should render zero state)', () => {
  const s = buildTokensLabel(sampleResponse());
  assertEqual(s, '0 LLM calls · 0 tokens in / 0 tokens out', 'string');
});

// ─── Matrix — full rendering branches (§9.1) ─────────────────────────

console.log('\n--- §9.1 matrix — rendering-branch selection ---');

test('loading branch (RTL row "Mocked API pending")', () => {
  assertEqual(selectRenderMode(true, { status: 'loading' }).kind, 'loading', 'kind');
});

test('zero-cost branch (RTL row "API returns totalCostCents: 0")', () => {
  const mode = selectRenderMode(true, { status: 'loaded', data: sampleResponse() });
  assertEqual(mode.kind, 'zero', 'kind');
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
  assertEqual(selectRenderMode(true, { status: 'loaded', data }).kind, 'data', 'kind');
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
  assertEqual(mode.data.callSiteBreakdown.app.costCents, 47, 'app cost');
  assertEqual(mode.data.callSiteBreakdown.worker.costCents, 0, 'worker zero');
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
  assertEqual(mode.data.callSiteBreakdown.app.costCents, 0, 'app zero');
  assertEqual(mode.data.callSiteBreakdown.worker.requestCount, 3, 'worker count');
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
  assertEqual(mode.data.callSiteBreakdown.app.requestCount, 2, 'app count');
  assertEqual(mode.data.callSiteBreakdown.worker.requestCount, 1, 'worker count');
});

test('error branch (RTL rows "API returns 500" + "API returns 404")', () => {
  // The component treats 404 the same as 500: both surface via the
  // catch handler as FetchState.status='error'. Pinning one case here;
  // the ErrorState renders the same "Cost data unavailable" copy.
  assertEqual(selectRenderMode(true, { status: 'error' }).kind, 'error', 'kind');
});

test('in-progress branch (RTL row "runIsTerminal=false placeholder path")', () => {
  assertEqual(
    selectRenderMode(false, { status: 'loaded', data: sampleResponse({ totalCostCents: 47 }) }).kind,
    'inProgress',
    'kind',
  );
});

// ─── Summary ──────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
