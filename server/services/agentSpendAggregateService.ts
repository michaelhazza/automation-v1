// ---------------------------------------------------------------------------
// agentSpendAggregateService — parallel writer for spend dimensions
//
// Writes to cost_aggregates for the three agent-spend entityType values:
//   agent_spend_subaccount  (monthly + daily, keyed by subaccountId)
//   agent_spend_org         (monthly + daily, keyed by organisationId)
//   agent_spend_run         (per-run, keyed by skillRunId)
//
// SEPARATION INVARIANT: This service is the ONLY writer for agent_spend_*
// entityType values. It MUST NOT be called from costAggregateService.upsertAggregates
// and must NOT call upsertAggregates. The two writers are kept separate to
// prevent commingling of LLM cost rollups with spend rollups (spec §6.1).
//
// Idempotency per invariant 27: the upsert guards on agent_charges.last_aggregated_state.
// Non-negative clamp per invariant 28: subtractions clamp at zero + alert.
// Half-open window keys per invariant 42: via chargeRouterServicePure.deriveWindowKey.
// Inbound-refund pattern per invariant 41.
//
// Spec: tasks/builds/agentic-commerce/spec.md §6.1, §7.6
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { agentCharges } from '../db/schema/agentCharges.js';
import { costAggregates } from '../db/schema/costAggregates.js';
import { deriveWindowKey } from './chargeRouterServicePure.js';
import { logger } from '../lib/logger.js';
import { recordIncident } from './incidentIngestor.js';
import {
  buildDimensionUpserts,
  needsAggregationUpdate,
  applyClamp,
  type AggregateChargeInput,
} from './agentSpendAggregateServicePure.js';
import type { AgentChargeStatus } from '../../shared/stateMachineGuards.js';
import type { OrgScopedTx } from '../db/index.js';


// ---------------------------------------------------------------------------
// upsertAgentSpend
//
// Main entry point. Idempotent per (chargeId, newTerminalState) via
// last_aggregated_state guard column in a single transaction.
// ---------------------------------------------------------------------------

export async function upsertAgentSpend(chargeId: string, newTerminalState: AgentChargeStatus): Promise<void> {
  // Webhook fan-out runs without an org-scoped HTTP request, so this service
  // establishes its own admin-tx + org GUC. Reads cross-org-protected tables
  // (agent_charges, cost_aggregates) via admin_role; sets app.organisation_id
  // after the row is read so RLS WITH CHECK on the upserts has a matching tenant
  // anchor (defence-in-depth — admin_role bypasses RLS, but the GUC keeps audit
  // trail and downstream policy hooks consistent).
  await withAdminConnection(
    { source: 'services.agentSpendAggregateService.upsertAgentSpend', reason: 'webhook-driven aggregation', skipAudit: true },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Step 1: Read charge row.
      const [chargeRow] = await tx
        .select({
          id: agentCharges.id,
          organisationId: agentCharges.organisationId,
          subaccountId: agentCharges.subaccountId,
          skillRunId: agentCharges.skillRunId,
          amountMinor: agentCharges.amountMinor,
          kind: agentCharges.kind,
          status: agentCharges.status,
          lastAggregatedState: agentCharges.lastAggregatedState,
          parentChargeId: agentCharges.parentChargeId,
          createdAt: agentCharges.createdAt,
        })
        .from(agentCharges)
        .where(sql`${agentCharges.id} = ${chargeId}::uuid`)
        .limit(1);

      if (!chargeRow) {
        logger.warn('agentSpendAggregateService.charge_not_found', { chargeId, newTerminalState });
        return;
      }

      // Pin the org GUC for the rest of this transaction so RLS WITH CHECK on
      // cost_aggregates upserts has a matching tenant anchor.
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${chargeRow.organisationId}, true)`);

      // Guard: check if aggregation is needed (pure, no I/O).
      if (!needsAggregationUpdate(chargeRow.lastAggregatedState as AgentChargeStatus | null, newTerminalState)) {
        logger.debug('agentSpendAggregateService.already_aggregated', { chargeId, newTerminalState });
        return;
      }

      // Step 2: Resolve parent window keys for inbound_refund rows.
      let parentMonthlyWindowKey: string | null = null;
      let parentDailyWindowKey: string | null = null;

      if (chargeRow.kind === 'inbound_refund' && chargeRow.parentChargeId) {
        const [parentRow] = await tx
          .select({ id: agentCharges.id, createdAt: agentCharges.createdAt })
          .from(agentCharges)
          .where(sql`${agentCharges.id} = ${chargeRow.parentChargeId}::uuid`)
          .limit(1);

        if (parentRow) {
          parentMonthlyWindowKey = deriveWindowKey(parentRow.createdAt, 'monthly', 'UTC');
          parentDailyWindowKey = deriveWindowKey(parentRow.createdAt, 'daily', 'UTC');
        }
      }

      // Derive window keys for this charge.
      const monthlyWindowKey = deriveWindowKey(chargeRow.createdAt, 'monthly', 'UTC');
      const dailyWindowKey = deriveWindowKey(chargeRow.createdAt, 'daily', 'UTC');

      const aggregateInput: AggregateChargeInput = {
        id: chargeRow.id,
        organisationId: chargeRow.organisationId,
        subaccountId: chargeRow.subaccountId ?? null,
        skillRunId: chargeRow.skillRunId ?? null,
        amountMinor: chargeRow.amountMinor,
        kind: chargeRow.kind as 'outbound_charge' | 'inbound_refund',
        status: chargeRow.status as AgentChargeStatus,
        newTerminalState,
        parentChargeId: chargeRow.parentChargeId ?? null,
        parentMonthlyWindowKey,
        parentDailyWindowKey,
        monthlyWindowKey,
        dailyWindowKey,
      };

      const upserts = buildDimensionUpserts(aggregateInput);
      if (upserts === null || upserts.length === 0) {
        logger.debug('agentSpendAggregateService.no_upserts', { chargeId, newTerminalState, kind: chargeRow.kind });
        // Still mark as aggregated so we don't retry on next webhook delivery.
        await tx
          .update(agentCharges)
          .set({ lastAggregatedState: newTerminalState })
          .where(
            sql`${agentCharges.id} = ${chargeId}::uuid AND (${agentCharges.lastAggregatedState} IS DISTINCT FROM ${newTerminalState})`,
          );
        return;
      }

      // Step 3: Idempotency guard + dimension upserts (same admin tx).
      // Guard: UPDATE last_aggregated_state only when it differs from newTerminalState.
      // If 0 rows updated, this charge+state was already aggregated — return early.
      const guardResult = await tx.execute(sql`
        UPDATE agent_charges
           SET last_aggregated_state = ${newTerminalState}
         WHERE id = ${chargeId}::uuid
           AND (last_aggregated_state IS DISTINCT FROM ${newTerminalState})
        RETURNING id
      `);

      const updatedRows = Array.isArray(guardResult)
        ? guardResult
        : Array.isArray((guardResult as { rows?: unknown[] })?.rows)
          ? (guardResult as { rows: unknown[] }).rows
          : [];

      if (updatedRows.length === 0) {
        // Already aggregated for this terminal state.
        return;
      }

      // Apply per-dimension upserts.
      for (const upsert of upserts) {
        if (upsert.direction === 'add') {
          await tx
            .insert(costAggregates)
            .values({
              entityType: upsert.entityType,
              entityId: upsert.entityId,
              periodType: upsert.periodType,
              periodKey: upsert.periodKey,
              organisationId: aggregateInput.organisationId,
              totalCostCents: upsert.amountMinor,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [costAggregates.entityType, costAggregates.entityId, costAggregates.periodType, costAggregates.periodKey],
              set: {
                totalCostCents: sql`${costAggregates.totalCostCents} + ${upsert.amountMinor}`,
                updatedAt: new Date(),
              },
            });
        } else {
          // subtract — apply non-negative clamp per invariant 28.
          await applySubtractWithClamp(tx, upsert.entityType, upsert.entityId, upsert.periodType, upsert.periodKey, upsert.amountMinor, chargeId, aggregateInput.organisationId);
        }
      }
    },
  );
}

// ---------------------------------------------------------------------------
// applySubtractWithClamp
//
// Subtracts delta from the aggregate row, clamping at zero.
// Emits negative_aggregate_clamp warning alert if clamping occurs.
// ---------------------------------------------------------------------------

async function applySubtractWithClamp(
  tx: OrgScopedTx,
  entityType: string,
  entityId: string,
  periodType: string,
  periodKey: string,
  delta: number,
  chargeId: string,
  organisationId: string,
): Promise<void> {
  // Read current value to determine if clamping is needed.
  const [existing] = await tx
    .select({ totalCostCents: costAggregates.totalCostCents })
    .from(costAggregates)
    .where(
      sql`${costAggregates.entityType} = ${entityType}
        AND ${costAggregates.entityId} = ${entityId}
        AND ${costAggregates.periodType} = ${periodType}
        AND ${costAggregates.periodKey} = ${periodKey}`,
    )
    .limit(1);

  const currentValue = existing?.totalCostCents ?? 0;
  const clampResult = applyClamp(currentValue, delta);

  if (clampResult.clamped) {
    recordIncident({
      source: 'job',
      summary: `agentSpendAggregateService: negative_aggregate_clamp — entityType=${entityType} entityId=${entityId} window=${periodKey}`,
      errorCode: 'negative_aggregate_clamp',
      fingerprintOverride: `spend:aggregate:clamp:${entityType}:${entityId}:${periodKey}`,
      errorDetail: {
        chargeId,
        dimension: entityType,
        windowKey: periodKey,
        attemptedDelta: delta,
        preClampValue: clampResult.preClampValue,
      },
    });
    logger.warn('agentSpendAggregateService.negative_aggregate_clamp', {
      chargeId,
      entityType,
      entityId,
      periodType,
      periodKey,
      attemptedDelta: delta,
      preClampValue: clampResult.preClampValue,
    });
  }

  await tx
    .insert(costAggregates)
    .values({
      entityType,
      entityId,
      periodType,
      periodKey,
      organisationId,
      totalCostCents: clampResult.newValue,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [costAggregates.entityType, costAggregates.entityId, costAggregates.periodType, costAggregates.periodKey],
      set: {
        totalCostCents: clampResult.newValue,
        updatedAt: new Date(),
      },
    });
}

export const agentSpendAggregateService = {
  upsertAgentSpend,
};
