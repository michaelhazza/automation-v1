import { Router } from 'express';
import { z } from 'zod';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { actions } from '../db/schema/actions.js';
import { subaccounts } from '../db/schema/subaccounts.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
} from '../db/schema/clientPulseCanonicalTables.js';
import { orgConfigService } from '../services/orgConfigService.js';
import { interventionService } from '../services/interventionService.js';
import { agents } from '../db/schema/agents.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { createHash } from 'crypto';

const router = Router();

const INTERVENTION_ACTION_TYPES = [
  'crm.fire_automation',
  'crm.send_email',
  'crm.send_sms',
  'crm.create_task',
  'clientpulse.operator_alert',
] as const;

const PROPOSER_AGENT_SLUG = 'portfolio-health-agent';

// ── GET /api/clientpulse/subaccounts/:subaccountId/intervention-context ──
// Returns the payload the ProposeInterventionModal consumes (band, top
// signals, intervention history, cooldown hints, primary contact stub,
// recommendedActionType).
router.get(
  '/api/clientpulse/subaccounts/:subaccountId/intervention-context',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const subaccountId = req.params.subaccountId;

    const [sub] = await db
      .select({ id: subaccounts.id, name: subaccounts.name })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, orgId)))
      .limit(1);
    if (!sub) throw { statusCode: 404, message: 'Subaccount not found' };

    const [snapshot] = await db
      .select()
      .from(clientPulseHealthSnapshots)
      .where(
        and(
          eq(clientPulseHealthSnapshots.organisationId, orgId),
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
          eq(clientPulseChurnAssessments.organisationId, orgId),
          eq(clientPulseChurnAssessments.subaccountId, subaccountId),
        ),
      )
      .orderBy(desc(clientPulseChurnAssessments.observedAt))
      .limit(1);

    // 7-day-ago snapshot for delta
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [prior] = await db
      .select({ score: clientPulseHealthSnapshots.score })
      .from(clientPulseHealthSnapshots)
      .where(
        and(
          eq(clientPulseHealthSnapshots.organisationId, orgId),
          eq(clientPulseHealthSnapshots.subaccountId, subaccountId),
          sql`${clientPulseHealthSnapshots.observedAt} < ${weekAgo}`,
        ),
      )
      .orderBy(desc(clientPulseHealthSnapshots.observedAt))
      .limit(1);

    // Recent intervention history
    const recentInterventions = await db
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
          eq(actions.organisationId, orgId),
          eq(actions.subaccountId, subaccountId),
          inArray(actions.actionType, [...INTERVENTION_ACTION_TYPES]),
        ),
      )
      .orderBy(desc(actions.createdAt))
      .limit(10);

    // Cooldown state — if any intervention is in cooldown, block new proposals.
    const cooldownState = { blocked: false as boolean, reason: undefined as string | undefined };
    if (assessment?.accountId) {
      const templates = await orgConfigService.getInterventionTemplates(orgId);
      for (const template of templates) {
        const check = await interventionService.checkCooldown(orgId, assessment.accountId, template.slug, template);
        if (!check.allowed) {
          cooldownState.blocked = true;
          cooldownState.reason = check.reason;
          break;
        }
      }
    }

    // Recommended action type — if assessment suggests an intervention type
    // that maps to one of our 5 primitives, surface that.
    const recommendedActionType = (() => {
      const type = assessment?.interventionType;
      if (!type) return null;
      const templates = [];
      // Template-slug → actionType lookup comes from org config.
      return null; // V1: left null; the editor lets operator pick. Stub.
    })();

    res.json({
      subaccount: { id: sub.id, name: sub.name },
      band: assessment?.band ?? null,
      healthScore: snapshot?.score ?? null,
      healthScoreDelta7d: snapshot?.score != null && prior?.score != null ? snapshot.score - prior.score : null,
      topSignals: (assessment?.drivers ?? []).slice(0, 5),
      recentInterventions: recentInterventions.map((a) => ({
        id: a.id,
        actionType: a.actionType,
        status: a.status,
        occurredAt: a.executedAt ?? a.createdAt,
        templateSlug: (a.metadataJson as Record<string, unknown> | null)?.triggerTemplateSlug ?? null,
      })),
      cooldownState,
      recommendedActionType,
    });
  }),
);

// ── POST /api/clientpulse/subaccounts/:subaccountId/interventions/propose ──
// Operator-driven proposal path (§10.D editors call this on submit).
// Writes an `actions` row with `gateLevel='review'` + the Phase 4 metadata
// schema from locked contract (b).
const proposeBodySchema = z.object({
  actionType: z.enum(INTERVENTION_ACTION_TYPES),
  payload: z.record(z.unknown()),
  scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).optional(),
  rationale: z.string().min(1).max(5_000),
  templateSlug: z.string().optional(),
});

router.post(
  '/api/clientpulse/subaccounts/:subaccountId/interventions/propose',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const subaccountId = req.params.subaccountId;

    const parsed = proposeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }

    const [sub] = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, orgId)))
      .limit(1);
    if (!sub) throw { statusCode: 404, message: 'Subaccount not found' };

    // Per-org + per-subaccount quota check.
    const defaults = await orgConfigService.getInterventionDefaults(orgId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [subCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(actions)
      .where(
        and(
          eq(actions.organisationId, orgId),
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
          eq(actions.organisationId, orgId),
          inArray(actions.actionType, [...INTERVENTION_ACTION_TYPES]),
          sql`${actions.createdAt} >= ${since}`,
        ),
      );
    if ((orgCount?.count ?? 0) >= defaults.maxProposalsPerDayPerOrg) {
      throw { statusCode: 429, message: 'org-day quota exceeded', errorCode: 'QUOTA_EXCEEDED' };
    }

    // Resolve the scenario-detector agent for this org so the action row
    // has a valid agentId FK.
    const [agentRow] = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
      .where(and(eq(agents.organisationId, orgId), eq(systemAgents.slug, PROPOSER_AGENT_SLUG)))
      .limit(1);
    if (!agentRow) {
      throw { statusCode: 409, message: 'Portfolio Health Agent not linked to this org', errorCode: 'AGENT_MISSING' };
    }

    // Build the latest band/score for metadata at proposal time.
    const [assessment] = await db
      .select()
      .from(clientPulseChurnAssessments)
      .where(
        and(
          eq(clientPulseChurnAssessments.organisationId, orgId),
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
          eq(clientPulseHealthSnapshots.organisationId, orgId),
          eq(clientPulseHealthSnapshots.subaccountId, subaccountId),
        ),
      )
      .orderBy(desc(clientPulseHealthSnapshots.observedAt))
      .limit(1);

    const idempotencyKey = createHash('sha256')
      .update(
        `operator:${subaccountId}:${parsed.data.actionType}:${JSON.stringify(parsed.data.payload)}:${Date.now()}`,
      )
      .digest('hex')
      .slice(0, 40);

    const [inserted] = await db
      .insert(actions)
      .values({
        organisationId: orgId,
        subaccountId,
        agentId: agentRow.id,
        actionScope: 'subaccount',
        actionType: parsed.data.actionType,
        actionCategory: parsed.data.actionType === 'clientpulse.operator_alert' ? 'worker' : 'api',
        isExternal: parsed.data.actionType !== 'clientpulse.operator_alert',
        gateLevel: 'review',
        status: 'proposed',
        idempotencyKey,
        payloadJson: parsed.data.payload,
        metadataJson: {
          triggerTemplateSlug: parsed.data.templateSlug ?? null,
          triggerReason: parsed.data.rationale,
          bandAtProposal: assessment?.band ?? null,
          healthScoreAtProposal: snapshot?.score ?? null,
          configVersion: assessment?.configVersion ?? null,
          recommendedBy: 'operator_manual',
          operatorRationale: parsed.data.rationale,
          scheduleHint: parsed.data.scheduleHint ?? 'immediate',
        },
      })
      .returning({ id: actions.id, actionType: actions.actionType });

    res.json({ id: inserted.id, actionType: inserted.actionType });
  }),
);

export default router;
