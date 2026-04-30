/**
 * agentExecution smoke test — runnable via:
 *   npx tsx server/services/__tests__/agentExecution.smoke.test.ts
 *
 * The single Sprint-1 smoke test referenced by docs/improvements-roadmap-spec.md
 * Testing strategy → "The one runtime smoke test".
 *
 * Scope (Sprint 1):
 *   This test is a SCAFFOLD. P0.1 explicitly defers end-to-end testing of
 *   runAgenticLoop itself ("Punt to Phase 3 (P3.3 trajectory comparison)
 *   which has the same need and can amortise the cost").
 *
 *   The Sprint 1 form of this test verifies that the Sprint 1 plumbing
 *   compiles and composes correctly:
 *
 *     - loadFixtures() returns the expected shape
 *     - the LLM stub from server/lib/__tests__/llmStub.ts is wired up
 *     - the three pure helpers extracted in P0.1 Layer 3 work against
 *       fixture-style inputs
 *     - the action registry (post-Zod conversion) is loadable and every
 *       fixture-referenced skill exists in it
 *
 *   Each subsequent sprint adds one assertion to this file as the new
 *   behaviour lands. By Sprint 5 this test exercises a full happy-path
 *   middleware traversal end-to-end.
 *
 * The test follows the same lightweight tsx pattern as
 * server/services/__tests__/runContextLoader.test.ts — no framework.
 */

import { expect, test } from 'vitest';
import {
  loadFixtures,
  FIXTURE_ORG_ID,
  FIXTURE_SUBACCOUNT_1_ID,
  FIXTURE_AGENT_ID,
} from './fixtures/loadFixtures.js';
import { createLLMStub } from '../../lib/__tests__/llmStub.js';
import {
  selectExecutionPhase,
  validateToolCalls,
  buildMiddlewareContext,
} from '../agentExecutionServicePure.js';
import { ACTION_REGISTRY } from '../../config/actionRegistry.js';
import type { ProviderResponse } from '../providers/types.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('');
console.log('agentExecution smoke test (Sprint 1 scaffold)');
console.log('');

async function run() {
// ── Fixtures load and have the expected shape ─────────────────────
await test('loadFixtures returns the org with the canonical UUID', () => {
  const f = loadFixtures();
  expect(f.org.id, 'org.id').toEqual(FIXTURE_ORG_ID);
});

await test('loadFixtures returns exactly 2 subaccounts (cross-tenant test capability)', () => {
  const f = loadFixtures();
  expect(f.subaccounts.length, 'subaccounts.length').toBe(2);
  expect(f.subaccounts[0].id, 'sub1.id').toEqual(FIXTURE_SUBACCOUNT_1_ID);
});

await test('loadFixtures returns one agent linked to both subaccounts', () => {
  const f = loadFixtures();
  expect(f.agent.id, 'agent.id').toEqual(FIXTURE_AGENT_ID);
  expect(f.links.length, 'two links to the same agent').toBe(2);
  expect(f.links.every((l) => l.agentId === FIXTURE_AGENT_ID), 'both links point to the fixture agent').toBeTruthy();
});

await test('loadFixtures returns three review_code outputs (APPROVE / BLOCKED / malformed)', () => {
  const f = loadFixtures();
  expect(f.reviewCodeOutputs.approve.includes('APPROVE'), 'approve sample contains APPROVE').toBeTruthy();
  expect(f.reviewCodeOutputs.blocked.includes('BLOCKED'), 'blocked sample contains BLOCKED').toBeTruthy();
  expect(!f.reviewCodeOutputs.malformed.includes('APPROVE') &&
      !f.reviewCodeOutputs.malformed.includes('BLOCKED'), 'malformed sample has no Verdict line').toBeTruthy();
});

// ── LLM stub composes with the fixture set ────────────────────────
await test('createLLMStub returns a stub bound to a single canned response', async () => {
  const fixtures = loadFixtures();
  const stub = createLLMStub([
    {
      response: {
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'read_workspace', input: { key: 'fixture' } },
        ],
        stopReason: 'tool_use',
        tokensIn: 100,
        tokensOut: 20,
        providerRequestId: 'smoke-stub-1',
      },
    },
  ]);
  expect(stub.callCount === 0, 'fresh stub has zero calls').toBeTruthy();
  expect(typeof stub.routeCall === 'function', 'routeCall is a function').toBeTruthy();
  // Use the fixtures to confirm they integrate with downstream layers
  // — even though we do not call routeCall here, this asserts the fixture
  // shape feeds into the same surface a real test would use.
  expect(fixtures.agent.modelId.startsWith('claude-'), 'fixture agent has a Claude model id').toBeTruthy();
});

// ── Pure helpers compose against fixture-style inputs ─────────────
await test('selectExecutionPhase classifies the first iteration of a fixture run as planning', () => {
  // First iteration of any fresh agent run is always planning, regardless
  // of fixture configuration.
  expect(selectExecutionPhase(0, false, 0), 'phase').toBe('planning');
});

await test('validateToolCalls accepts a fixture-shaped create_task call', () => {
  // The fixture link includes create_task in its allowlist (an ACTION_REGISTRY
  // entry).
  const result = validateToolCalls(
    [{ id: 'tc-1', name: 'create_task', input: { title: 'fixture task', description: 'desc' } }],
    [
      {
        name: 'create_task',
        description: 'Create a task',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'task title' },
            description: { type: 'string', description: 'task body' },
          },
          required: ['title', 'description'],
        },
      },
    ],
  );
  expect(result.valid, 'valid').toBe(true);
});

await test('buildMiddlewareContext constructs an initial context from fixture-shaped params', () => {
  const fixtures = loadFixtures();
  const ctx = buildMiddlewareContext({
    runId: 'smoke-run-1',
    request: {
      organisationId: fixtures.org.id,
      subaccountId: fixtures.subaccounts[0].id,
      agentId: fixtures.agent.id,
      executionScope: 'subaccount',
      runType: 'manual',
      triggerContext: {},
      handoffDepth: 0,
      isSubAgent: false,
    } as Parameters<typeof buildMiddlewareContext>[0]['request'],
    agent: {
      modelId: fixtures.agent.modelId,
      temperature: fixtures.agent.temperature,
      maxTokens: fixtures.agent.maxTokens,
    },
    saLink: {
      id: fixtures.links[0].id,
      agentId: fixtures.links[0].agentId,
      subaccountId: fixtures.links[0].subaccountId,
    } as Parameters<typeof buildMiddlewareContext>[0]['saLink'],
    startTime: Date.now(),
    tokenBudget: 30000,
    maxToolCalls: 25,
    timeoutMs: 300000,
  });
  expect(ctx.iteration, 'iteration starts at 0').toBe(0);
  expect(ctx.tokensUsed, 'tokensUsed starts at 0').toBe(0);
  expect(ctx.toolCallsCount, 'toolCallsCount starts at 0').toBe(0);
});

// ── Action registry sanity (post-Zod conversion) ──────────────────
await test('action registry contains the skills referenced by the fixture link', () => {
  const fixtures = loadFixtures();
  const requiredSkills = fixtures.links[0].skillSlugs ?? [];
  for (const slug of requiredSkills) {
    expect(ACTION_REGISTRY[slug] !== undefined, `fixture references skill '${slug}' but ACTION_REGISTRY has no such entry`).toBeTruthy();
  }
});

await test('every action registry entry has the new idempotencyStrategy field (Slice B contract)', () => {
  for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
    expect(def.idempotencyStrategy !== undefined, `${slug} is missing idempotencyStrategy`).toBeTruthy();
  }
});

}

// Suppress unused-import lint by referencing the type once.
const _typecheckOnly: ProviderResponse | undefined = undefined;
void _typecheckOnly;

await run();

console.log('');
console.log('');
