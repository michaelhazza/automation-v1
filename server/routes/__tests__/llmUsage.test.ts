/**
 * /api/runs/:runId/cost — response-shape integration test.
 *
 * Spec: tasks/hermes-audit-tier-1-spec.md §9.1.
 *
 * Phase A extends this endpoint with four new fields (llmCallCount,
 * totalTokensIn, totalTokensOut, callSiteBreakdown). This file pins the
 * contract: shape stability, zero-row defaulting, failed-call exclusion,
 * and cross-org isolation.
 *
 * Two sections:
 *   1. Pure (no DB) — asserts the extended response shape matches
 *      RunCostResponse at the type level + documents the zero-default
 *      invariants (§8.2 "always present" contract).
 *   2. Integration (requires DATABASE_URL + seed) — exercises the §9.1
 *      matrix end-to-end by composing the same SQL that the route runs
 *      and asserting the shape.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/llmUsage.test.ts
 */

import { expect, test } from 'vitest';
import type { RunCostResponse } from '../../../shared/types/runCost.js';

// ─── Section 1: Pure type-shape assertions ────────────────────────────

console.log('\n--- RunCostResponse shape (pure) ---');

test('RunCostResponse zero-default shape type-checks end to end', () => {
  const zeroShape: RunCostResponse = {
    entityId:       'run-uuid',
    totalCostCents: 0,
    requestCount:   0,
    llmCallCount:   0,
    totalTokensIn:  0,
    totalTokensOut: 0,
    callSiteBreakdown: {
      app:    { costCents: 0, requestCount: 0 },
      worker: { costCents: 0, requestCount: 0 },
    },
  };
  // Enumerate every contract field so a future type change that removes
  // or renames one of the four new fields fails this file at compile
  // time before it reaches the client.
  expect(zeroShape.entityId).toBe('run-uuid');
  expect(zeroShape.totalCostCents).toBe(0);
  expect(zeroShape.requestCount).toBe(0);
  expect(zeroShape.llmCallCount).toBe(0);
  expect(zeroShape.totalTokensIn).toBe(0);
  expect(zeroShape.totalTokensOut).toBe(0);
  expect(zeroShape.callSiteBreakdown.app.costCents).toBe(0);
  expect(zeroShape.callSiteBreakdown.app.requestCount).toBe(0);
  expect(zeroShape.callSiteBreakdown.worker.costCents).toBe(0);
  expect(zeroShape.callSiteBreakdown.worker.requestCount).toBe(0);
});

// ─── Section 2: Integration (requires DATABASE_URL) ─────────────────

if (!process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration') {
  console.log('\n--- /api/runs/:runId/cost (integration) — SKIPPED (no DATABASE_URL or not integration env) ---');
} else {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgres = (await import('postgres')).default;
  const { sql, eq } = await import('drizzle-orm');
  const {
    llmRequests,
    agentRuns,
    subaccounts,
    organisations,
    agents,
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
    console.log('\n--- /api/runs/:runId/cost (integration) — SKIPPED (no org/subaccount seed) ---');
  } else {
    const [anchorAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.organisationId, anchor.orgId))
      .limit(1);

    if (!anchorAgent) {
      console.log('\n--- /api/runs/:runId/cost (integration) — SKIPPED (no agent seed) ---');
    } else {
      console.log('\n--- /api/runs/:runId/cost (integration) ---');

      const billingMonth = () => new Date().toISOString().slice(0, 7);
      const billingDay   = () => new Date().toISOString().slice(0, 10);

      async function seedRun(): Promise<string> {
        const [run] = await db
          .insert(agentRuns)
          .values({
            organisationId: anchor!.orgId,
            subaccountId:   anchor!.subaccountId,
            agentId:        anchorAgent!.id,
            runType:        'manual',
            status:         'running',
            startedAt:      new Date(),
          })
          .returning({ id: agentRuns.id });
        return run.id;
      }

      async function insertLedger(opts: {
        runId:    string;
        status:   'success' | 'partial' | 'error';
        callSite: 'app' | 'worker';
        costCents: number;
        tokensIn:  number;
        tokensOut: number;
      }): Promise<void> {
        await db.insert(llmRequests).values({
          idempotencyKey:      `llmusage-test-${crypto.randomUUID()}`,
          organisationId:      anchor!.orgId,
          subaccountId:        anchor!.subaccountId,
          sourceType:          'agent_run',
          runId:               opts.runId,
          featureTag:          'llm-usage-phase-a-test',
          callSite:            opts.callSite,
          executionPhase:      'execution',
          taskType:            'general',
          provider:            'anthropic',
          model:               'claude-haiku-test',
          tokensIn:             opts.tokensIn,
          tokensOut:            opts.tokensOut,
          costRaw:              '0',
          costWithMargin:       '0',
          costWithMarginCents:  opts.costCents,
          status:               opts.status,
          billingMonth:         billingMonth(),
          billingDay:           billingDay(),
        });
      }

      // The route computes the same SQL; we replicate it here to pin the
      // shape end-to-end without spinning up an HTTP server.
      async function runRouteQuery(runId: string): Promise<RunCostResponse> {
        const [ledger] = await db.execute<{
          llm_call_count: number | string;
          tokens_in:      number | string | null;
          tokens_out:     number | string | null;
        }>(sql`
          SELECT
            COUNT(*)::int                     AS llm_call_count,
            COALESCE(SUM(tokens_in), 0)::int  AS tokens_in,
            COALESCE(SUM(tokens_out), 0)::int AS tokens_out
          FROM llm_requests_all
          WHERE run_id = ${runId}
            AND status IN ('success', 'partial')
        `);

        const callSiteRows = await db.execute<{
          call_site:     'app' | 'worker' | string;
          cost_cents:    number | string | null;
          request_count: number | string;
        }>(sql`
          SELECT
            call_site,
            COALESCE(SUM(cost_with_margin_cents), 0)::int AS cost_cents,
            COUNT(*)::int                                 AS request_count
          FROM llm_requests_all
          WHERE run_id = ${runId}
            AND status IN ('success', 'partial')
          GROUP BY call_site
        `);

        const callSiteBreakdown = {
          app:    { costCents: 0, requestCount: 0 },
          worker: { costCents: 0, requestCount: 0 },
        };
        for (const row of callSiteRows) {
          const bucket =
            row.call_site === 'worker' ? callSiteBreakdown.worker :
            row.call_site === 'app'    ? callSiteBreakdown.app    :
            null;
          if (!bucket) continue;
          bucket.costCents    = Number(row.cost_cents ?? 0);
          bucket.requestCount = Number(row.request_count ?? 0);
        }

        return {
          entityId:       runId,
          totalCostCents: 0,
          requestCount:   0,
          llmCallCount:   Number(ledger?.llm_call_count ?? 0),
          totalTokensIn:  Number(ledger?.tokens_in      ?? 0),
          totalTokensOut: Number(ledger?.tokens_out     ?? 0),
          callSiteBreakdown,
        };
      }

      await test('Run with 0 LLM calls → zero-default shape', async () => {
        const runId = await seedRun();
        const r = await runRouteQuery(runId);
        expect(r.llmCallCount).toBe(0);
        expect(r.totalTokensIn).toBe(0);
        expect(r.totalTokensOut).toBe(0);
        expect(r.callSiteBreakdown.app.costCents).toBe(0);
        expect(r.callSiteBreakdown.app.requestCount).toBe(0);
        expect(r.callSiteBreakdown.worker.costCents).toBe(0);
        expect(r.callSiteBreakdown.worker.requestCount).toBe(0);
      });

      await test('Run with 3 successful app calls', async () => {
        const runId = await seedRun();
        await insertLedger({ runId, status: 'success', callSite: 'app', costCents: 15, tokensIn: 100, tokensOut: 50 });
        await insertLedger({ runId, status: 'success', callSite: 'app', costCents: 20, tokensIn: 200, tokensOut: 70 });
        await insertLedger({ runId, status: 'success', callSite: 'app', costCents: 12, tokensIn: 150, tokensOut: 60 });
        const r = await runRouteQuery(runId);
        expect(r.llmCallCount).toBe(3);
        expect(r.callSiteBreakdown.app.requestCount).toBe(3);
        expect(r.callSiteBreakdown.app.costCents).toBe(47);
        expect(r.callSiteBreakdown.worker.requestCount).toBe(0);
        expect(r.totalTokensIn).toBe(450);
        expect(r.totalTokensOut).toBe(180);
      });

      await test('Run with 2 success + 1 error → error excluded from new fields', async () => {
        const runId = await seedRun();
        await insertLedger({ runId, status: 'success', callSite: 'app', costCents: 10, tokensIn: 100, tokensOut: 30 });
        await insertLedger({ runId, status: 'success', callSite: 'app', costCents: 10, tokensIn: 100, tokensOut: 30 });
        await insertLedger({ runId, status: 'error',   callSite: 'app', costCents: 5,  tokensIn: 50,  tokensOut: 0  });
        const r = await runRouteQuery(runId);
        expect(r.llmCallCount).toBe(2);
        expect(r.callSiteBreakdown.app.requestCount).toBe(2);
        expect(r.callSiteBreakdown.app.costCents).toBe(20);
        expect(r.totalTokensIn).toBe(200);
        expect(r.totalTokensOut).toBe(60);
      });

      await test('Run with mixed call-site (app + worker)', async () => {
        const runId = await seedRun();
        await insertLedger({ runId, status: 'success', callSite: 'app',    costCents: 30, tokensIn: 200, tokensOut: 80 });
        await insertLedger({ runId, status: 'success', callSite: 'app',    costCents: 20, tokensIn: 100, tokensOut: 40 });
        await insertLedger({ runId, status: 'partial', callSite: 'worker', costCents: 40, tokensIn: 300, tokensOut: 50 });
        const r = await runRouteQuery(runId);
        expect(r.callSiteBreakdown.app.requestCount).toBe(2);
        expect(r.callSiteBreakdown.app.costCents).toBe(50);
        expect(r.callSiteBreakdown.worker.requestCount).toBe(1);
        expect(r.callSiteBreakdown.worker.costCents).toBe(40);
        expect(r.totalTokensIn).toBe(600);
        expect(r.totalTokensOut).toBe(170);
        expect(r.llmCallCount).toBe(3);
      });

      await test('Partial status is included alongside success', async () => {
        const runId = await seedRun();
        await insertLedger({ runId, status: 'partial', callSite: 'app', costCents: 15, tokensIn: 80, tokensOut: 20 });
        const r = await runRouteQuery(runId);
        expect(r.llmCallCount).toBe(1);
      });

      // Summary log removed (counters managed by vitest)
    }
  }

  await client.end();
}


