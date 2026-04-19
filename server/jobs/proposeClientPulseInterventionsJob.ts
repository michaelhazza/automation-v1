/**
 * proposeClientPulseInterventionsJob — scenario-detector worker.
 *
 * Event-driven: enqueued at the tail of `compute_churn_risk` per sub-account.
 * For each tick, loads the latest churn assessment + health snapshot + the
 * org's intervention-template catalogue + cooldown + quota state, then
 * delegates to `proposeClientPulseInterventionsPure`. Every returned proposal
 * is written as an `actions` row with `gateLevel='review'` (locked contract
 * (b)).
 *
 * Queue: `clientpulse:propose-interventions`.
 */

import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions } from '../db/schema/actions.js';
import { agents } from '../db/schema/agents.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
} from '../db/schema/clientPulseCanonicalTables.js';
import { orgConfigService } from '../services/orgConfigService.js';
import { interventionService } from '../services/interventionService.js';
import {
  proposeClientPulseInterventionsPure,
  type ProposerCooldownState,
  type ProposerSnapshot,
} from '../services/clientPulseInterventionProposerPure.js';
import { logger } from '../lib/logger.js';
import { createHash } from 'crypto';

export interface ProposeClientPulseInterventionsJobData {
  organisationId: string;
  subaccountId: string;
  churnAssessmentId?: string;
}

export interface ProposeClientPulseInterventionsJobSummary {
  proposalsCreated: number;
  proposalsSuppressed: number;
  skipped: boolean;
  reason?: string;
}

const SCENARIO_DETECTOR_SYSTEM_AGENT_SLUG = 'portfolio-health-agent';

export async function runProposeClientPulseInterventions(
  data: ProposeClientPulseInterventionsJobData,
): Promise<ProposeClientPulseInterventionsJobSummary> {
  const { organisationId, subaccountId } = data;

  // 1. Load the latest churn assessment + health snapshot.
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

  if (!assessment) {
    return { proposalsCreated: 0, proposalsSuppressed: 0, skipped: true, reason: 'no_churn_assessment' };
  }

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

  // 2. Load templates + defaults + account override.
  const templates = await orgConfigService.getInterventionTemplates(organisationId);
  if (templates.length === 0) {
    return { proposalsCreated: 0, proposalsSuppressed: 0, skipped: true, reason: 'no_templates' };
  }

  const defaults = await orgConfigService.getInterventionDefaults(organisationId);

  const accountOverride = assessment.accountId
    ? await interventionService.getAccountOverride(organisationId, assessment.accountId)
    : null;

  // 3. Cooldown state — one check per template against the account+template.
  const cooldownState: ProposerCooldownState = { perTemplate: {} };
  if (assessment.accountId) {
    for (const template of templates) {
      const check = await interventionService.checkCooldown(
        organisationId,
        assessment.accountId,
        template.slug,
        template,
      );
      cooldownState.perTemplate[template.slug] = {
        allowed: check.allowed,
        reason: check.reason,
      };
    }
  }

  // 4. Quota state — count actions proposed in the rolling 24h window for this
  // subaccount and across the org.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [subaccountCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        eq(actions.subaccountId, subaccountId),
        sql`${actions.actionType} IN ('crm.fire_automation','crm.send_email','crm.send_sms','crm.create_task','clientpulse.operator_alert')`,
        gte(actions.createdAt, since),
      ),
    );

  const [orgCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        sql`${actions.actionType} IN ('crm.fire_automation','crm.send_email','crm.send_sms','crm.create_task','clientpulse.operator_alert')`,
        gte(actions.createdAt, since),
      ),
    );

  // 5. Call the pure proposer.
  const snapshotInput: ProposerSnapshot = {
    healthScore: snapshot?.score ?? assessment.riskScore,
    band: assessment.band,
    configVersion: assessment.configVersion ?? null,
  };

  const result = proposeClientPulseInterventionsPure({
    templates,
    snapshot: snapshotInput,
    cooldownState,
    quotaState: {
      dayCountPerSubaccount: subaccountCount?.count ?? 0,
      dayCountPerOrg: orgCount?.count ?? 0,
      maxPerSubaccount: defaults.maxProposalsPerDayPerSubaccount,
      maxPerOrg: defaults.maxProposalsPerDayPerOrg,
    },
    accountOverride: accountOverride
      ? { suppressAlerts: accountOverride.suppressAlerts ?? false }
      : undefined,
  });

  // 6. Emit each proposal as an `actions` row.
  if (result.proposals.length === 0) {
    logger.info('proposeClientPulseInterventions.no_proposals', {
      organisationId,
      subaccountId,
      suppressed: result.suppressed,
    });
    return { proposalsCreated: 0, proposalsSuppressed: result.suppressed.length, skipped: false };
  }

  const scenarioAgentId = await resolveScenarioDetectorAgentId(organisationId);
  if (!scenarioAgentId) {
    logger.warn('proposeClientPulseInterventions.no_agent', { organisationId, subaccountId });
    return { proposalsCreated: 0, proposalsSuppressed: result.suppressed.length, skipped: true, reason: 'no_scenario_agent' };
  }

  let created = 0;
  for (const proposal of result.proposals) {
    const idempotencyKey = buildProposalIdempotencyKey({
      subaccountId,
      templateSlug: proposal.templateSlug,
      churnAssessmentId: data.churnAssessmentId ?? assessment.id,
    });

    try {
      await db
        .insert(actions)
        .values({
          organisationId,
          subaccountId,
          agentId: scenarioAgentId,
          actionScope: 'subaccount',
          actionType: proposal.actionType,
          actionCategory: proposal.actionType === 'clientpulse.operator_alert' ? 'worker' : 'api',
          isExternal: proposal.actionType !== 'clientpulse.operator_alert',
          gateLevel: 'review',
          status: 'proposed',
          idempotencyKey,
          payloadJson: proposal.payload,
          metadataJson: {
            triggerTemplateSlug: proposal.templateSlug,
            triggerReason: proposal.reason,
            bandAtProposal: assessment.band,
            healthScoreAtProposal: snapshot?.score ?? assessment.riskScore,
            configVersion: assessment.configVersion ?? null,
            recommendedBy: 'scenario_detector',
            churnAssessmentId: data.churnAssessmentId ?? assessment.id,
            priority: proposal.priority,
          },
        })
        .onConflictDoNothing({ target: [actions.subaccountId, actions.idempotencyKey] });
      created += 1;
    } catch (err) {
      logger.error('proposeClientPulseInterventions.insert_failed', {
        organisationId,
        subaccountId,
        templateSlug: proposal.templateSlug,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    proposalsCreated: created,
    proposalsSuppressed: result.suppressed.length,
    skipped: false,
  };
}

function buildProposalIdempotencyKey(p: {
  subaccountId: string;
  templateSlug: string;
  churnAssessmentId: string;
}): string {
  const raw = `clientpulse:intervention:${p.subaccountId}:${p.templateSlug}:${p.churnAssessmentId}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

async function resolveScenarioDetectorAgentId(organisationId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .innerJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
    .where(
      and(
        eq(agents.organisationId, organisationId),
        eq(systemAgents.slug, SCENARIO_DETECTOR_SYSTEM_AGENT_SLUG),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
