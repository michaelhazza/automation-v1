/**
 * heuristics25Pure.test.ts — Tests for Phase 2.5 heuristic modules.
 *
 * Run: npx tsx server/services/systemMonitor/heuristics/__tests__/heuristics25Pure.test.ts
 */

import { expect, test } from 'vitest';
import type { HeuristicContext, Baseline, BaselineEntityKind, Candidate } from '../types.js';
import type { AgentRunEntity } from '../candidateTypes.js';

import { cacheHitRateDegradation } from '../infrastructure/cacheHitRateDegradation.js';
import { latencyCreep } from '../infrastructure/latencyCreep.js';
import { retryRateIncrease } from '../infrastructure/retryRateIncrease.js';
import { authRefreshSpike } from '../infrastructure/authRefreshSpike.js';
import { llmFallbackUnexpected } from '../infrastructure/llmFallbackUnexpected.js';
import { successRateDegradationTrend } from '../systemic/successRateDegradationTrend.js';
import { outputEntropyCollapse } from '../systemic/outputEntropyCollapse.js';
import { toolSelectionDrift } from '../systemic/toolSelectionDrift.js';
import { costPerOutcomeIncreasing } from '../systemic/costPerOutcomeIncreasing.js';

test('assertions', () => {
  const pendingTests: Array<Promise<void>> = [];
  function asyncTest(name: string, fn: () => Promise<void>) {
    const p = new Promise<void>((resolve) => {
      fn().then(
        () => { passed++; console.log(`  PASS  ${name}`); resolve(); },
        (err: unknown) => { failed++; console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`); resolve(); },
      );
    });
    pendingTests.push(p);
  }
  
  const NOW = new Date('2026-04-25T14:00:00.000Z');
  
  function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
    return {
      entityKind: 'agent', entityId: 'test-agent', metric: 'runtime_ms',
      windowStart: new Date(NOW.getTime() - 86_400_000), windowEnd: NOW,
      sampleCount: 50, p50: 1000, p95: 2000, p99: 4000, mean: 1100, stddev: 300, min: 200, max: 8000,
      ...overrides,
    };
  }
  
  function makeCtx(baselineMap?: Map<string, Baseline>): HeuristicContext {
    return {
      now: NOW,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      baselines: {
        async get(ek: BaselineEntityKind, ei: string, m: string) {
          return baselineMap?.get(`${ek}:${ei}:${m}`) ?? null;
        },
        async getOrNull(ek: BaselineEntityKind, ei: string, m: string, minN: number) {
          const b = baselineMap?.get(`${ek}:${ei}:${m}`) ?? null;
          if (!b || b.sampleCount < minN) return null;
          return b;
        },
      },
    };
  }
  
  function makeAgent(entity: Partial<AgentRunEntity>): Candidate {
    const defaults: AgentRunEntity = {
      runId: 'run-1', agentId: 'a1', agentSlug: 'test-agent', organisationId: 'org-1',
      status: 'completed', runResultStatus: 'success', durationMs: 1000,
      inputTokens: 100, outputTokens: 200, totalTokens: 300, tokenBudget: 4000,
      errorMessage: null, summary: null, isTestRun: false, reachedMaxTurns: false,
      finalMessageRole: 'assistant', finalMessageContent: 'Done.', finalMessageLengthChars: 5,
      skillInvocationCounts: {}, outputHash: null, recentRunOutputs: [],
    };
    return { entityKind: 'agent_run', entityId: 'run-1', entity: { ...defaults, ...entity } };
  }
  
  // ── cacheHitRateDegradation ────────────────────────────────────────────────────
  
  console.log('\n--- cacheHitRateDegradation ---');
  
  asyncTest('fires when hit rate p50 drops below historical mean by >0.20', async () => {
    const bm = new Map([
      ['agent:test-agent:cache_hit_rate', makeBaseline({ metric: 'cache_hit_rate', p50: 0.40, mean: 0.80 })],
    ]);
    const result = await cacheHitRateDegradation.evaluate(makeCtx(bm), makeAgent({}));
    expect(result.fired === true, 'should fire on degraded hit rate').toBeTruthy();
  });
  
  asyncTest('does not fire when hit rate is within threshold', async () => {
    const bm = new Map([
      ['agent:test-agent:cache_hit_rate', makeBaseline({ metric: 'cache_hit_rate', p50: 0.75, mean: 0.80 })],
    ]);
    const result = await cacheHitRateDegradation.evaluate(makeCtx(bm), makeAgent({}));
    expect(result.fired === false, 'should not fire when within threshold').toBeTruthy();
  });
  
  asyncTest('returns insufficient_data when no baseline', async () => {
    const result = await cacheHitRateDegradation.evaluate(makeCtx(), makeAgent({}));
    expect(!result.fired && 'reason' in result && result.reason === 'insufficient_data', 'insufficient_data').toBeTruthy();
  });
  
  // ── latencyCreep ───────────────────────────────────────────────────────────────
  
  console.log('--- latencyCreep ---');
  
  asyncTest('fires when duration > 1.5x baseline p95 AND >500ms delta', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ metric: 'runtime_ms', p95: 2000 })],
    ]);
    const result = await latencyCreep.evaluate(makeCtx(bm), makeAgent({ durationMs: 3200 })); // 3200 > 3000 AND +1200ms
    expect(result.fired === true, 'should fire on creep').toBeTruthy();
  });
  
  asyncTest('does not fire when duration is just above p95 but below absolute threshold', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ metric: 'runtime_ms', p95: 2000 })],
    ]);
    const result = await latencyCreep.evaluate(makeCtx(bm), makeAgent({ durationMs: 2100 })); // below 1.5x
    expect(result.fired === false, 'should not fire on small latency').toBeTruthy();
  });
  
  asyncTest('does not fire when no durationMs', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ metric: 'runtime_ms', p95: 2000 })],
    ]);
    const result = await latencyCreep.evaluate(makeCtx(bm), makeAgent({ durationMs: null }));
    expect(result.fired === false, 'no duration → no fire').toBeTruthy();
  });
  
  // ── retryRateIncrease ─────────────────────────────────────────────────────────
  
  console.log('--- retryRateIncrease ---');
  
  asyncTest('fires for failed run with error message and baseline present', async () => {
    const bm = new Map([
      ['agent:test-agent:token_count_input', makeBaseline({ metric: 'token_count_input', sampleCount: 20 })],
    ]);
    const result = await retryRateIncrease.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'failed', errorMessage: 'Service unavailable — retry exhausted' }),
    );
    expect(result.fired === true, 'should fire for failed run with error').toBeTruthy();
  });
  
  asyncTest('does not fire for successful run', async () => {
    const bm = new Map([
      ['agent:test-agent:token_count_input', makeBaseline({ metric: 'token_count_input', sampleCount: 20 })],
    ]);
    const result = await retryRateIncrease.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'success', errorMessage: null }),
    );
    expect(result.fired === false, 'success → no fire').toBeTruthy();
  });
  
  // ── authRefreshSpike ───────────────────────────────────────────────────────────
  
  console.log('--- authRefreshSpike ---');
  
  asyncTest('fires when error message contains auth-refresh pattern', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ sampleCount: 15 })],
    ]);
    const result = await authRefreshSpike.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'failed', errorMessage: 'Credential expired — auth refresh required' }),
    );
    expect(result.fired === true, 'should fire on auth refresh error').toBeTruthy();
  });
  
  asyncTest('does not fire for unrelated error message', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ sampleCount: 15 })],
    ]);
    const result = await authRefreshSpike.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'failed', errorMessage: 'Database connection timeout' }),
    );
    expect(result.fired === false, 'unrelated error → no fire').toBeTruthy();
  });
  
  asyncTest('does not fire when no error message', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ sampleCount: 15 })],
    ]);
    const result = await authRefreshSpike.evaluate(makeCtx(bm), makeAgent({ errorMessage: null }));
    expect(result.fired === false, 'no error → no fire').toBeTruthy();
  });
  
  // ── llmFallbackUnexpected ─────────────────────────────────────────────────────
  
  console.log('--- llmFallbackUnexpected ---');
  
  asyncTest('fires when error contains fallback pattern with sufficient baseline', async () => {
    const bm = new Map([
      ['agent:test-agent:token_count_input', makeBaseline({ metric: 'token_count_input', sampleCount: 15 })],
    ]);
    const result = await llmFallbackUnexpected.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'failed', errorMessage: 'Primary model unavailable — fallback model invoked' }),
    );
    expect(result.fired === true, 'should fire on fallback pattern').toBeTruthy();
  });
  
  asyncTest('does not fire when error is unrelated to fallback', async () => {
    const bm = new Map([
      ['agent:test-agent:token_count_input', makeBaseline({ metric: 'token_count_input', sampleCount: 15 })],
    ]);
    const result = await llmFallbackUnexpected.evaluate(
      makeCtx(bm),
      makeAgent({ errorMessage: 'Network timeout after 30s' }),
    );
    expect(result.fired === false, 'no fallback pattern → no fire').toBeTruthy();
  });
  
  // ── successRateDegradationTrend ────────────────────────────────────────────────
  
  console.log('--- successRateDegradationTrend ---');
  
  asyncTest('fires when success rate p50 drops >10pp below historical mean', async () => {
    const bm = new Map([
      ['agent:test-agent:success_rate', makeBaseline({ metric: 'success_rate', p50: 0.60, mean: 0.85, sampleCount: 25 })],
    ]);
    const result = await successRateDegradationTrend.evaluate(makeCtx(bm), makeAgent({}));
    expect(result.fired === true, 'should fire on degraded success rate').toBeTruthy();
  });
  
  asyncTest('does not fire when success rate is within threshold', async () => {
    const bm = new Map([
      ['agent:test-agent:success_rate', makeBaseline({ metric: 'success_rate', p50: 0.80, mean: 0.85, sampleCount: 25 })],
    ]);
    const result = await successRateDegradationTrend.evaluate(makeCtx(bm), makeAgent({}));
    expect(result.fired === false, 'within threshold → no fire').toBeTruthy();
  });
  
  asyncTest('returns insufficient_data when no baseline', async () => {
    const result = await successRateDegradationTrend.evaluate(makeCtx(), makeAgent({}));
    expect(!result.fired && 'reason' in result && result.reason === 'insufficient_data', 'insufficient_data').toBeTruthy();
  });
  
  // ── outputEntropyCollapse ──────────────────────────────────────────────────────
  
  console.log('--- outputEntropyCollapse ---');
  
  asyncTest('fires on degenerate output (two chars only) with sufficient baseline', async () => {
    const bm = new Map([
      ['agent:test-agent:token_count_output', makeBaseline({ metric: 'token_count_output', p50: 200, sampleCount: 20 })],
    ]);
    // Two-character output has entropy = 1.0 bit, well below the 2.5-bit threshold
    const degenerate = 'ab'.repeat(100); // entropy = 1.0 bit
    const result = await outputEntropyCollapse.evaluate(
      makeCtx(bm),
      makeAgent({ finalMessageContent: degenerate, finalMessageLengthChars: degenerate.length }),
    );
    expect(result.fired === true, 'two-char degenerate output should fire').toBeTruthy();
  });
  
  asyncTest('does not fire on diverse natural language output', async () => {
    const bm = new Map([
      ['agent:test-agent:token_count_output', makeBaseline({ metric: 'token_count_output', p50: 200, sampleCount: 20 })],
    ]);
    const diverse = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!';
    const result = await outputEntropyCollapse.evaluate(
      makeCtx(bm),
      makeAgent({ finalMessageContent: diverse, finalMessageLengthChars: diverse.length }),
    );
    expect(result.fired === false, 'diverse output should not fire').toBeTruthy();
  });
  
  asyncTest('returns insufficient_data when no baseline', async () => {
    const result = await outputEntropyCollapse.evaluate(makeCtx(), makeAgent({ finalMessageContent: 'a'.repeat(100) }));
    expect(!result.fired && 'reason' in result && result.reason === 'insufficient_data', 'insufficient_data').toBeTruthy();
  });
  
  // ── toolSelectionDrift ────────────────────────────────────────────────────────
  
  console.log('--- toolSelectionDrift ---');
  
  asyncTest('returns insufficient_data when no skill invocations', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ sampleCount: 25 })],
    ]);
    const result = await toolSelectionDrift.evaluate(makeCtx(bm), makeAgent({ skillInvocationCounts: {} }));
    expect(!result.fired && 'reason' in result && result.reason === 'insufficient_data', 'no invocations → insufficient_data').toBeTruthy();
  });
  
  asyncTest('does not fire when invocations are balanced', async () => {
    const bm = new Map([
      ['agent:test-agent:runtime_ms', makeBaseline({ sampleCount: 25 })],
    ]);
    const counts = { read_agent_run: 5, write_diagnosis: 5 };
    const result = await toolSelectionDrift.evaluate(makeCtx(bm), makeAgent({ skillInvocationCounts: counts }));
    // With balanced distribution, KL divergence vs uniform prior is 0
    expect(result.fired === false, 'balanced tools → no drift').toBeTruthy();
  });
  
  // ── costPerOutcomeIncreasing ───────────────────────────────────────────────────
  
  console.log('--- costPerOutcomeIncreasing ---');
  
  asyncTest('fires when successful run uses tokens > 1.5x baseline p95', async () => {
    const bm = new Map([
      ['agent:test-agent:cost_per_outcome', makeBaseline({ metric: 'cost_per_outcome', p95: 500, sampleCount: 20 })],
    ]);
    const result = await costPerOutcomeIncreasing.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'success', inputTokens: 400, outputTokens: 450 }), // 850 > 750 (500*1.5)
    );
    expect(result.fired === true, 'should fire on high token cost').toBeTruthy();
  });
  
  asyncTest('does not fire for failed run', async () => {
    const bm = new Map([
      ['agent:test-agent:cost_per_outcome', makeBaseline({ metric: 'cost_per_outcome', p95: 500, sampleCount: 20 })],
    ]);
    const result = await costPerOutcomeIncreasing.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'failed', inputTokens: 1000, outputTokens: 1000 }),
    );
    expect(result.fired === false, 'failed run → not counted for cost_per_outcome').toBeTruthy();
  });
  
  asyncTest('does not fire when cost is within baseline', async () => {
    const bm = new Map([
      ['agent:test-agent:cost_per_outcome', makeBaseline({ metric: 'cost_per_outcome', p95: 500, sampleCount: 20 })],
    ]);
    const result = await costPerOutcomeIncreasing.evaluate(
      makeCtx(bm),
      makeAgent({ runResultStatus: 'success', inputTokens: 100, outputTokens: 200 }), // 300 < 750
    );
    expect(result.fired === false, 'within threshold → no fire').toBeTruthy();
  });
  
  // ── Summary ────────────────────────────────────────────────────────────────────
  
  Promise.all(pendingTests).then(() => {
    console.log('');
});
});
