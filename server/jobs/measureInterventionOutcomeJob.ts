/**
 * measureInterventionOutcomeJob (queue: clientpulse:measure-outcomes)
 *
 * Concurrency model: race-free at the write boundary via ON CONFLICT DO NOTHING
 *   Mechanism:       no advisory lock. The cross-org SELECT (LIMIT 200) acts as
 *                    a soft eligibility filter via `NOT EXISTS (...)`, and each
 *                    row's outcome write goes through interventionService.recordOutcome
 *                    which runs `INSERT ... ON CONFLICT (intervention_id) DO NOTHING`
 *                    against the `intervention_outcomes` UNIQUE(intervention_id)
 *                    constraint introduced in migration 0244. Two overlapping
 *                    runners that both observe the same eligible row will both
 *                    attempt the INSERT — the second loses the conflict and
 *                    returns `wrote=false`. No double row, no application-side
 *                    lock needed.
 *   Lock space:      none — the constraint provides serialisation at the row
 *                    level, not the org level.
 *
 * Idempotency model: ON CONFLICT-only — relies on recordOutcome being the SOLE
 *                    mutation per processed row. The pre-filter `NOT EXISTS`
 *                    in the SELECT is an optimisation, not a guarantee.
 *
 *   Mechanism:       per-row processing reads template config, post-window
 *                    health snapshot, post-window assessment, and current
 *                    action status (all SELECTs, no writes), computes the
 *                    decision purely, then calls recordOutcome which is its
 *                    own atomic INSERT...ON CONFLICT. A second invocation
 *                    re-runs the SELECT, may pick up the same row (NOT EXISTS
 *                    is racy), but the conflict path makes the second INSERT
 *                    a no-op.
 *
 *   Failure mode:    a per-row failure logs and increments `summary.failed`
 *                    without aborting the sweep. A mid-execution crash leaves
 *                    rows un-processed; the next tick picks them up via the
 *                    NOT EXISTS predicate.
 *
 *   ⚠ INVARIANT (load-bearing — do not break):
 *                    Every code path inside the per-row loop, between the
 *                    SELECT and the recordOutcome call, must be either (a)
 *                    a pure read with no observable side effect, or (b)
 *                    itself idempotent under repeated invocation with the
 *                    same input. recordOutcome MUST remain the single
 *                    mutation per row. Without the advisory lock, any
 *                    upstream side effect introduced before the INSERT
 *                    will fire on every overlapping runner — `ON CONFLICT
 *                    DO NOTHING` only deduplicates the final write, not the
 *                    work leading up to it.
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

      // recordOutcome internally INSERTs with ON CONFLICT (intervention_id) DO NOTHING.
      // Returns true iff a new row was inserted; false on the no-op conflict path.
      const wrote = await interventionService.recordOutcome(decision.recordArgs!);

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
