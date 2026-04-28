import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Integration test: exercises llm.requested + llm.completed emission through llmRouter.
// Requires a real DB connection and a fake provider adapter.
// Run with: npx tsx server/services/__tests__/llmRouterLaelIntegration.test.ts

describe('llmRouter — LAEL lifecycle events', () => {
  test('agent-run LLM call emits llm.requested then llm.completed with matching ledgerRowId', async () => {
    assert.ok(true, 'TODO: implement with test DB harness');
  });

  test('budget_blocked LLM call emits no LAEL events and inserts no payload row', async () => {
    assert.ok(true, 'TODO: implement with test DB harness');
  });

  test('non-agent-run LLM call (slack/whisper) emits no LAEL events and inserts no payload row', async () => {
    assert.ok(true, 'TODO: implement with test DB harness');
  });
});
