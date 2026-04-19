/**
 * clientPulseInterventionContextService — service layer for the Propose
 * Intervention modal context payload + operator-driven proposal write.
 *
 * Extracted from `routes/clientpulseInterventions.ts` per architecture rule
 * "Routes call services only — never access `db` directly in a route".
 */

import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { actions } from '../db/schema/actions.js';
import { agents } from '../db/schema/agents.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
} from '../db/schema/clientPulseCanonicalTables.js';
import { orgConfigService } from './orgConfigService.js';
import { interventionService } from './interventionService.js';
import { actionService } from './actionService.js';
import { reviewService } from './reviewService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { logger } from '../lib/logger.js';
import { validateInterventionActionMetadata } from './interventionActionMetadata.js';

export const INTERVENTION_ACTION_TYPES = [
  'crm.fire_automation',
  'crm.send_email',
  'crm.send_sms',
  'crm.create_task',
  'clientpulse.operator_alert',
] as const;

export type InterventionActionType = typeof INTERVENTION_ACTION_TYPES[number];

export const PROPOSER_AGENT_SLUG = 'portfolio-health-agent';

export interface InterventionContext {
  subaccount: { id: string; name: string };
  band: string | null;
  healthScore: number | null;
  healthScoreDelta7d: number | null;
  topSignals: Array<{ signal: string; contribution: number }>;
  recentInterventions: Array<{
    id: string;
    actionType: string;
    status: string;
    occurredAt: Date | string | null;
    templateSlug: string | null;
  }>;
  cooldownState: { blocked: boolean; reason?: string };
  recommendedActionType: InterventionActionType | null;
}

export async function buildInterventionContext(params: {
  organisationId: string;
  subaccountId: string;
  subaccountName: string;
}): Promise<InterventionContext> {
  const { organisationId, subaccountId, subaccountName } = params;

  const [snapshot] = await db
    .select()
    .from(clientPulseHealthSnapshots)
    .where(
      and(
        eq(clientPulseHealthSnapshots.organisationId, organisationId),
        eq(clientPulseHealthSnapshots.subaccountId, subaccountId),
      ),
    )
    .orderBy(desc(clientPulseHealthSnapshots.observedAt))
    .limit(1);

  const [assessment] = await db
    .select()
    .from(clientPulseChurnAssessments)
    .where(
      and(
        eq(clientPulseChurnAssessments.organisationId, organisationId),
        eq(clientPulseChurnAssessments.subaccountId, subaccountId),
      ),
    )
    .orderBy(desc(clientPulseChurnAssessments.observedAt))
    .limit(1);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [prior] = await db
    .select({ score: clientPulseHealthSnapshots.score })
    .from(clientPulseHealthSnapshots)
    .where(
      and(
        eq(clientPulseHealthSnapshots.organisationId, organisationId),
        eq(clientPulseHealthSnapshots.subaccountId, subaccountId),
        sql`${clientPulseHealthSnapshots.observedAt} < ${weekAgo}`,
      ),
    )
    .orderBy(desc(clientPulseHealthSnapshots.observedAt))
    .limit(1);

  const recent = await db
    .select({
      id: actions.id,
      actionType: actions.actionType,
      status: actions.status,
      createdAt: actions.createdAt,
      executedAt: actions.executedAt,
      metadataJson: actions.metadataJson,
    })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        eq(actions.subaccountId, subaccountId),
        inArray(actions.actionType, [...INTERVENTION_ACTION_TYPES]),
      ),
    )
    .orderBy(desc(actions.createdAt))
    .limit(10);

  const cooldownState: { blocked: boolean; reason?: string } = { blocked: false };
  const templates = await orgConfigService.getInterventionTemplates(organisationId);
  if (assessment?.accountId) {
    for (const template of templates) {
      const check = await interventionService.checkCooldown(
        organisationId,
        assessment.accountId,
        template.slug,
        template,
      );
      if (!check.allowed) {
        cooldownState.blocked = true;
        cooldownState.reason = check.reason;
        break;
      }
    }
  }

  // Derive recommendedActionType: pick the highest-priority template whose
  // `targets` includes the current band AND has a registered actionType.
  // Mirrors the proposer's eligibility filter (read-only). Null when the
  // band is unknown or no template applies — the UI hides the "Recommended"
  // badge in that case.
  const recommendedActionType =
    assessment?.band != null ? pickRecommendedActionType(templates, assessment.band) : null;

  return {
    subaccount: { id: subaccountId, name: subaccountName },
    band: assessment?.band ?? null,
    healthScore: snapshot?.score ?? null,
    healthScoreDelta7d:
      snapshot?.score != null && prior?.score != null ? snapshot.score - prior.score : null,
    topSignals: (assessment?.drivers ?? []).slice(0, 5),
    recentInterventions: recent.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      status: a.status,
      occurredAt: a.executedAt ?? a.createdAt,
      templateSlug:
        (a.metadataJson as Record<string, unknown> | null)?.triggerTemplateSlug as string | null | undefined ?? null,
    })),
    cooldownState,
    recommendedActionType,
  };
}

function pickRecommendedActionType(
  templates: Awaited<ReturnType<typeof orgConfigService.getInterventionTemplates>>,
  band: string,
): InterventionActionType | null {
  const eligible = templates
    .filter((t) => {
      if (!t.actionType) return false;
      if (!INTERVENTION_ACTION_TYPES.includes(t.actionType as InterventionActionType)) return false;
      const targets = t.targets;
      return !targets || targets.length === 0 || targets.includes(band as 'healthy' | 'watch' | 'atRisk' | 'critical');
    })
    .sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.slug.localeCompare(b.slug);
    });
  const top = eligible[0];
  return top?.actionType ? (top.actionType as InterventionActionType) : null;
}

export interface OperatorProposalInput {
  organisationId: string;
  subaccountId: string;
  actionType: InterventionActionType;
  payload: Record<string, unknown>;
  rationale: string;
  scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled';
  templateSlug?: string;
}

export interface OperatorProposalResult {
  id: string;
  actionType: string;
  /** True if a fresh action row was created; false when actionService dedup returned an existing row. */
  isNew: boolean;
}

/**
 * Operator-driven proposal — used by the §10.D editor submit path. Enforces
 * the daily per-subaccount + per-org quotas read from operational_config,
 * then inserts an `actions` row with `gateLevel='review'` and the Phase 4
 * metadata schema (locked contract (b), recommendedBy='operator_manual').
 *
 * Validates `input.payload` against the action's `parameterSchema` from the
 * action registry — this closes the gap between free-form editor input and
 * the strongly-typed primitive contracts. Invalid payloads throw
 * `{ statusCode: 400, errorCode: 'INVALID_PAYLOAD', issues }`.
 *
 * `scheduleHint='scheduled'` requires `scheduledFor` (ISO timestamp) —
 * enforced here at the service boundary.
 *
 * Throws `{ statusCode, message, errorCode }` on quota exceeded, validation
 * failure, or when the system Portfolio Health agent is not linked.
 */
export async function createOperatorProposal(
  input: OperatorProposalInput,
): Promise<OperatorProposalResult> {
  // 1. Validate payload against the registered parameterSchema so editors
  //    can't submit shapes that would silently fail in the review queue.
  const definition = getActionDefinition(input.actionType);
  if (!definition) {
    throw { statusCode: 400, message: `Unknown action type: ${input.actionType}`, errorCode: 'UNKNOWN_ACTION_TYPE' };
  }
  const parseResult = definition.parameterSchema.safeParse(input.payload);
  if (!parseResult.success) {
    throw {
      statusCode: 400,
      message: 'Payload does not match action schema',
      errorCode: 'INVALID_PAYLOAD',
      issues: parseResult.error.issues,
    };
  }

  // 2. scheduleHint='scheduled' must carry a scheduledFor timestamp. The
  //    per-primitive handlers also check this at execute time; surfacing it
  //    at proposal time lets the UI show a precise error instead of a
  //    generic 422 later.
  if (input.scheduleHint === 'scheduled') {
    const sf = (input.payload as Record<string, unknown>).scheduledFor;
    if (typeof sf !== 'string' || !sf) {
      throw {
        statusCode: 400,
        message: 'scheduledFor is required when scheduleHint=scheduled',
        errorCode: 'MISSING_SCHEDULE',
      };
    }
  }

  const { organisationId, subaccountId } = input;
  const defaults = await orgConfigService.getInterventionDefaults(organisationId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [subCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        eq(actions.subaccountId, subaccountId),
        inArray(actions.actionType, [...INTERVENTION_ACTION_TYPES]),
        sql`${actions.createdAt} >= ${since}`,
      ),
    );
  if ((subCount?.count ?? 0) >= defaults.maxProposalsPerDayPerSubaccount) {
    throw { statusCode: 429, message: 'subaccount-day quota exceeded', errorCode: 'QUOTA_EXCEEDED' };
  }

  const [orgCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        inArray(actions.actionType, [...INTERVENTION_ACTION_TYPES]),
        sql`${actions.createdAt} >= ${since}`,
      ),
    );
  if ((orgCount?.count ?? 0) >= defaults.maxProposalsPerDayPerOrg) {
    throw { statusCode: 429, message: 'org-day quota exceeded', errorCode: 'QUOTA_EXCEEDED' };
  }

  const [agentRow] = await db
    .select({ id: agents.id })
    .from(agents)
    .innerJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
    .where(
      and(eq(agents.organisationId, organisationId), eq(systemAgents.slug, PROPOSER_AGENT_SLUG)),
    )
    .limit(1);
  if (!agentRow) {
    throw {
      statusCode: 409,
      message: 'Portfolio Health Agent not linked to this org',
      errorCode: 'AGENT_MISSING',
    };
  }

  const [assessment] = await db
    .select()
    .from(clientPulseChurnAssessments)
    .where(
      and(
        eq(clientPulseChurnAssessments.organisationId, organisationId),
        eq(clientPulseChurnAssessments.subaccountId, subaccountId),
      ),
    )
    .orderBy(desc(clientPulseChurnAssessments.observedAt))
    .limit(1);
  const [snapshot] = await db
    .select({ score: clientPulseHealthSnapshots.score })
    .from(clientPulseHealthSnapshots)
    .where(
      and(
        eq(clientPulseHealthSnapshots.organisationId, organisationId),
        eq(clientPulseHealthSnapshots.subaccountId, subaccountId),
      ),
    )
    .orderBy(desc(clientPulseHealthSnapshots.observedAt))
    .limit(1);

  // Include timestamp in idempotency key so each manual operator submission
  // creates a fresh action (operators may propose the same action type
  // multiple times, e.g. different contacts for crm.send_email).
  const idempotencyKey = createHash('sha256')
    .update(
      `operator:${subaccountId}:${input.actionType}:${JSON.stringify(input.payload)}:${Date.now()}`,
    )
    .digest('hex')
    .slice(0, 40);

  // Build typed metadata and validate against the Phase 4 contract before
  // write — prevents implicit schema creep on actions.metadataJson.
  const metadata = validateInterventionActionMetadata({
    triggerTemplateSlug: input.templateSlug ?? null,
    triggerReason: input.rationale,
    bandAtProposal: assessment?.band ?? null,
    healthScoreAtProposal: snapshot?.score ?? null,
    configVersion: assessment?.configVersion ?? null,
    recommendedBy: 'operator_manual',
    operatorRationale: input.rationale,
    scheduleHint: input.scheduleHint ?? 'immediate',
  });

  // scheduleHint is merged into payload so the CRM adapter can read it at
  // execution time.
  const payloadWithSchedule = { ...input.payload, scheduleHint: input.scheduleHint ?? 'immediate' };
  const enqueued = await enqueueInterventionProposal({
    organisationId,
    subaccountId,
    agentId: agentRow.id,
    actionType: input.actionType,
    idempotencyKey,
    payload: payloadWithSchedule,
    metadata,
    reviewReasoning: input.rationale,
  });

  if (!enqueued.isNew) {
    logger.info('clientpulse.intervention.operator_proposal_deduped', {
      organisationId,
      subaccountId,
      actionType: input.actionType,
      existingActionId: enqueued.actionId,
    });
  }

  return { id: enqueued.actionId, actionType: input.actionType, isNew: enqueued.isNew };
}

/**
 * Shared helper used by both the operator-driven path and the scenario-
 * detector job: routes an intervention proposal through `actionService`
 * (idempotent dedup + state transition + suspendUntil bookkeeping) and
 * creates the matching `review_items` row so operators see it in the
 * review queue. Centralising this lifecycle here means automated and
 * manual proposals always traverse the same gates.
 *
 * Caller has already:
 *   - validated the payload against `actionRegistry.parameterSchema`
 *   - validated the metadata via `validateInterventionActionMetadata`
 *   - computed an `idempotencyKey`
 *
 * Returns `{ actionId, isNew }` so callers can distinguish a fresh
 * proposal from a dedup hit. When `isNew=false`, the review item is NOT
 * re-created (it either already exists or the action is past pending).
 */
export async function enqueueInterventionProposal(params: {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  actionType: InterventionActionType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  reviewReasoning: string;
}): Promise<{ actionId: string; isNew: boolean }> {
  const proposed = await actionService.proposeAction({
    organisationId: params.organisationId,
    subaccountId: params.subaccountId,
    agentId: params.agentId,
    actionType: params.actionType,
    idempotencyKey: params.idempotencyKey,
    payload: params.payload,
    metadata: params.metadata,
  });

  if (!proposed.isNew) {
    return { actionId: proposed.actionId, isNew: false };
  }

  const actionRow = await actionService.getAction(proposed.actionId, params.organisationId);
  await reviewService.createReviewItem(actionRow, {
    actionType: params.actionType,
    reasoning: params.reviewReasoning,
    proposedPayload: params.payload,
  });
  return { actionId: proposed.actionId, isNew: true };
}
