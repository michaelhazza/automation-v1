/**
 * configUpdateOrganisationService — orchestration for the Configuration
 * Agent's write path. Closes ship-gates B3 (config_history audit with
 * change_source='config_agent') and B5 (sensitive-path routing through
 * action→review queue).
 *
 * Session 1 renamed this service from `configUpdateHierarchyTemplateService`
 * and retargeted the writer at `organisations.operational_config_override`
 * per contract (h) — the organisation is now the single org-owned source of
 * truth for operational-config overrides.
 *
 * Flow:
 *   1. Load the org's current operational_config_override (+ applied system
 *      template's defaults).
 *   2. Deep-merge the proposed patch against the override layer.
 *   3. Validate the full merged config (schema + sum constraints).
 *   4. Classify the path: sensitive vs non-sensitive (spec §3.6 / contract (n)).
 *   5. Non-sensitive → direct merge into operational_config_override +
 *                      config_history row (change_source='config_agent',
 *                      entity_type='organisation_operational_config').
 *      Sensitive     → insert `actions` row with gateLevel='review',
 *                      status='proposed'. Operator approves; approval-execute
 *                      handler re-runs 1–3 and then commits the merge + writes
 *                      config_history.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations } from '../db/schema/organisations.js';
import { systemHierarchyTemplates } from '../db/schema/systemHierarchyTemplates.js';
import { actions } from '../db/schema/actions.js';
import { agents } from '../db/schema/agents.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { configHistoryService } from './configHistoryService.js';
import { actionService } from './actionService.js';
import { reviewService } from './reviewService.js';
import {
  applyPathPatch,
  classifyWritePath,
  validateProposedConfig,
  validationDigest,
  buildConfigHistorySnapshotShape,
  isValidConfigPath,
} from './configUpdateOrganisationConfigPure.js';
import { resolveEffectiveOperationalConfig } from './orgOperationalConfigMigrationPure.js';
import { createHash } from 'crypto';

/**
 * Resolve the org's Portfolio Health agent id — used by sensitive-path
 * enqueue for the `agentId` FK. Returns null when the system agent is not
 * yet linked (e.g. org hasn't applied the ClientPulse template).
 */
export async function resolvePortfolioHealthAgentId(
  organisationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .innerJoin(systemAgents, and(eq(agents.systemAgentId, systemAgents.id), isNull(systemAgents.deletedAt)))
    .where(and(eq(agents.organisationId, organisationId), eq(systemAgents.slug, 'portfolio-health-agent')))
    .limit(1);
  return row?.id ?? null;
}

export interface ConfigUpdateInput {
  organisationId: string;
  path: string;
  value: unknown;
  reason: string;
  sourceSession?: string | null;
  /** User ID making the change (change_source='config_agent', but changedBy still set). */
  changedByUserId?: string | null;
  /** Agent ID used when enqueueing a sensitive-path review action. */
  agentId?: string;
}

export type ConfigUpdateResult =
  | {
      committed: true;
      configHistoryVersion: number;
      path: string;
      classification: 'non_sensitive';
    }
  | {
      committed: false;
      actionId: string;
      classification: 'sensitive';
      requiresApproval: true;
    }
  | {
      committed: false;
      errorCode:
        | 'SCHEMA_INVALID'
        | 'SUM_CONSTRAINT_VIOLATED'
        | 'ORGANISATION_NOT_FOUND'
        | 'AGENT_REQUIRED_FOR_SENSITIVE'
        | 'INVALID_PATH';
      message: string;
    };

/**
 * Apply a single dot-path/value patch to the caller's organisation's
 * operational_config_override. Non-sensitive paths commit inline; sensitive
 * paths route through the review queue.
 */
export async function applyOrganisationConfigUpdate(
  input: ConfigUpdateInput,
): Promise<ConfigUpdateResult> {
  if (!isValidConfigPath(input.path)) {
    return {
      committed: false,
      errorCode: 'INVALID_PATH',
      message: `Unknown config path root: '${input.path.split('.')[0]}'. See ALLOWED_CONFIG_ROOT_KEYS.`,
    };
  }

  const [org] = await db
    .select({
      id: organisations.id,
      operationalConfigOverride: organisations.operationalConfigOverride,
      appliedSystemTemplateId: organisations.appliedSystemTemplateId,
    })
    .from(organisations)
    .where(eq(organisations.id, input.organisationId))
    .limit(1);

  if (!org) {
    return {
      committed: false,
      errorCode: 'ORGANISATION_NOT_FOUND',
      message: `organisation ${input.organisationId} not found`,
    };
  }

  // Load system defaults so validation runs against the effective config
  // (defaults deep-merged with override). Absent system template → {}.
  let systemDefaults: Record<string, unknown> = {};
  if (org.appliedSystemTemplateId) {
    const [sys] = await db
      .select({ defaults: systemHierarchyTemplates.operationalDefaults })
      .from(systemHierarchyTemplates)
      .where(eq(systemHierarchyTemplates.id, org.appliedSystemTemplateId))
      .limit(1);
    systemDefaults = (sys?.defaults as Record<string, unknown>) ?? {};
  }

  const currentOverride = (org.operationalConfigOverride as Record<string, unknown>) ?? {};
  const proposedOverride = applyPathPatch(currentOverride, { path: input.path, value: input.value });
  const proposedEffective = resolveEffectiveOperationalConfig(systemDefaults, proposedOverride);

  const validation = validateProposedConfig(proposedEffective);
  if (!validation.ok) {
    return {
      committed: false,
      errorCode: validation.errorCode!,
      message: validation.message ?? 'validation failed',
    };
  }

  const classification = classifyWritePath(input.path);

  if (classification === 'sensitive') {
    if (!input.agentId) {
      return {
        committed: false,
        errorCode: 'AGENT_REQUIRED_FOR_SENSITIVE',
        message: 'agentId is required to enqueue sensitive-path review',
      };
    }
    const digest = validationDigest(proposedEffective);
    const idempotencyKey = createHash('sha256')
      .update(`config_update:${input.organisationId}:${input.path}:${digest}`)
      .digest('hex')
      .slice(0, 40);

    let reviewProposal: Awaited<ReturnType<typeof actionService.proposeAction>>;
    try {
      reviewProposal = await actionService.proposeAction({
        organisationId: input.organisationId,
        subaccountId: null,
        agentId: input.agentId!,
        actionType: 'config_update_organisation_config',
        idempotencyKey,
        payload: {
          path: input.path,
          value: input.value,
          reason: input.reason,
          sourceSession: input.sourceSession ?? null,
        },
        metadata: {
          sensitivePath: true,
          classification: 'sensitive',
          sourceSession: input.sourceSession ?? null,
          validationDigest: digest,
          recommendedBy: 'config_agent',
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const [existing] = await db
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.organisationId, input.organisationId),
              eq(actions.idempotencyKey, idempotencyKey),
              eq(actions.actionScope, 'org'),
            ),
          )
          .limit(1);
        if (existing) {
          return {
            committed: false,
            actionId: existing.id,
            classification: 'sensitive',
            requiresApproval: true,
          };
        }
      }
      throw err;
    }

    if (!reviewProposal.isNew) {
      return {
        committed: false,
        actionId: reviewProposal.actionId,
        classification: 'sensitive',
        requiresApproval: true,
      };
    }

    const actionRow = await actionService.getAction(reviewProposal.actionId, input.organisationId);
    await reviewService.createReviewItem(actionRow, {
      actionType: 'config_update_organisation_config',
      reasoning: `Sensitive config path: ${input.path}. Reason: ${input.reason}`,
      proposedPayload: {
        path: input.path,
        value: input.value,
        reason: input.reason,
      },
    });

    return {
      committed: false,
      actionId: reviewProposal.actionId,
      classification: 'sensitive',
      requiresApproval: true,
    };
  }

  // Non-sensitive: write the override + record history atomically.
  const version = await commitOverrideAndRecordHistory({
    organisationId: input.organisationId,
    proposedOverride,
    path: input.path,
    reason: input.reason,
    sourceSession: input.sourceSession,
    changedByUserId: input.changedByUserId ?? null,
  });

  return {
    committed: true,
    configHistoryVersion: version,
    path: input.path,
    classification: 'non_sensitive',
  };
}

/**
 * Approval-execute handler — runs when a sensitive-path action reaches
 * status=approved. Re-loads the current override, re-validates (drift check),
 * and if valid, commits the merge + writes config_history.
 */
export async function executeApprovedOrganisationConfigUpdate(params: {
  actionId: string;
  organisationId: string;
}): Promise<
  | { success: true; configHistoryVersion: number }
  | { success: false; errorCode: string; message: string }
> {
  const [action] = await db
    .select({
      id: actions.id,
      payloadJson: actions.payloadJson,
      metadataJson: actions.metadataJson,
    })
    .from(actions)
    .where(
      and(eq(actions.id, params.actionId), eq(actions.organisationId, params.organisationId)),
    )
    .limit(1);
  if (!action) {
    return { success: false, errorCode: 'ACTION_NOT_FOUND', message: 'action missing' };
  }
  const payload = action.payloadJson as {
    path: string;
    value: unknown;
    reason: string;
    sourceSession?: string | null;
  };
  const originalDigest = (action.metadataJson as { validationDigest?: string } | null)?.validationDigest;

  const [org] = await db
    .select({
      id: organisations.id,
      operationalConfigOverride: organisations.operationalConfigOverride,
      appliedSystemTemplateId: organisations.appliedSystemTemplateId,
    })
    .from(organisations)
    .where(eq(organisations.id, params.organisationId))
    .limit(1);
  if (!org) {
    return { success: false, errorCode: 'ORGANISATION_NOT_FOUND', message: 'organisation gone' };
  }

  let systemDefaults: Record<string, unknown> = {};
  if (org.appliedSystemTemplateId) {
    const [sys] = await db
      .select({ defaults: systemHierarchyTemplates.operationalDefaults })
      .from(systemHierarchyTemplates)
      .where(eq(systemHierarchyTemplates.id, org.appliedSystemTemplateId))
      .limit(1);
    systemDefaults = (sys?.defaults as Record<string, unknown>) ?? {};
  }

  const currentOverride = (org.operationalConfigOverride as Record<string, unknown>) ?? {};
  const proposedOverride = applyPathPatch(currentOverride, { path: payload.path, value: payload.value });
  const proposedEffective = resolveEffectiveOperationalConfig(systemDefaults, proposedOverride);
  const validation = validateProposedConfig(proposedEffective);
  if (!validation.ok) {
    return { success: false, errorCode: validation.errorCode!, message: validation.message ?? 'failed' };
  }
  const currentDigest = validationDigest(proposedEffective);
  if (originalDigest && originalDigest !== currentDigest) {
    return {
      success: false,
      errorCode: 'DRIFT_DETECTED',
      message: `config drifted between proposal and approval (${originalDigest} → ${currentDigest})`,
    };
  }

  const version = await commitOverrideAndRecordHistory({
    organisationId: params.organisationId,
    proposedOverride,
    path: payload.path,
    reason: payload.reason,
    sourceSession: payload.sourceSession,
    changedByUserId: null,
  });

  return { success: true, configHistoryVersion: version };
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function commitOverrideAndRecordHistory(p: {
  organisationId: string;
  proposedOverride: Record<string, unknown>;
  path: string;
  reason: string;
  sourceSession?: string | null;
  changedByUserId: string | null;
}): Promise<number> {
  let createdVersion = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(organisations)
      .set({ operationalConfigOverride: p.proposedOverride, updatedAt: new Date() })
      .where(eq(organisations.id, p.organisationId));

    const snap = buildConfigHistorySnapshotShape({
      proposedConfig: p.proposedOverride,
      path: p.path,
      reason: p.reason,
      sourceSession: p.sourceSession,
    });
    // recordHistory returns the version it wrote — eliminates the redundant
    // SELECT MAX(version) round-trip (Session 2 §11.4.2).
    createdVersion = await configHistoryService.recordHistory(
      {
        entityType: 'organisation_operational_config',
        entityId: p.organisationId,
        organisationId: p.organisationId,
        snapshot: snap.snapshot,
        changedBy: p.changedByUserId,
        changeSource: 'config_agent',
        sessionId: p.sourceSession ?? null,
        changeSummary: snap.changeSummary,
      },
      tx as unknown as Parameters<typeof configHistoryService.recordHistory>[1],
    );
  });
  return createdVersion;
}

/**
 * Detect Postgres unique-violation (SQLSTATE 23505) from a caught error.
 * Lets the sensitive-path write recover from a concurrent double-insert that
 * the partial unique index `actions_org_idempotency_idx` would reject.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}
