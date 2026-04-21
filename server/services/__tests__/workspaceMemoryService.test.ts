/**
 * workspaceMemoryService — impure integration test for Phase B overrides.
 *
 * Spec: tasks/hermes-audit-tier-1-spec.md §6.4, §6.7.1, §8.3, §9.2.
 *
 * The pure decision logic lives in `workspaceMemoryServicePure.ts` and
 * is covered by the parameterised matrix in
 * `workspaceMemoryServicePure.test.ts`. This file covers the
 * `options.overrides` row-write concern at the DB boundary — verifying
 * that the `overrides?.isUnverified ?? defaultIsUnverified` chain in
 * `extractRunInsights` propagates correctly into the persisted row.
 *
 * The LLM call inside `extractRunInsights` is replaced with a test-double
 * via the `_routeCall` injection point so no provider config is required.
 *
 * Skips gracefully without DATABASE_URL; integration cases require a
 * seeded organisation + subaccount + agent.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workspaceMemoryService.test.ts
 */

import type { RunOutcome } from '../workspaceMemoryServicePure.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

console.log('\n--- workspaceMemoryService overrides ---');

if (!process.env.DATABASE_URL) {
  console.log('  SKIPPED — no DATABASE_URL');
  console.log('');
  process.exitCode = 0;
  process.exit();
}

// ─── Test harness (real DB) ──────────────────────────────────────────

const { drizzle } = await import('drizzle-orm/postgres-js');
const postgres = (await import('postgres')).default;
const { eq, and } = await import('drizzle-orm');
const {
  workspaceMemoryEntries,
  agentRuns,
  subaccounts,
  agents,
  organisations,
} = await import('../../db/schema/index.js');

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const [anchor] = await db
  .select({
    orgId:        organisations.id,
    subaccountId: subaccounts.id,
  })
  .from(organisations)
  .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
  .limit(1);

if (!anchor) {
  console.log('  SKIPPED — no organisation + subaccount seed');
  await client.end();
  process.exitCode = 0;
  process.exit();
}

const [anchorAgent] = await db
  .select({ id: agents.id })
  .from(agents)
  .where(eq(agents.organisationId, anchor.orgId))
  .limit(1);

if (!anchorAgent) {
  console.log('  SKIPPED — no agent seed');
  await client.end();
  process.exitCode = 0;
  process.exit();
}

const { workspaceMemoryService } = await import('../workspaceMemoryService.js');

// ─── Test double for the LLM call ─────────────────────────────────────
// Returns a single 'observation' entry so the short-summary guard passes
// and `baseValues` has exactly one ADD row to assert against.
function mockRouteCall(_params: unknown): Promise<{ content: string }> {
  return Promise.resolve({
    content: JSON.stringify({
      entries: [
        {
          content: 'Test insight — Hermes Tier 1 Phase B §6.7.1 override chain validation fixture',
          entryType: 'observation',
        },
      ],
    }),
  });
}

// runSummary long enough to pass the §6.8 short-summary guard (≥ 100 chars).
const LONG_SUMMARY = 'Agent completed the requested task successfully without errors. ' +
  'All configured steps executed in sequence. Client preferences were respected throughout.';

async function seedRun(): Promise<string> {
  const [run] = await db
    .insert(agentRuns)
    .values({
      organisationId: anchor!.orgId,
      subaccountId:   anchor!.subaccountId,
      agentId:        anchorAgent!.id,
      runType:        'manual',
      status:         'completed',
      startedAt:      new Date(),
      completedAt:    new Date(),
    })
    .returning({ id: agentRuns.id });
  return run.id;
}

async function getWrittenRow(runId: string) {
  const [row] = await db
    .select({
      isUnverified:         workspaceMemoryEntries.isUnverified,
      provenanceConfidence: workspaceMemoryEntries.provenanceConfidence,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.agentRunId, runId),
        eq(workspaceMemoryEntries.subaccountId, anchor!.subaccountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ─── Tests ────────────────────────────────────────────────────────────

// §6.7.1 override path: outcomeLearningService passes isUnverified=false so
// retrieval filters keep including human-curated lessons.
await test('override isUnverified=false honoured even on partial outcome', async () => {
  const runId = await seedRun();
  await workspaceMemoryService.extractRunInsights(
    runId,
    anchorAgent!.id,
    anchor!.orgId,
    anchor!.subaccountId,
    LONG_SUMMARY,
    { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null } satisfies RunOutcome,
    {
      overrides: { isUnverified: false, provenanceConfidence: 0.7 },
      _routeCall: mockRouteCall as any,
    },
  );
  const row = await getWrittenRow(runId);
  if (!row) throw new Error('row not found — extractRunInsights wrote nothing');
  if (row.isUnverified !== false) {
    throw new Error(`expected isUnverified=false, got ${row.isUnverified}`);
  }
  if (row.provenanceConfidence !== 0.7) {
    throw new Error(`expected provenanceConfidence=0.7, got ${row.provenanceConfidence}`);
  }
});

// §6.7 defaults: partial run with no overrides → isUnverified=true, confidence=0.5.
await test('omitted overrides fall back to §6.7 defaults (partial → isUnverified=true, 0.5)', async () => {
  const runId = await seedRun();
  await workspaceMemoryService.extractRunInsights(
    runId,
    anchorAgent!.id,
    anchor!.orgId,
    anchor!.subaccountId,
    LONG_SUMMARY,
    { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null } satisfies RunOutcome,
    {
      _routeCall: mockRouteCall as any,
    },
  );
  const row = await getWrittenRow(runId);
  if (!row) throw new Error('row not found — extractRunInsights wrote nothing');
  if (row.isUnverified !== true) {
    throw new Error(`expected isUnverified=true (§6.7 default), got ${row.isUnverified}`);
  }
  if (row.provenanceConfidence !== 0.5) {
    throw new Error(`expected provenanceConfidence=0.5 (§6.7 default), got ${row.provenanceConfidence}`);
  }
});

// §6.7: success run default → isUnverified=false, confidence=0.7.
await test('success outcome default: isUnverified=false, confidence=0.7', async () => {
  const runId = await seedRun();
  await workspaceMemoryService.extractRunInsights(
    runId,
    anchorAgent!.id,
    anchor!.orgId,
    anchor!.subaccountId,
    LONG_SUMMARY,
    { runResultStatus: 'success', trajectoryPassed: null, errorMessage: null } satisfies RunOutcome,
    {
      _routeCall: mockRouteCall as any,
    },
  );
  const row = await getWrittenRow(runId);
  if (!row) throw new Error('row not found');
  if (row.isUnverified !== false) {
    throw new Error(`expected isUnverified=false (success default), got ${row.isUnverified}`);
  }
  if (row.provenanceConfidence !== 0.7) {
    throw new Error(`expected provenanceConfidence=0.7 (success default), got ${row.provenanceConfidence}`);
  }
});

// Type-check pin: RunOutcome must accept all three enum values.
await test('RunOutcome literal type-check — all runResultStatus values', () => {
  const _variants: RunOutcome[] = [
    { runResultStatus: 'success', trajectoryPassed: true,  errorMessage: null },
    { runResultStatus: 'success', trajectoryPassed: null,  errorMessage: null },
    { runResultStatus: 'success', trajectoryPassed: false, errorMessage: null },
    { runResultStatus: 'partial', trajectoryPassed: null,  errorMessage: null },
    { runResultStatus: 'failed',  trajectoryPassed: null,  errorMessage: 'x' },
  ];
  if (_variants.length !== 5) throw new Error('missing variants');
});

console.log(`\n  ${passed + failed} tests total; ${passed} passed, ${failed} failed`);
await client.end();
if (failed > 0) process.exit(1);
