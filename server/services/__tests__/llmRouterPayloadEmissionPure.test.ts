import { expect, test } from 'vitest';
import { shouldEmitLaelLifecycle } from '../llmRouterLaelPure.js';

// Pure unit tests for the shouldEmitLaelLifecycle gating predicate.
// No DB, no network. Run with:
//   npx tsx server/services/__tests__/llmRouterPayloadEmissionPure.test.ts
//
// Exhaustive 4×2×5 = 40-case matrix covering every combination of
// sourceType × runId × terminalStatus.

const SOURCE_TYPES = ['agent_run', 'system', 'analyzer', 'iee'] as const;
const RUN_IDS = [null, 'run-uuid-1234'] as const;
const TERMINAL_STATUSES = ['completed', 'failed', 'budget_blocked', 'rate_limited', 'provider_not_configured'] as const;
const BLOCKED_STATUSES = new Set(['budget_blocked', 'rate_limited', 'provider_not_configured']);

test('shouldEmitLaelLifecycle — exhaustive 4×2×5 matrix', () => {
  for (const sourceType of SOURCE_TYPES) {
    for (const runId of RUN_IDS) {
      for (const terminalStatus of TERMINAL_STATUSES) {
        const expected =
          sourceType === 'agent_run' &&
          runId != null &&
          !BLOCKED_STATUSES.has(terminalStatus);
        const actual = shouldEmitLaelLifecycle({ sourceType, runId }, terminalStatus);
        expect(actual, `shouldEmitLaelLifecycle({ sourceType: '${sourceType}', runId: ${runId ? "'run-uuid'" : 'null'} }, '${terminalStatus}') should be ${expected}`).toBe(expected);
      }
    }
  }
});
