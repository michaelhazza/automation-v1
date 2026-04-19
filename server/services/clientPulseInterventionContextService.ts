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
  if (assessment?.accountId) {
    const templates = await orgConfigService.getInterventionTemplates(organisationId);
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
    recommendedActionType: null,
  };
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
}

/**
 * Operator-driven proposal — used by the §10.D editor submit path. Enforces
 * the daily per-subaccount + per-org quotas read from operational_config,
 * then inserts an `actions` row with `gateLevel='review'` and the Phase 4
 * metadata schema (locked contract (b), recommendedBy='operator_manual').
 *
 * Throws `{ statusCode, message, errorCode }` on quota exceeded or when the
 * system Portfolio Health agent is not linked to the org.
 */
export async function createOperatorProposal(
  input: OperatorProposalInput,
): Promise<OperatorProposalResult> {
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

  const idempotencyKey = createHash('sha256')
    .update(
      `operator:${subaccountId}:${input.actionType}:${JSON.stringify(input.payload)}:${Date.now()}`,
    )
    .digest('hex')
    .slice(0, 40);

  const [inserted] = await db
    .insert(actions)
    .values({
      organisationId,
      subaccountId,
      agentId: agentRow.id,
      actionScope: 'subaccount',
      actionType: input.actionType,
      actionCategory: input.actionType === 'clientpulse.operator_alert' ? 'worker' : 'api',
      isExternal: input.actionType !== 'clientpulse.operator_alert',
      gateLevel: 'review',
      status: 'proposed',
      idempotencyKey,
      payloadJson: input.payload,
      metadataJson: {
        triggerTemplateSlug: input.templateSlug ?? null,
        triggerReason: input.rationale,
        bandAtProposal: assessment?.band ?? null,
        healthScoreAtProposal: snapshot?.score ?? null,
        configVersion: assessment?.configVersion ?? null,
        recommendedBy: 'operator_manual',
        operatorRationale: input.rationale,
        scheduleHint: input.scheduleHint ?? 'immediate',
      },
    })
    .returning({ id: actions.id, actionType: actions.actionType });

  return { id: inserted.id, actionType: inserted.actionType };
}
