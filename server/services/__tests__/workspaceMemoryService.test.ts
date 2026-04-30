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
 * Skips gracefully without DATABASE_URL or NODE_ENV !== 'integration'.
 * Relies on the canonical (org, subaccount, agent) seeded by
 * scripts/seed-integration-fixtures.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { RunOutcome } from '../workspaceMemoryServicePure.js';

const SKIP_WMS = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

// runSummary long enough to pass the §6.8 short-summary guard (≥ 100 chars).
const LONG_SUMMARY = 'Agent completed the requested task successfully without errors. ' +
  'All configured steps executed in sequence. Client preferences were respected throughout.';

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

describe.skipIf(SKIP_WMS)('workspaceMemoryService overrides', () => {
  let db: Awaited<typeof import('../../db/index.js')>['db'];
  let client: Awaited<typeof import('../../db/index.js')>['client'];
  let workspaceMemoryEntries: Awaited<typeof import('../../db/schema/index.js')>['workspaceMemoryEntries'];
  let agentRuns: Awaited<typeof import('../../db/schema/index.js')>['agentRuns'];
  let workspaceMemoryService: Awaited<typeof import('../workspaceMemoryService.js')>['workspaceMemoryService'];
  let eq: Awaited<typeof import('drizzle-orm')>['eq'];
  let and: Awaited<typeof import('drizzle-orm')>['and'];

  let orgId: string;
  let subaccountId: string;
  let agentId: string;

  beforeAll(async () => {
    ({ db, client } = await import('../../db/index.js'));
    const schema = await import('../../db/schema/index.js');
    workspaceMemoryEntries = schema.workspaceMemoryEntries;
    agentRuns = schema.agentRuns;
    ({ eq, and } = await import('drizzle-orm'));
    ({ workspaceMemoryService } = await import('../workspaceMemoryService.js'));

    const [anchor] = await db
      .select({
        orgId: schema.organisations.id,
        subaccountId: schema.subaccounts.id,
      })
      .from(schema.organisations)
      .innerJoin(schema.subaccounts, eq(schema.subaccounts.organisationId, schema.organisations.id))
      .limit(1);
    if (!anchor) throw new Error('No (organisation, subaccount) seeded — run scripts/seed-integration-fixtures.ts');

    const [anchorAgent] = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.organisationId, anchor.orgId))
      .limit(1);
    if (!anchorAgent) throw new Error('No agent seeded for the anchor organisation — run scripts/seed-integration-fixtures.ts');

    orgId = anchor.orgId;
    subaccountId = anchor.subaccountId;
    agentId = anchorAgent.id;
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  async function seedRun(): Promise<string> {
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: orgId,
        subaccountId,
        agentId,
        runType: 'manual',
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning({ id: agentRuns.id });
    return run.id;
  }

  async function getWrittenRow(runId: string) {
    const [row] = await db
      .select({
        isUnverified: workspaceMemoryEntries.isUnverified,
        provenanceConfidence: workspaceMemoryEntries.provenanceConfidence,
      })
      .from(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.agentRunId, runId),
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  test('override isUnverified=false honoured even on partial outcome', async () => {
    const runId = await seedRun();
    await workspaceMemoryService.extractRunInsights(
      runId,
      agentId,
      orgId,
      subaccountId,
      LONG_SUMMARY,
      { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null } satisfies RunOutcome,
      {
        overrides: { isUnverified: false, provenanceConfidence: 0.7 },
        _routeCall: mockRouteCall as any,
      },
    );
    const row = await getWrittenRow(runId);
    expect(row, 'extractRunInsights wrote nothing').toBeTruthy();
    expect(row!.isUnverified).toBe(false);
    expect(row!.provenanceConfidence).toBe(0.7);
  });

  test('omitted overrides fall back to §6.7 defaults (partial → isUnverified=true, 0.5)', async () => {
    const runId = await seedRun();
    await workspaceMemoryService.extractRunInsights(
      runId,
      agentId,
      orgId,
      subaccountId,
      LONG_SUMMARY,
      { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null } satisfies RunOutcome,
      {
        _routeCall: mockRouteCall as any,
      },
    );
    const row = await getWrittenRow(runId);
    expect(row, 'extractRunInsights wrote nothing').toBeTruthy();
    expect(row!.isUnverified).toBe(true);
    expect(row!.provenanceConfidence).toBe(0.5);
  });

  test('success outcome default: isUnverified=false, confidence=0.7', async () => {
    const runId = await seedRun();
    await workspaceMemoryService.extractRunInsights(
      runId,
      agentId,
      orgId,
      subaccountId,
      LONG_SUMMARY,
      { runResultStatus: 'success', trajectoryPassed: null, errorMessage: null } satisfies RunOutcome,
      {
        _routeCall: mockRouteCall as any,
      },
    );
    const row = await getWrittenRow(runId);
    expect(row, 'extractRunInsights wrote nothing').toBeTruthy();
    expect(row!.isUnverified).toBe(false);
    expect(row!.provenanceConfidence).toBe(0.7);
  });

  test('RunOutcome literal type-check — all runResultStatus values', () => {
    const _variants: RunOutcome[] = [
      { runResultStatus: 'success', trajectoryPassed: true, errorMessage: null },
      { runResultStatus: 'success', trajectoryPassed: null, errorMessage: null },
      { runResultStatus: 'success', trajectoryPassed: false, errorMessage: null },
      { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null },
      { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'x' },
    ];
    expect(_variants.length).toBe(5);
  });
});
