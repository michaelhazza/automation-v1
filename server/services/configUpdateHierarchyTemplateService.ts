/**
 * configUpdateHierarchyTemplateService — orchestration for the Configuration
 * Agent's write path. Closes ship-gates B3 (config_history audit with
 * change_source='config_agent') and B5 (sensitive-path routing through
 * action→review queue).
 *
 * Flow:
 *   1. Load current operational_config for (organisationId, templateId).
 *   2. Deep-merge the proposed patch.
 *   3. Validate the full merged config (schema + sum constraints).
 *   4. Classify the path: sensitive vs non-sensitive (§17.6.2 gating).
 *   5. Non-sensitive → direct merge + config_history row (change_source='config_agent').
 *      Sensitive     → insert `actions` row with gateLevel='review', status='proposed'.
 *                      Operator approves; approval-execute handler re-runs 1–3
 *                      and then commits the merge + writes config_history.
 */

import { eq, and, max } from 'drizzle-orm';
import { db } from '../db/index.js';
import { hierarchyTemplates } from '../db/schema/hierarchyTemplates.js';
import { actions } from '../db/schema/actions.js';
import { configHistory } from '../db/schema/configHistory.js';
import { configHistoryService } from './configHistoryService.js';
import {
  applyPathPatch,
  classifyWritePath,
  validateProposedConfig,
  validationDigest,
  buildConfigHistorySnapshotShape,
} from './configUpdateHierarchyTemplatePure.js';
import { createHash } from 'crypto';

export interface ConfigUpdateInput {
  organisationId: string;
  templateId: string;
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
      errorCode: 'SCHEMA_INVALID' | 'SUM_CONSTRAINT_VIOLATED' | 'TEMPLATE_NOT_FOUND' | 'AGENT_REQUIRED_FOR_SENSITIVE';
      message: string;
    };

export async function applyHierarchyTemplateConfigUpdate(
  input: ConfigUpdateInput,
): Promise<ConfigUpdateResult> {
  const [template] = await db
    .select({
      id: hierarchyTemplates.id,
      operationalConfig: hierarchyTemplates.operationalConfig,
    })
    .from(hierarchyTemplates)
    .where(
      and(
        eq(hierarchyTemplates.id, input.templateId),
        eq(hierarchyTemplates.organisationId, input.organisationId),
      ),
    )
    .limit(1);

  if (!template) {
    return {
      committed: false,
      errorCode: 'TEMPLATE_NOT_FOUND',
      message: `hierarchy template ${input.templateId} not found in org ${input.organisationId}`,
    };
  }

  const current = (template.operationalConfig ?? {}) as Record<string, unknown>;
  const proposed = applyPathPatch(current, { path: input.path, value: input.value });

  const validation = validateProposedConfig(proposed);
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
    const digest = validationDigest(proposed);
    const idempotencyKey = createHash('sha256')
      .update(`config_update:${input.templateId}:${input.path}:${digest}`)
      .digest('hex')
      .slice(0, 40);

    const [inserted] = await db
      .insert(actions)
      .values({
        organisationId: input.organisationId,
        subaccountId: null,
        agentId: input.agentId,
        actionScope: 'org',
        actionType: 'config_update_hierarchy_template',
        actionCategory: 'worker',
        isExternal: false,
        gateLevel: 'review',
        status: 'proposed',
        idempotencyKey,
        payloadJson: {
          templateId: input.templateId,
          path: input.path,
          value: input.value,
          reason: input.reason,
          sourceSession: input.sourceSession ?? null,
        },
        metadataJson: {
          sensitivePath: true,
          classification: 'sensitive',
          sourceSession: input.sourceSession ?? null,
          validationDigest: digest,
          recommendedBy: 'config_agent',
        },
      })
      .onConflictDoNothing({ target: [actions.subaccountId, actions.idempotencyKey] })
      .returning({ id: actions.id });

    if (!inserted) {
      // Duplicate — look up the existing row by idempotencyKey.
      const [dup] = await db
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(
            eq(actions.organisationId, input.organisationId),
            eq(actions.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return {
        committed: false,
        actionId: dup?.id ?? '',
        classification: 'sensitive',
        requiresApproval: true,
      };
    }

    return {
      committed: false,
      actionId: inserted.id,
      classification: 'sensitive',
      requiresApproval: true,
    };
  }

  // Non-sensitive path: write directly + record history.
  const version = await commitMergeAndRecordHistory({
    organisationId: input.organisationId,
    templateId: input.templateId,
    proposedConfig: proposed,
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
 * Approval-execute handler: runs when a sensitive-path action lands in
 * status=approved. Re-loads the current config, re-validates (drift check),
 * and if valid, commits the merge + writes config_history.
 */
export async function executeApprovedHierarchyTemplateConfigUpdate(params: {
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
    templateId: string;
    path: string;
    value: unknown;
    reason: string;
    sourceSession?: string | null;
  };
  const originalDigest = (action.metadataJson as { validationDigest?: string } | null)?.validationDigest;

  // Re-load current + re-compute proposed + validate (drift check).
  const [template] = await db
    .select({
      id: hierarchyTemplates.id,
      operationalConfig: hierarchyTemplates.operationalConfig,
    })
    .from(hierarchyTemplates)
    .where(
      and(
        eq(hierarchyTemplates.id, payload.templateId),
        eq(hierarchyTemplates.organisationId, params.organisationId),
      ),
    )
    .limit(1);
  if (!template) {
    return { success: false, errorCode: 'TEMPLATE_NOT_FOUND', message: 'template gone' };
  }
  const current = (template.operationalConfig ?? {}) as Record<string, unknown>;
  const proposed = applyPathPatch(current, { path: payload.path, value: payload.value });
  const validation = validateProposedConfig(proposed);
  if (!validation.ok) {
    return { success: false, errorCode: validation.errorCode!, message: validation.message ?? 'failed' };
  }
  const currentDigest = validationDigest(proposed);
  if (originalDigest && originalDigest !== currentDigest) {
    return {
      success: false,
      errorCode: 'DRIFT_DETECTED',
      message: `config drifted between proposal and approval (${originalDigest} → ${currentDigest})`,
    };
  }

  const version = await commitMergeAndRecordHistory({
    organisationId: params.organisationId,
    templateId: payload.templateId,
    proposedConfig: proposed,
    path: payload.path,
    reason: payload.reason,
    sourceSession: payload.sourceSession,
    changedByUserId: null,
  });

  return { success: true, configHistoryVersion: version };
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function commitMergeAndRecordHistory(p: {
  organisationId: string;
  templateId: string;
  proposedConfig: Record<string, unknown>;
  path: string;
  reason: string;
  sourceSession?: string | null;
  changedByUserId: string | null;
}): Promise<number> {
  // Use a single transaction so the write + history insert are atomic.
  // configHistoryService.recordHistory supports optional tx; we pass ours in.
  let createdVersion = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(hierarchyTemplates)
      .set({ operationalConfig: p.proposedConfig, updatedAt: new Date() })
      .where(
        and(
          eq(hierarchyTemplates.id, p.templateId),
          eq(hierarchyTemplates.organisationId, p.organisationId),
        ),
      );

    const snap = buildConfigHistorySnapshotShape({
      proposedConfig: p.proposedConfig,
      path: p.path,
      reason: p.reason,
      sourceSession: p.sourceSession,
    });
    await configHistoryService.recordHistory(
      {
        entityType: 'clientpulse_operational_config',
        entityId: p.templateId,
        organisationId: p.organisationId,
        snapshot: snap.snapshot,
        changedBy: p.changedByUserId,
        changeSource: 'config_agent',
        sessionId: p.sourceSession ?? null,
        changeSummary: snap.changeSummary,
      },
      tx as unknown as Parameters<typeof configHistoryService.recordHistory>[1],
    );
    const [versionRow] = await tx
      .select({ v: max(configHistory.version) })
      .from(configHistory)
      .where(
        and(
          eq(configHistory.entityType, 'clientpulse_operational_config'),
          eq(configHistory.entityId, p.templateId),
          eq(configHistory.organisationId, p.organisationId),
        ),
      );
    createdVersion = Number(versionRow?.v ?? 0);
  });
  return createdVersion;
}
