/**
 * heuristicsPure.test.ts — Decision-logic tests for day-one heuristic modules.
 *
 * Tests pure helper functions and evaluate() for each of the 14 Phase 2.0
 * heuristics. Baseline-requiring heuristics use a minimal mock BaselineReader.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/heuristics/__tests__/heuristicsPure.test.ts
 */

import { expect, test } from 'vitest';
import type {
  HeuristicContext, Baseline, BaselineEntityKind, Candidate,
} from '../types.js';

// Agent quality — pure helpers
import { containsFailureLanguage } from '../agentQuality/toolSuccessButFailureLanguage.js';
import { looksLikeTruncated } from '../agentQuality/outputTruncation.js';

// Skill execution — pure helpers
import { claimsSuccess } from '../skillExecution/toolFailedButAgentClaimedSuccess.js';

// All evaluate() heuristics
import { emptyOutputBaselineAware } from '../agentQuality/emptyOutputBaselineAware.js';
import { maxTurnsHit } from '../agentQuality/maxTurnsHit.js';
import { toolSuccessButFailureLanguage } from '../agentQuality/toolSuccessButFailureLanguage.js';
import { runtimeAnomaly } from '../agentQuality/runtimeAnomaly.js';
import { tokenAnomaly } from '../agentQuality/tokenAnomaly.js';
import { repeatedSkillInvocation } from '../agentQuality/repeatedSkillInvocation.js';
import { finalMessageNotAssistant } from '../agentQuality/finalMessageNotAssistant.js';
import { outputTruncation } from '../agentQuality/outputTruncation.js';
import { identicalOutputDifferentInputs } from '../agentQuality/identicalOutputDifferentInputs.js';
import { toolOutputSchemaMismatch } from '../skillExecution/toolOutputSchemaMismatch.js';
import { skillLatencyAnomaly } from '../skillExecution/skillLatencyAnomaly.js';
import { toolFailedButAgentClaimedSuccess } from '../skillExecution/toolFailedButAgentClaimedSuccess.js';
import { jobCompletedNoSideEffect } from '../infrastructure/jobCompletedNoSideEffect.js';
import { connectorEmptyResponseRepeated } from '../infrastructure/connectorEmptyResponseRepeated.js';

import type { AgentRunEntity, SkillExecutionEntity, JobEntity, ConnectorPollEntity } from '../candidateTypes.js';

const NOW = new Date('2026-04-25T14:00:00.000Z');

// ── Minimal mock helpers ──────────────────────────────────────────────────────

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    entityKind: 'agent',
    entityId: 'test-agent',
    metric: 'runtime_ms',
    windowStart: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    windowEnd: NOW,
    sampleCount: 50,
    p50: 1000,
    p95: 2000,
    p99: 4000,
    mean: 1100,
    stddev: 300,
    min: 200,
    max: 8000,
    ...overrides,
  };
}

function makeCtx(baselineMap?: Map<string, Baseline>): HeuristicContext {
  return {
    now: NOW,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    baselines: {
      async get(entityKind: BaselineEntityKind, entityId: string, metric: string) {
        return baselineMap?.get(`${entityKind}:${entityId}:${metric}`) ?? null;
      },
      async getOrNull(entityKind: BaselineEntityKind, entityId: string, metric: string, minSampleCount: number) {
        const b = baselineMap?.get(`${entityKind}:${entityId}:${metric}`) ?? null;
        if (!b || b.sampleCount < minSampleCount) return null;
        return b;
      },
    },
  };
}

function makeAgentCandidate(entity: Partial<AgentRunEntity>): Candidate {
  const defaults: AgentRunEntity = {
    runId: 'run-1', agentId: 'agent-1', agentSlug: 'test-agent', organisationId: 'org-1',
    status: 'completed', runResultStatus: 'success', durationMs: null,
    inputTokens: 100, outputTokens: 200, totalTokens: 300, tokenBudget: 4000,
    errorMessage: null, summary: null, isTestRun: false, reachedMaxTurns: false,
    finalMessageRole: 'assistant', finalMessageContent: 'Done.', finalMessageLengthChars: 5,
    skillInvocationCounts: {}, outputHash: null, recentRunOutputs: [],
  };
  return { entityKind: 'agent_run', entityId: 'run-1', entity: { ...defaults, ...entity } };
}

function makeSkillCandidate(entity: Partial<SkillExecutionEntity & { schemaMismatch?: boolean }>): Candidate {
  const defaults: SkillExecutionEntity = {
    executionId: 'exec-1', agentRunId: 'run-1', skillSlug: 'test-skill',
    durationMs: null, succeeded: true, errorMessage: null,
    outputPayload: {}, declaredOutputSchema: null, assistantMessageAfterTool: null,
  };
  return { entityKind: 'skill_execution', entityId: 'exec-1', entity: { ...defaults, ...entity } };
}

function makeJobCandidate(entity: Partial<JobEntity>): Candidate {
  const defaults: JobEntity = {
    jobId: 'job-1', queueName: 'test-queue', state: 'completed',
    completedAt: NOW, expectedSideEffectPresent: true, data: {},
  };
  return { entityKind: 'job', entityId: 'job-1', entity: { ...defaults, ...entity } };
}

function makeConnectorCandidate(entity: Partial<ConnectorPollEntity>): Candidate {
  const defaults: ConnectorPollEntity = {
    connectorId: 'conn-1', connectorType: 'hubspot',
    recentEmptyResultCount: 0, baselineMedianRowsIngested: null,
    lastSyncAt: NOW, lastSyncError: null,
  };
  return { entityKind: 'connector_poll', entityId: 'conn-1', entity: { ...defaults, ...entity } };
}

// ── containsFailureLanguage ───────────────────────────────────────────────────

console.log('\ncontainsFailureLanguage');

test('matches "I couldn\'t"', () => { expect(containsFailureLanguage("I couldn't do that"), 'should match').toBeTruthy(); });
test('matches "I am unable"', () => { expect(containsFailureLanguage('I am unable to help'), 'should match').toBeTruthy(); });
test('matches "failed to"', () => { expect(containsFailureLanguage('The request failed to complete'), 'should match').toBeTruthy(); });
test("matches \"I don't have access\"", () => { expect(containsFailureLanguage("I don't have access"), 'should match').toBeTruthy(); });
test('does not match normal success message', () => { expect(!containsFailureLanguage('The task is complete.'), 'should not match').toBeTruthy(); });
test('does not match empty string', () => { expect(!containsFailureLanguage(''), 'should not match empty').toBeTruthy(); });

// ── looksLikeTruncated ────────────────────────────────────────────────────────

console.log('\nlooksLikeTruncated');

test('fires when no terminal punctuation and within 10% of budget', () => {
  // budget 1000 tokens × 4 chars = 4000 estimated max; 90% threshold = 3600 chars
  expect(looksLikeTruncated('some text without ending', 3700, 1000), 'should look truncated').toBeTruthy();
});
test('does not fire when content ends with terminal punctuation', () => {
  expect(!looksLikeTruncated('Task complete.', 3700, 1000), 'ends with period → not truncated').toBeTruthy();
});
test('does not fire when chars are well below budget', () => {
  expect(!looksLikeTruncated('some text without ending', 100, 1000), 'far below budget → not truncated').toBeTruthy();
});
test('does not fire when content ends with newline', () => {
  expect(!looksLikeTruncated('output\n', 3700, 1000), 'ends with newline → not truncated').toBeTruthy();
});
test('does not fire when content ends with closing bracket', () => {
  expect(!looksLikeTruncated('result}', 3700, 1000), 'ends with } → not truncated').toBeTruthy();
});

// ── claimsSuccess ─────────────────────────────────────────────────────────────

console.log('\nclaimsSuccess');

test('matches "succeeded"', () => { expect(claimsSuccess('The operation succeeded'), 'should match').toBeTruthy(); });
test('matches "was successful"', () => { expect(claimsSuccess('The task was successful'), 'should match').toBeTruthy(); });
test('matches "completed successfully"', () => { expect(claimsSuccess('The job completed successfully'), 'should match').toBeTruthy(); });
test('matches "has been created"', () => { expect(claimsSuccess('The record has been created'), 'should match').toBeTruthy(); });
test('matches "has been sent"', () => { expect(claimsSuccess('The email has been sent'), 'should match').toBeTruthy(); });
test('does not match a neutral message', () => { expect(!claimsSuccess('Processing your request'), 'should not match').toBeTruthy(); });

// ── emptyOutputBaselineAware ──────────────────────────────────────────────────

console.log('\nemptyOutputBaselineAware');

test('fires when empty output and baseline p50 > 200', async () => {
  const baselineMap = new Map([['agent:test-agent:output_length_chars', makeBaseline({ metric: 'output_length_chars', p50: 500, sampleCount: 10 })]]);
  const result = await emptyOutputBaselineAware.evaluate(makeCtx(baselineMap), makeAgentCandidate({ finalMessageLengthChars: 0 }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when output is non-empty', async () => {
  const result = await emptyOutputBaselineAware.evaluate(makeCtx(), makeAgentCandidate({ finalMessageLengthChars: 50 }));
  expect(!result.fired, 'should not fire').toBeTruthy();
});
test('does not fire when baseline p50 <= 200 (agent that normally outputs little)', async () => {
  const baselineMap = new Map([['agent:test-agent:output_length_chars', makeBaseline({ metric: 'output_length_chars', p50: 150, sampleCount: 10 })]]);
  const result = await emptyOutputBaselineAware.evaluate(makeCtx(baselineMap), makeAgentCandidate({ finalMessageLengthChars: 0 }));
  expect(!result.fired, 'should not fire — low baseline p50').toBeTruthy();
});
test('does not fire when no baseline (insufficient_data)', async () => {
  const result = await emptyOutputBaselineAware.evaluate(makeCtx(), makeAgentCandidate({ finalMessageLengthChars: 0 }));
  expect(!result.fired, 'should not fire — no baseline').toBeTruthy();
});

// ── maxTurnsHit ───────────────────────────────────────────────────────────────

console.log('\nmaxTurnsHit');

test('fires when reachedMaxTurns is true', async () => {
  const result = await maxTurnsHit.evaluate(makeCtx(), makeAgentCandidate({ reachedMaxTurns: true }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when reachedMaxTurns is false', async () => {
  const result = await maxTurnsHit.evaluate(makeCtx(), makeAgentCandidate({ reachedMaxTurns: false }));
  expect(!result.fired, 'should not fire').toBeTruthy();
});

// ── toolSuccessButFailureLanguage ────────────────────────────────────────────

console.log('\ntoolSuccessButFailureLanguage');

test('fires when success status and failure language in final message', async () => {
  const result = await toolSuccessButFailureLanguage.evaluate(makeCtx(), makeAgentCandidate({
    runResultStatus: 'success',
    finalMessageContent: "I'm unable to complete this task.",
  }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when run status is not success', async () => {
  const result = await toolSuccessButFailureLanguage.evaluate(makeCtx(), makeAgentCandidate({
    runResultStatus: 'failed',
    finalMessageContent: "I couldn't do it.",
  }));
  expect(!result.fired, 'should not fire — not success status').toBeTruthy();
});
test('does not fire when final message has no failure language', async () => {
  const result = await toolSuccessButFailureLanguage.evaluate(makeCtx(), makeAgentCandidate({
    runResultStatus: 'success',
    finalMessageContent: 'Task complete.',
  }));
  expect(!result.fired, 'should not fire — no failure language').toBeTruthy();
});

// ── runtimeAnomaly ────────────────────────────────────────────────────────────

console.log('\nruntimeAnomaly');

test('fires when durationMs > 5× p95 and > 1000ms', async () => {
  // baseline p95 = 2000ms; threshold = 10000ms; durationMs = 12000ms
  const baselineMap = new Map([['agent:test-agent:runtime_ms', makeBaseline({ p95: 2000, sampleCount: 10 })]]);
  const result = await runtimeAnomaly.evaluate(makeCtx(baselineMap), makeAgentCandidate({ durationMs: 12000 }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when durationMs is null', async () => {
  const result = await runtimeAnomaly.evaluate(makeCtx(), makeAgentCandidate({ durationMs: null }));
  expect(!result.fired, 'should not fire — null duration').toBeTruthy();
});
test('does not fire when durationMs is below absolute floor', async () => {
  const baselineMap = new Map([['agent:test-agent:runtime_ms', makeBaseline({ p95: 50, sampleCount: 10 })]]);
  const result = await runtimeAnomaly.evaluate(makeCtx(baselineMap), makeAgentCandidate({ durationMs: 800 }));
  expect(!result.fired, 'should not fire — below 1000ms floor').toBeTruthy();
});
test('does not fire when within 5× threshold', async () => {
  const baselineMap = new Map([['agent:test-agent:runtime_ms', makeBaseline({ p95: 2000, sampleCount: 10 })]]);
  const result = await runtimeAnomaly.evaluate(makeCtx(baselineMap), makeAgentCandidate({ durationMs: 5000 }));
  expect(!result.fired, 'should not fire — within threshold').toBeTruthy();
});
test('does not fire when no baseline', async () => {
  const result = await runtimeAnomaly.evaluate(makeCtx(), makeAgentCandidate({ durationMs: 50000 }));
  expect(!result.fired, 'should not fire — insufficient data').toBeTruthy();
});

// ── tokenAnomaly ──────────────────────────────────────────────────────────────

console.log('\ntokenAnomaly');

test('fires when totalTokens > 3× combined p95 and above floor', async () => {
  // baseline input p95=1000, output p95=2000 → combined=3000; threshold=9000; total=15000
  const baselineMap = new Map([
    ['agent:test-agent:token_count_input', makeBaseline({ metric: 'token_count_input', p95: 1000, sampleCount: 10 })],
    ['agent:test-agent:token_count_output', makeBaseline({ metric: 'token_count_output', p95: 2000, sampleCount: 10 })],
  ]);
  const result = await tokenAnomaly.evaluate(makeCtx(baselineMap), makeAgentCandidate({ totalTokens: 15000 }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when totalTokens below absolute floor of 5000', async () => {
  const result = await tokenAnomaly.evaluate(makeCtx(), makeAgentCandidate({ totalTokens: 3000 }));
  expect(!result.fired, 'should not fire — below floor').toBeTruthy();
});
test('does not fire when no baseline', async () => {
  const result = await tokenAnomaly.evaluate(makeCtx(), makeAgentCandidate({ totalTokens: 50000 }));
  expect(!result.fired, 'should not fire — insufficient data').toBeTruthy();
});

// ── repeatedSkillInvocation ───────────────────────────────────────────────────

console.log('\nrepeatedSkillInvocation');

test('fires when any skill invoked > 5 times', async () => {
  const result = await repeatedSkillInvocation.evaluate(makeCtx(), makeAgentCandidate({
    skillInvocationCounts: { 'send-email': 6 },
  }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when all skills invoked ≤ 5 times', async () => {
  const result = await repeatedSkillInvocation.evaluate(makeCtx(), makeAgentCandidate({
    skillInvocationCounts: { 'send-email': 3, 'create-task': 5 },
  }));
  expect(!result.fired, 'should not fire — within threshold').toBeTruthy();
});
test('does not fire when no skill invocations', async () => {
  const result = await repeatedSkillInvocation.evaluate(makeCtx(), makeAgentCandidate({ skillInvocationCounts: {} }));
  expect(!result.fired, 'should not fire — empty map').toBeTruthy();
});

// ── finalMessageNotAssistant ──────────────────────────────────────────────────

console.log('\nfinalMessageNotAssistant');

test('fires when finalMessageRole is "user"', async () => {
  const result = await finalMessageNotAssistant.evaluate(makeCtx(), makeAgentCandidate({ finalMessageRole: 'user' }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('fires when finalMessageRole is "system"', async () => {
  const result = await finalMessageNotAssistant.evaluate(makeCtx(), makeAgentCandidate({ finalMessageRole: 'system' }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when finalMessageRole is "assistant"', async () => {
  const result = await finalMessageNotAssistant.evaluate(makeCtx(), makeAgentCandidate({ finalMessageRole: 'assistant' }));
  expect(!result.fired, 'should not fire').toBeTruthy();
});
test('does not fire when finalMessageRole is null (no messages)', async () => {
  const result = await finalMessageNotAssistant.evaluate(makeCtx(), makeAgentCandidate({ finalMessageRole: null }));
  expect(!result.fired, 'should not fire — null role means no messages').toBeTruthy();
});

// ── outputTruncation ──────────────────────────────────────────────────────────

console.log('\noutputTruncation');

test('fires when content looks truncated (no terminal punct, near budget)', async () => {
  // tokenBudget=1000 → estimatedMax=4000 chars; 90%=3600; finalMessageLengthChars=3700
  const result = await outputTruncation.evaluate(makeCtx(), makeAgentCandidate({
    finalMessageContent: 'trailing text without ending',
    finalMessageLengthChars: 3700,
    tokenBudget: 1000,
  }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when content ends with terminal punctuation', async () => {
  const result = await outputTruncation.evaluate(makeCtx(), makeAgentCandidate({
    finalMessageContent: 'All done.',
    finalMessageLengthChars: 3700,
    tokenBudget: 1000,
  }));
  expect(!result.fired, 'should not fire — ends with period').toBeTruthy();
});
test('does not fire when length is well below budget', async () => {
  const result = await outputTruncation.evaluate(makeCtx(), makeAgentCandidate({
    finalMessageContent: 'short output',
    finalMessageLengthChars: 100,
    tokenBudget: 1000,
  }));
  expect(!result.fired, 'should not fire — short output').toBeTruthy();
});

// ── identicalOutputDifferentInputs ────────────────────────────────────────────

console.log('\nidenticalOutputDifferentInputs');

test('fires when same outputHash but different triggerHash in recent runs', async () => {
  const result = await identicalOutputDifferentInputs.evaluate(makeCtx(), makeAgentCandidate({
    runId: 'run-2',
    outputHash: 'hash-abc',
    recentRunOutputs: [
      { runId: 'run-1', triggerHash: 'trigger-A', outputHash: 'hash-abc' },
      { runId: 'run-2', triggerHash: 'trigger-B', outputHash: 'hash-abc' },
    ],
  }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when no outputHash', async () => {
  const result = await identicalOutputDifferentInputs.evaluate(makeCtx(), makeAgentCandidate({ outputHash: null }));
  expect(!result.fired, 'should not fire — no output hash').toBeTruthy();
});
test('does not fire when no matching prior runs', async () => {
  const result = await identicalOutputDifferentInputs.evaluate(makeCtx(), makeAgentCandidate({
    runId: 'run-2',
    outputHash: 'hash-abc',
    recentRunOutputs: [
      { runId: 'run-1', triggerHash: 'trigger-A', outputHash: 'hash-xyz' }, // different output
      { runId: 'run-2', triggerHash: 'trigger-B', outputHash: 'hash-abc' },
    ],
  }));
  expect(!result.fired, 'should not fire — different output hashes').toBeTruthy();
});

// ── toolOutputSchemaMismatch ──────────────────────────────────────────────────

console.log('\ntoolOutputSchemaMismatch');

test('fires when schemaMismatch is true', async () => {
  const result = await toolOutputSchemaMismatch.evaluate(makeCtx(), makeSkillCandidate({ schemaMismatch: true }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when schemaMismatch is false', async () => {
  const result = await toolOutputSchemaMismatch.evaluate(makeCtx(), makeSkillCandidate({ schemaMismatch: false }));
  expect(!result.fired, 'should not fire').toBeTruthy();
});
test('does not fire when schemaMismatch is absent', async () => {
  const result = await toolOutputSchemaMismatch.evaluate(makeCtx(), makeSkillCandidate({}));
  expect(!result.fired, 'should not fire — no schemaMismatch').toBeTruthy();
});

// ── skillLatencyAnomaly ───────────────────────────────────────────────────────

console.log('\nskillLatencyAnomaly');

test('fires when durationMs > 5× p95 and > 500ms', async () => {
  // baseline p95=200ms; threshold=1000ms; durationMs=2000ms
  const baselineMap = new Map([['skill:test-skill:runtime_ms', makeBaseline({ entityKind: 'skill', p95: 200, sampleCount: 10 })]]);
  const result = await skillLatencyAnomaly.evaluate(makeCtx(baselineMap), makeSkillCandidate({ durationMs: 2000 }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when durationMs ≤ 500ms absolute floor', async () => {
  const baselineMap = new Map([['skill:test-skill:runtime_ms', makeBaseline({ entityKind: 'skill', p95: 50, sampleCount: 10 })]]);
  const result = await skillLatencyAnomaly.evaluate(makeCtx(baselineMap), makeSkillCandidate({ durationMs: 400 }));
  expect(!result.fired, 'should not fire — below floor').toBeTruthy();
});
test('does not fire when no baseline', async () => {
  const result = await skillLatencyAnomaly.evaluate(makeCtx(), makeSkillCandidate({ durationMs: 10000 }));
  expect(!result.fired, 'should not fire — insufficient data').toBeTruthy();
});

// ── toolFailedButAgentClaimedSuccess ──────────────────────────────────────────

console.log('\ntoolFailedButAgentClaimedSuccess');

test('fires when skill failed but assistant claims success', async () => {
  const result = await toolFailedButAgentClaimedSuccess.evaluate(makeCtx(), makeSkillCandidate({
    succeeded: false,
    assistantMessageAfterTool: 'The task completed successfully.',
  }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when skill succeeded', async () => {
  const result = await toolFailedButAgentClaimedSuccess.evaluate(makeCtx(), makeSkillCandidate({
    succeeded: true,
    assistantMessageAfterTool: 'The task completed successfully.',
  }));
  expect(!result.fired, 'should not fire — skill succeeded').toBeTruthy();
});
test('does not fire when no assistant message after tool', async () => {
  const result = await toolFailedButAgentClaimedSuccess.evaluate(makeCtx(), makeSkillCandidate({
    succeeded: false,
    assistantMessageAfterTool: null,
  }));
  expect(!result.fired, 'should not fire — no follow-up message').toBeTruthy();
});
test('does not fire when failed but message does not claim success', async () => {
  const result = await toolFailedButAgentClaimedSuccess.evaluate(makeCtx(), makeSkillCandidate({
    succeeded: false,
    assistantMessageAfterTool: 'I was unable to complete the request.',
  }));
  expect(!result.fired, 'should not fire — message acknowledges failure').toBeTruthy();
});

// ── jobCompletedNoSideEffect ──────────────────────────────────────────────────

console.log('\njobCompletedNoSideEffect');

test('fires when job completed and side effect is absent', async () => {
  const result = await jobCompletedNoSideEffect.evaluate(makeCtx(), makeJobCandidate({
    state: 'completed',
    expectedSideEffectPresent: false,
  }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when job state is not completed', async () => {
  const result = await jobCompletedNoSideEffect.evaluate(makeCtx(), makeJobCandidate({
    state: 'active',
    expectedSideEffectPresent: false,
  }));
  expect(!result.fired, 'should not fire — job not completed').toBeTruthy();
});
test('does not fire when side effect is present', async () => {
  const result = await jobCompletedNoSideEffect.evaluate(makeCtx(), makeJobCandidate({
    state: 'completed',
    expectedSideEffectPresent: true,
  }));
  expect(!result.fired, 'should not fire — side effect present').toBeTruthy();
});

// ── connectorEmptyResponseRepeated ────────────────────────────────────────────

console.log('\nconnectorEmptyResponseRepeated');

test('fires when recentEmptyResultCount >= 3 and baseline p50 >= 1', async () => {
  const baselineMap = new Map([['connector:conn-1:rows_ingested', makeBaseline({ entityKind: 'connector', metric: 'rows_ingested', p50: 50, sampleCount: 10 })]]);
  const result = await connectorEmptyResponseRepeated.evaluate(makeCtx(baselineMap), makeConnectorCandidate({ recentEmptyResultCount: 3 }));
  expect(result.fired, 'should fire').toBeTruthy();
});
test('does not fire when count < 3', async () => {
  const result = await connectorEmptyResponseRepeated.evaluate(makeCtx(), makeConnectorCandidate({ recentEmptyResultCount: 2 }));
  expect(!result.fired, 'should not fire — below threshold').toBeTruthy();
});
test('does not fire when count >= 3 but no baseline', async () => {
  const result = await connectorEmptyResponseRepeated.evaluate(makeCtx(), makeConnectorCandidate({ recentEmptyResultCount: 5 }));
  expect(!result.fired, 'should not fire — insufficient data').toBeTruthy();
});
test('does not fire when baseline p50 < 1 (connector normally returns nothing)', async () => {
  const baselineMap = new Map([['connector:conn-1:rows_ingested', makeBaseline({ entityKind: 'connector', metric: 'rows_ingested', p50: 0, sampleCount: 10 })]]);
  const result = await connectorEmptyResponseRepeated.evaluate(makeCtx(baselineMap), makeConnectorCandidate({ recentEmptyResultCount: 5 }));
  expect(!result.fired, 'should not fire — baseline p50 < 1').toBeTruthy();
});

