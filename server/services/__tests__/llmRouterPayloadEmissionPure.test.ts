import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { shouldEmitLaelLifecycle } from '../llmRouterLaelPure.js';

// Pure unit tests for the shouldEmitLaelLifecycle gating predicate.
// No DB, no network. Run with:
//   npx tsx server/services/__tests__/llmRouterPayloadEmissionPure.test.ts

describe('shouldEmitLaelLifecycle', () => {
  // ── sourceType guard ────────────────────────────────────────────────────

  test('returns false when sourceType is "system"', () => {
    assert.equal(
      shouldEmitLaelLifecycle({ sourceType: 'system', runId: 'run-1' }, 'success'),
      false,
    );
  });

  test('returns false when sourceType is "analyzer"', () => {
    assert.equal(
      shouldEmitLaelLifecycle({ sourceType: 'analyzer', runId: 'run-1' }, 'success'),
      false,
    );
  });

  test('returns false when sourceType is "iee"', () => {
    assert.equal(
      shouldEmitLaelLifecycle({ sourceType: 'iee', runId: 'run-1' }, 'success'),
      false,
    );
  });

  // ── runId guard ─────────────────────────────────────────────────────────

  test('returns false when sourceType is "agent_run" but runId is null', () => {
    assert.equal(
      shouldEmitLaelLifecycle({ sourceType: 'agent_run', runId: null }, 'success'),
      false,
    );
  });

  test('returns false when sourceType is "agent_run" but runId is undefined', () => {
    assert.equal(
      shouldEmitLaelLifecycle({ sourceType: 'agent_run', runId: undefined }, 'success'),
      false,
    );
  });

  // ── pre-dispatch terminal-status guard ──────────────────────────────────

  test('returns false when terminalStatus is "budget_blocked"', () => {
    assert.equal(
      shouldEmitLaelLifecycle(
        { sourceType: 'agent_run', runId: 'run-uuid-1' },
        'budget_blocked',
      ),
      false,
    );
  });

  test('returns false when terminalStatus is "rate_limited"', () => {
    assert.equal(
      shouldEmitLaelLifecycle(
        { sourceType: 'agent_run', runId: 'run-uuid-1' },
        'rate_limited',
      ),
      false,
    );
  });

  test('returns false when terminalStatus is "provider_not_configured"', () => {
    assert.equal(
      shouldEmitLaelLifecycle(
        { sourceType: 'agent_run', runId: 'run-uuid-1' },
        'provider_not_configured',
      ),
      false,
    );
  });

  // ── happy-path cases ─────────────────────────────────────────────────────

  test('returns true for agent_run + runId present + terminalStatus "completed"', () => {
    assert.equal(
      shouldEmitLaelLifecycle(
        { sourceType: 'agent_run', runId: 'run-uuid-1' },
        'completed',
      ),
      true,
    );
  });

  test('returns true for agent_run + runId present + terminalStatus "success"', () => {
    assert.equal(
      shouldEmitLaelLifecycle(
        { sourceType: 'agent_run', runId: 'run-uuid-1' },
        'success',
      ),
      true,
    );
  });

  test('returns true for agent_run + runId present + terminalStatus "failed"', () => {
    assert.equal(
      shouldEmitLaelLifecycle(
        { sourceType: 'agent_run', runId: 'run-uuid-1' },
        'failed',
      ),
      true,
    );
  });
});
