import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Integration test: exercises llm.requested + llm.completed emission through llmRouter.
// Requires a real DB connection and a fake provider adapter.
// Run with: npx tsx server/services/__tests__/llmRouterLaelIntegration.test.ts
//
// Status: SKIPPED. Spec-conformance routed §1.1 Gap F to tasks/todo.md because
// no shared fake-webhook / fake-provider harness exists yet. Each `test.skip`
// here preserves the intent so a contributor scanning the suite sees the gap
// rather than a misleading "all green" signal.
// See: tasks/todo.md § "Deferred from spec-conformance review — pre-test-backend-hardening".

describe('llmRouter — LAEL lifecycle events', () => {
  test.skip('agent-run LLM call emits llm.requested then llm.completed with matching ledgerRowId', async () => {
    assert.ok(true, 'TODO: implement with test DB harness');
  });

  test.skip('budget_blocked LLM call emits no LAEL events and inserts no payload row', async () => {
    assert.ok(true, 'TODO: implement with test DB harness');
  });

  test.skip('non-agent-run LLM call (slack/whisper) emits no LAEL events and inserts no payload row', async () => {
    assert.ok(true, 'TODO: implement with test DB harness');
  });
});
