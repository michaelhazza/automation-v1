/**
 * measureInterventionOutcomeJob (queue: clientpulse:measure-outcomes)
 *
 * Concurrency model: per-org pg advisory lock
 *   Mechanism:       pg_advisory_xact_lock(hashtext('<orgId>::measureInterventionOutcomes')::bigint)
 *                    inside a per-org transaction. The lock is released when
 *                    the transaction commits or rolls back. The eligibility
 *                    SELECT itself runs cross-org (single LIMIT-200 sweep);
 *                    rows are then grouped by org and each group is processed
 *                    in its own transaction holding the per-org lock.
 *   Key/lock space:  per-(organisationId, 'measureInterventionOutcomes').
 *                    Distinct orgs proceed in parallel; two runners targeting
 *                    the same org serialise.
 *
 * Idempotency model: claim+verify via NOT EXISTS predicate
 *   Mechanism:       the SELECT eligibility window already filters with
 *                    `NOT EXISTS (SELECT 1 FROM intervention_outcomes WHERE
 *                    intervention_id = a.id)`. Each row processed inserts
 *                    its outcome row exactly once via interventionService.recordOutcome.
 *                    A second invocation re-runs the same SELECT and finds
 *                    those rows are now filtered out — yielding an `examined=0`
 *                    summary, which the caller observes as a no-op.
 *   Failure mode:    a per-row failure logs and increments `summary.failed`
 *                    without aborting the sweep. A mid-execution crash leaves
 *                    rows un-processed; the next tick picks them up via the
 *                    NOT EXISTS predicate. No partial outcome row is ever
 *                    written because recordOutcome is its own atomic insert.
 *
 * __testHooks production safety: hook is undefined by default; the call site
 * uses the canonical `if (!__testHooks.<name>) return;` short-circuit so an
 * unset hook is dead code in production. Exported for race-window control in
 * idempotency tests only.
 *
 * Closes ship-gate B2: for each completed Phase-4 intervention `actions`
 * row that is >= template.measurementWindowHours old and < 14d old without
 * an `intervention_outcomes` row yet, read the current health snapshot,
 * compare to the proposal-time snapshot carried on metadataJson, and write
 * an outcome row (with band-change attribution).
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions } from '../db/schema/actions.js';
import { interventionOutcomes } from '../db/schema/interventionOutcomes.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
} from '../db/schema/clientPulseCanonicalTables.js';
import { orgConfigService } from '../services/orgConfigService.js';
import { interventionService } from '../services/interventionService.js';
import { canonicalDataService } from '../services/canonicalDataService.js';
import { fromOrgId } from '../services/principal/fromOrgId.js';
import { logger } from '../lib/logger.js';
import {
  decideOutcomeMeasurement,
  type ActionRowForMeasurement,
} from './measureInterventionOutcomeJobPure.js';

const JOB_NAME = 'measureInterventionOutcomeJob' as const;

/**
 * Test-only seam for race-window control. Production behaviour is unchanged
 * when this hook is unset (see header production-safety contract).
 */
export const __testHooks: { pauseBetweenClaimAndCommit?: () => Promise<void> } = {};

const INTERVENTION_ACTION_TYPES = [
  'crm.fire_automation',
  'crm.send_email',
  'crm.send_sms',
  'crm.create_task',
  'notify_operator',
];

export interface MeasureOutcomesJobSummary {
  status: 'ok';
  jobName: typeof JOB_NAME;
  examined: number;
  written: number;
  skippedNoSnapshot: number;
  failed: number;
}

export type MeasureOutcomesJobResult =
  | MeasureOutcomesJobSummary
  | { status: 'noop'; reason: 'no_rows_to_claim'; jobName: typeof JOB_NAME };

/**
 * Run one outcome-measurement tick. Iterates completed intervention actions
 * that don't yet have an outcome row, loads the post-intervention health
 * snapshot + band, and writes the outcome row via interventionService.
 */
export async function runMeasureInterventionOutcomes(): Promise<MeasureOutcomesJobResult> {
  const summary: MeasureOutcomesJobSummary = {
    status: 'ok',
    jobName: JOB_NAME,
    examined: 0,
    written: 0,
    skippedNoSnapshot: 0,
    failed: 0,
  };

  // Window: interventions executed between 1h ago and 14d ago, status=completed,
  // action_type in the Phase 4 set, no existing outcome row.
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const rows = await db.execute(sql`
    SELECT
      a.id, a.organisation_id, a.subaccount_id, a.action_type, a.executed_at,
      a.metadata_json
    FROM actions a
    WHERE a.action_type IN (
      'crm.fire_automation','crm.send_email','crm.send_sms','crm.create_task','notify_operator'
    )
      AND (a.status = 'completed' OR a.status = 'failed')
      AND a.executed_at IS NOT NULL
      AND a.executed_at > ${fourteenDaysAgo}
      AND a.executed_at < ${oneHourAgo}
      AND NOT EXISTS (
        SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = a.id
      )
    ORDER BY a.executed_at ASC
    LIMIT 200
  `);
  // postgres-js returns a RowList — treat the `Array.from` result as records
  const actionRows = Array.from(rows as unknown as Iterable<Record<string, unknown>>) as Array<{
    id: string;
    organisation_id: string;
    subaccount_id: string | null;
    action_type: string;
    executed_at: Date;
    metadata_json: Record<string, unknown> | null;
  }>;

  summary.examined = actionRows.length;

  if (actionRows.length === 0) {
    // No eligible rows — structured no-op so callers / tests can observe the
    // outcome instead of an `examined: 0` summary masquerading as work.
    logger.info('job_noop', { jobName: JOB_NAME, reason: 'no_rows_to_claim' });
    return { status: 'noop', reason: 'no_rows_to_claim', jobName: JOB_NAME };
  }

  // Race-window control seam (test-only). Canonical guarded short-circuit so
  // production with the hook unset is identical to a job with no hook.
  if (__testHooks.pauseBetweenClaimAndCommit) {
    await __testHooks.pauseBetweenClaimAndCommit();
  }

  // Cache intervention templates per org to avoid N×M config loads inside
  // the loop. With 200 actions spanning 10 orgs that's 10 fetches instead
  // of 200.
  const templatesByOrg = new Map<string, Awaited<ReturnType<typeof orgConfigService.getInterventionTemplates>>>();

  for (const row of actionRows) {
    try {
      const meta = (row.metadata_json ?? {}) as {
        triggerTemplateSlug?: string;
        healthScoreAtProposal?: number;
        bandAtProposal?: string;
        configVersion?: string;
      };

      let templates = templatesByOrg.get(row.organisation_id);
      if (!templates) {
        templates = await orgConfigService.getInterventionTemplates(row.organisation_id);
        templatesByOrg.set(row.organisation_id, templates);
      }
      const template = templates.find((t) => t.slug === meta.triggerTemplateSlug);
      const windowHours = template?.measurementWindowHours ?? 24;
      const windowEnds = new Date(row.executed_at.getTime() + windowHours * 60 * 60 * 1000);
      if (windowEnds > now) {
        // Too early — will pick up on the next tick.
        continue;
      }

      const accountId = await resolveAccountIdForSubaccount(
        row.organisation_id,
        row.subaccount_id,
      );

      // Post-window snapshot + assessment (at-or-after the measurement window).
      const [postSnapshot] = row.subaccount_id
        ? await db
            .select()
            .from(clientPulseHealthSnapshots)
            .where(
              and(
                eq(clientPulseHealthSnapshots.organisationId, row.organisation_id),
                eq(clientPulseHealthSnapshots.subaccountId, row.subaccount_id),
                sql`${clientPulseHealthSnapshots.observedAt} >= ${windowEnds}`,
              ),
            )
            .orderBy(desc(clientPulseHealthSnapshots.observedAt))
            .limit(1)
        : [undefined];

      const [postAssessment] = row.subaccount_id
        ? await db
            .select({ band: clientPulseChurnAssessments.band, observedAt: clientPulseChurnAssessments.observedAt })
            .from(clientPulseChurnAssessments)
            .where(
              and(
                eq(clientPulseChurnAssessments.organisationId, row.organisation_id),
                eq(clientPulseChurnAssessments.subaccountId, row.subaccount_id),
                sql`${clientPulseChurnAssessments.observedAt} >= ${windowEnds}`,
              ),
            )
            .orderBy(desc(clientPulseChurnAssessments.observedAt))
            .limit(1)
        : [undefined];

      const [statusRow] = await db
        .select({ status: actions.status })
        .from(actions)
        .where(eq(actions.id, row.id))
        .limit(1);

      const actionForPure: ActionRowForMeasurement = {
        id: row.id,
        organisationId: row.organisation_id,
        subaccountId: row.subaccount_id,
        actionType: row.action_type,
        status: (statusRow?.status === 'failed' ? 'failed' : 'completed') as 'failed' | 'completed',
        executedAt: row.executed_at,
        metadata: meta,
      };

      const decision = decideOutcomeMeasurement({
        action: actionForPure,
        accountId,
        measurementWindowHours: windowHours,
        postSnapshot: postSnapshot
          ? { score: postSnapshot.score, observedAt: postSnapshot.observedAt }
          : undefined,
        postAssessment: postAssessment
          ? { band: postAssessment.band, observedAt: postAssessment.observedAt }
          : undefined,
        now,
      });

      if (decision.kind === 'too_early') continue;
      if (decision.kind === 'no_post_snapshot') {
        summary.skippedNoSnapshot += 1;
        continue;
      }

      // Per-org advisory lock + claim-verify: hold the lock for this org,
      // re-check NOT EXISTS to defend against a sibling worker that wrote
      // the outcome row between the eligibility SELECT and now, then write.
      // The advisory lock is released when the transaction commits.
      const wrote = await db.transaction(async (tx) => {
        const lockKey = `${row.organisation_id}::measureInterventionOutcomes`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

        const [existing] = await tx
          .select({ id: interventionOutcomes.interventionId })
          .from(interventionOutcomes)
          .where(eq(interventionOutcomes.interventionId, row.id))
          .limit(1);
        if (existing) return false;

        await interventionService.recordOutcome(decision.recordArgs!);
        return true;
      });

      if (wrote) summary.written += 1;
    } catch (err) {
      summary.failed += 1;
      logger.error('measureInterventionOutcome.row_failed', {
        actionId: row.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('measureInterventionOutcome.tick_complete', { ...summary });
  return summary;
}

async function resolveAccountIdForSubaccount(
  organisationId: string,
  subaccountId: string | null,
): Promise<string | null> {
  if (!subaccountId) return null;
  // Targeted single-row SELECT scoped to both organisationId and subaccountId.
  const principal = fromOrgId(organisationId, subaccountId);
  const account = await canonicalDataService.findAccountBySubaccountId(principal, subaccountId);
  return account?.id ?? null;
}
