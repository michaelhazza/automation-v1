// operatorCostWriter.ts — writes subscription_mediated and sandbox_compute rows.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.12, §10.3
//
// Key-based idempotent on (operator_run_id, source_type, boundary).
// Holds pg_advisory_xact_lock(hashtext('operator_finalise:' || operatorRunId))
// to prevent two concurrent finalises from interleaving row writes.
//
// Cost attribution is pinned on credential_start_mode (immutable) NOT
// credential_mode (mutable).

import { sql, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { operatorRuns, llmRequests } from '../db/schema/index.js';
import type { OperatorRun } from '../db/schema/operatorRuns.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import {
  buildSubscriptionMediatedCostRow,
  buildSandboxComputeCostRow,
  COST_ROW_BOUNDARY_CHAIN_LINK,
  type SubscriptionMediatedCostRowInput,
  type SandboxComputeCostRowInput,
} from './operatorCostWriterPure.js';

export interface WriteRowsInput {
  orgId: string;
  subaccountId: string;
  operatorRunId: string;
  sandboxComputeCents: number;
  vcpuSeconds: number;
  wallClockMs: number;
  peakMemoryBytes: number;
  /**
   * Pre-swap step count when fallback engaged mid-link.
   * Null when no fallback was engaged (uses full step_count from operator_runs row).
   */
  preSwapStepCount?: number | null;
}

export const operatorCostWriter = {
  /**
   * Writes the subscription_mediated and sandbox_compute cost rows for a chain link.
   *
   * Idempotent: uses the (operator_run_id, source_type, boundary) UNIQUE index.
   * Advisory lock prevents concurrent finalises from interleaving.
   *
   * subscription_mediated row is only written when credential_start_mode = 'operator_session'.
   * sandbox_compute row is always written.
   */
  async writeRowsForChainLink(params: WriteRowsInput): Promise<void> {
    await db.transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, params.orgId, params.subaccountId);

      // Hold advisory lock for the duration of this transaction.
      // Prevents two concurrent finalises for the same chain link from interleaving.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('operator_finalise:' || ${params.operatorRunId}))`,
      );

      // Read the chain-link row to get credential_start_mode, step_count, etc.
      const [run] = await tx
        .select()
        .from(operatorRuns)
        .where(eq(operatorRuns.id, params.operatorRunId))
        .limit(1);

      if (!run) {
        throw new Error(`operatorCostWriter: operator_runs row ${params.operatorRunId} not found`);
      }

      // Write subscription_mediated row only when credential_start_mode = 'operator_session'.
      if (run.credentialStartMode === 'operator_session') {
        const stepCount = params.preSwapStepCount ?? run.stepCount;
        const subMediatedInput: SubscriptionMediatedCostRowInput = {
          agentRunId: run.agentRunId,
          operatorRunId: run.id,
          organisationId: run.organisationId,
          subaccountId: run.subaccountId,
          chainSeq: run.chainSeq,
          vendorSessionId: run.vendorSessionId,
          stepCount,
          planTier: null, // plan_tier is not stored on operator_runs; passed via envelope if needed
        };

        const subMediatedRow = buildSubscriptionMediatedCostRow(subMediatedInput);

        await tx
          .insert(llmRequests)
          .values({
            idempotencyKey: `operator-sub-mediated:${run.id}`,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            sourceType: 'subscription_mediated',
            taskType: 'agent_run',
            runId: run.agentRunId,
            operatorRunId: run.id,
            boundary: COST_ROW_BOUNDARY_CHAIN_LINK,
            tokensIn: subMediatedRow.input_tokens,
            tokensOut: subMediatedRow.output_tokens,
            costRaw: '0',
            costWithMargin: '0',
            costWithMarginCents: subMediatedRow.cost_cents,
            marginMultiplier: '1',
            fixedFeeCents: 0,
            status: 'success',
            provider: 'operator_session',
            model: 'subscription_mediated',
            billingMonth: new Date().toISOString().slice(0, 7),
            billingDay: new Date().toISOString().slice(0, 10),
          })
          .onConflictDoNothing({
            target: [
              llmRequests.operatorRunId,
              llmRequests.sourceType,
              llmRequests.boundary,
            ],
          });
      }

      // Always write sandbox_compute row.
      const sandboxInput: SandboxComputeCostRowInput = {
        agentRunId: run.agentRunId,
        operatorRunId: run.id,
        organisationId: run.organisationId,
        subaccountId: run.subaccountId,
        chainSeq: run.chainSeq,
        vcpuSeconds: params.vcpuSeconds,
        wallClockMs: params.wallClockMs,
        peakMemoryBytes: params.peakMemoryBytes,
        costCents: params.sandboxComputeCents,
      };

      buildSandboxComputeCostRow(sandboxInput); // validates shape

      await tx
        .insert(llmRequests)
        .values({
          idempotencyKey: `operator-sandbox-compute:${run.id}`,
          organisationId: run.organisationId,
          subaccountId: run.subaccountId,
          sourceType: 'sandbox_compute',
          taskType: 'agent_run',
          runId: run.agentRunId,
          operatorRunId: run.id,
          boundary: COST_ROW_BOUNDARY_CHAIN_LINK,
          tokensIn: 0,
          tokensOut: 0,
          costRaw: String(params.sandboxComputeCents),
          costWithMargin: String(params.sandboxComputeCents),
          costWithMarginCents: params.sandboxComputeCents,
          marginMultiplier: '1',
          fixedFeeCents: 0,
          status: 'success',
          provider: 'sandbox',
          model: 'compute',
          billingMonth: new Date().toISOString().slice(0, 7),
          billingDay: new Date().toISOString().slice(0, 10),
        })
        .onConflictDoNothing({
          target: [
            llmRequests.operatorRunId,
            llmRequests.sourceType,
            llmRequests.boundary,
          ],
        });

      // Update cost mirrors on the operator_runs row.
      const updateSet: Partial<OperatorRun> = {
        costSandboxComputeCents: params.sandboxComputeCents,
        updatedAt: new Date(),
      };

      await tx
        .update(operatorRuns)
        .set(updateSet)
        .where(
          and(
            eq(operatorRuns.id, run.id),
            eq(operatorRuns.organisationId, run.organisationId),
            eq(operatorRuns.subaccountId, run.subaccountId),
          ),
        );
    });
  },
};
