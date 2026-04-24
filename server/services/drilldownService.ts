import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions } from '../db/schema/actions.js';
import { interventionOutcomes } from '../db/schema/interventionOutcomes.js';
import { reviewItems } from '../db/schema/reviewItems.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
  clientPulseSignalObservations,
} from '../db/schema/clientPulseCanonicalTables.js';
import { INTERVENTION_ACTION_TYPES } from './clientPulseInterventionContextService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { derivePendingIntervention } from './drilldownPendingInterventionPure.js';

// ---------------------------------------------------------------------------
// Drilldown read service — backs the 4 new drilldown routes (spec §4.3).
// Reads from canonical client-pulse tables + actions + intervention_outcomes.
// ---------------------------------------------------------------------------

export type PendingIntervention = {
  reviewItemId: string;
  actionTitle: string;
  proposedAt: string;
  rationale: string;
};

export type DrilldownSummary = {
  band: string | null;
  healthScore: number | null;
  healthScoreDelta7d: number | null;
  lastAssessmentAt: string | null;
  pendingIntervention: PendingIntervention | null;
};

export type DrilldownSignal = {
  slug: string;
  contribution: number;
  label: string | null;
  lastSeenAt: string | null;
};

export type BandTransition = {
  fromBand: string;
  toBand: string;
  changedAt: string;
  triggerReason: string | null;
};

export type DrilldownInterventionRow = {
  actionId: string;
  actionType: string;
  proposedAt: string;
  executedAt: string | null;
  status: string;
  outcome: {
    bandBefore: string | null;
    bandAfter: string | null;
    scoreDelta: number | null;
    executionFailed: boolean;
  } | null;
};

// ---------------------------------------------------------------------------
// getPendingIntervention — most recent review_item in pending/edited_pending
// for the subaccount. Exported for direct use and for testing the DB contract.
// ---------------------------------------------------------------------------

export async function getPendingIntervention(params: {
  organisationId: string;
  subaccountId: string;
  subaccountName: string;
}): Promise<PendingIntervention | null> {
  const rows = await db
    .select({
      reviewItemId: reviewItems.id,
      actionType: actions.actionType,
      payloadJson: actions.payloadJson,
      proposedAt: actions.createdAt,
    })
    .from(reviewItems)
    .innerJoin(actions, eq(actions.id, reviewItems.actionId))
    .where(
      and(
        eq(reviewItems.organisationId, params.organisationId),
        eq(reviewItems.subaccountId, params.subaccountId),
        sql`${reviewItems.reviewStatus} IN ('pending', 'edited_pending')`,
      ),
    )
    .orderBy(desc(actions.createdAt))
    .limit(5);

  const mapped = rows.map((r) => ({
    reviewItemId: r.reviewItemId,
    actionType: r.actionType,
    payloadJsonReasoning:
      r.payloadJson != null &&
      typeof r.payloadJson === 'object' &&
      !Array.isArray(r.payloadJson) &&
      typeof (r.payloadJson as Record<string, unknown>)['reasoning'] === 'string'
        ? ((r.payloadJson as Record<string, unknown>)['reasoning'] as string)
        : null,
    proposedAt: r.proposedAt,
  }));

  const getLabel = (actionType: string): string =>
    getActionDefinition(actionType)?.description ?? actionType;

  return derivePendingIntervention(mapped, params.subaccountName, getLabel);
}

export const drilldownService = {
  async getSummary(params: {
    organisationId: string;
    subaccountId: string;
    subaccountName: string;
  }): Promise<DrilldownSummary> {
    const [latestHealth] = await db
      .select()
      .from(clientPulseHealthSnapshots)
      .where(
        and(
          eq(clientPulseHealthSnapshots.organisationId, params.organisationId),
          eq(clientPulseHealthSnapshots.subaccountId, params.subaccountId),
        ),
      )
      .orderBy(desc(clientPulseHealthSnapshots.observedAt))
      .limit(1);

    const [latestBand] = await db
      .select()
      .from(clientPulseChurnAssessments)
      .where(
        and(
          eq(clientPulseChurnAssessments.organisationId, params.organisationId),
          eq(clientPulseChurnAssessments.subaccountId, params.subaccountId),
        ),
      )
      .orderBy(desc(clientPulseChurnAssessments.observedAt))
      .limit(1);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [oldHealth] = await db
      .select()
      .from(clientPulseHealthSnapshots)
      .where(
        and(
          eq(clientPulseHealthSnapshots.organisationId, params.organisationId),
          eq(clientPulseHealthSnapshots.subaccountId, params.subaccountId),
          sql`${clientPulseHealthSnapshots.observedAt} <= ${sevenDaysAgo.toISOString()}`,
        ),
      )
      .orderBy(desc(clientPulseHealthSnapshots.observedAt))
      .limit(1);

    const score = latestHealth?.score ?? null;
    const delta = score != null && oldHealth?.score != null ? score - oldHealth.score : null;

    const pendingIntervention = await getPendingIntervention({
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      subaccountName: params.subaccountName,
    });

    return {
      band: latestBand?.band ?? null,
      healthScore: score,
      healthScoreDelta7d: delta,
      lastAssessmentAt: latestBand?.observedAt?.toISOString() ?? latestHealth?.observedAt?.toISOString() ?? null,
      pendingIntervention,
    };
  },

  async getSignals(params: {
    organisationId: string;
    subaccountId: string;
  }): Promise<{ signals: DrilldownSignal[]; lastUpdatedAt: string | null }> {
    const [latestChurn] = await db
      .select()
      .from(clientPulseChurnAssessments)
      .where(
        and(
          eq(clientPulseChurnAssessments.organisationId, params.organisationId),
          eq(clientPulseChurnAssessments.subaccountId, params.subaccountId),
        ),
      )
      .orderBy(desc(clientPulseChurnAssessments.observedAt))
      .limit(1);

    const drivers = latestChurn?.drivers ?? [];
    const signalSlugs = drivers.map((d) => d.signal);
    const latestObservations = signalSlugs.length
      ? await db
          .select()
          .from(clientPulseSignalObservations)
          .where(
            and(
              eq(clientPulseSignalObservations.organisationId, params.organisationId),
              eq(clientPulseSignalObservations.subaccountId, params.subaccountId),
              inArray(clientPulseSignalObservations.signalSlug, signalSlugs),
            ),
          )
          .orderBy(desc(clientPulseSignalObservations.observedAt))
          .limit(signalSlugs.length * 5)
      : [];

    const lastSeenBySlug = new Map<string, Date>();
    for (const obs of latestObservations) {
      const existing = lastSeenBySlug.get(obs.signalSlug);
      if (!existing || obs.observedAt > existing) lastSeenBySlug.set(obs.signalSlug, obs.observedAt);
    }

    const signals: DrilldownSignal[] = drivers.map((d) => ({
      slug: d.signal,
      contribution: d.contribution,
      label: null,
      lastSeenAt: lastSeenBySlug.get(d.signal)?.toISOString() ?? null,
    }));

    return {
      signals,
      lastUpdatedAt: latestChurn?.observedAt?.toISOString() ?? null,
    };
  },

  async getBandTransitions(params: {
    organisationId: string;
    subaccountId: string;
    windowDays?: number;
  }): Promise<BandTransition[]> {
    const windowDays = params.windowDays ?? 90;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({ band: clientPulseChurnAssessments.band, observedAt: clientPulseChurnAssessments.observedAt })
      .from(clientPulseChurnAssessments)
      .where(
        and(
          eq(clientPulseChurnAssessments.organisationId, params.organisationId),
          eq(clientPulseChurnAssessments.subaccountId, params.subaccountId),
          gte(clientPulseChurnAssessments.observedAt, since),
        ),
      )
      .orderBy(clientPulseChurnAssessments.observedAt);

    const transitions: BandTransition[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (prev.band !== curr.band) {
        transitions.push({
          fromBand: prev.band,
          toBand: curr.band,
          changedAt: curr.observedAt.toISOString(),
          triggerReason: null,
        });
      }
    }
    return transitions;
  },

  async getInterventionHistory(params: {
    organisationId: string;
    subaccountId: string;
    limit?: number;
  }): Promise<DrilldownInterventionRow[]> {
    const limit = Math.min(params.limit ?? 50, 200);

    const rows = await db
      .select({
        action: actions,
        outcome: interventionOutcomes,
      })
      .from(actions)
      .leftJoin(
        interventionOutcomes,
        eq(interventionOutcomes.interventionId, actions.id),
      )
      .where(
        and(
          eq(actions.organisationId, params.organisationId),
          eq(actions.subaccountId, params.subaccountId),
          inArray(actions.actionType, [...INTERVENTION_ACTION_TYPES]),
        ),
      )
      .orderBy(desc(actions.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      actionId: r.action.id,
      actionType: r.action.actionType,
      proposedAt: r.action.createdAt.toISOString(),
      executedAt: r.action.executedAt?.toISOString() ?? null,
      status: r.action.status,
      outcome: r.outcome
        ? {
            bandBefore: r.outcome.bandBefore ?? null,
            bandAfter: r.outcome.bandAfter ?? null,
            scoreDelta: r.outcome.deltaHealthScore ?? null,
            executionFailed: r.outcome.executionFailed,
          }
        : null,
    }));
  },
};
