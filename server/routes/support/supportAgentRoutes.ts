import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { canonicalInboxes } from '../../db/schema/index.js';
import { SupportInboxAgentConfigSchema } from '../../../shared/types/supportInboxAgentConfig.js';
import { validatePromptOverride } from '../../services/promptOverridePure.js';
import type { PrincipalContext } from '../../services/principal/types.js';

const router = Router();

function makePrincipal(req: Express.Request & { user?: import('../../middleware/auth.js').JwtPayload; orgId?: string }): PrincipalContext {
  return {
    type: 'user',
    id: req.user!.id,
    organisationId: req.orgId!,
    subaccountId: null,
    teamIds: [],
  };
}

// GET /api/support/agent/dashboard
// Returns per-inbox mode + MVP-stub counts for the Support Agent dashboard.
router.get(
  '/agent/dashboard',
  authenticate,
  requireOrgPermission('support.inbox.view'),
  asyncHandler(async (req, res) => {
    const principal = makePrincipal(req);
    const db = getOrgScopedDb('supportAgentRoutes.dashboard');

    const rows = await db
      .select({
        id: canonicalInboxes.id,
        name: canonicalInboxes.name,
        agentConfig: canonicalInboxes.agentConfig,
      })
      .from(canonicalInboxes)
      .where(
        and(
          eq(canonicalInboxes.organisationId, principal.organisationId),
          eq(canonicalInboxes.isActive, true),
        ),
      )
      .orderBy(canonicalInboxes.createdAt);

    const inboxes = rows.map((r) => ({
      inboxId: r.id,
      inboxName: r.name,
      mode: r.agentConfig.mode,
      draftsPending: 0,
      sentToday: 0,
      escalations: 0,
      evalDriftStatus: 'green' as const,
    }));

    res.json({ inboxes });
  }),
);

// PATCH /api/support/inboxes/:inboxId/agent-config
// Merges a partial SupportInboxAgentConfig update into the existing config.
router.patch(
  '/inboxes/:inboxId/agent-config',
  authenticate,
  requireOrgPermission('support.inbox.configure'),
  asyncHandler(async (req, res) => {
    const principal = makePrincipal(req);
    const { inboxId } = req.params;
    const db = getOrgScopedDb('supportAgentRoutes.patchAgentConfig');

    const [existing] = await db
      .select({ id: canonicalInboxes.id, agentConfig: canonicalInboxes.agentConfig })
      .from(canonicalInboxes)
      .where(
        and(
          eq(canonicalInboxes.id, inboxId),
          eq(canonicalInboxes.organisationId, principal.organisationId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'support.inbox.not_found' });
      return;
    }

    const patch = req.body as Record<string, unknown>;

    // Validate promptOverride before merging if provided.
    if (typeof patch.promptOverride === 'string') {
      const check = validatePromptOverride(patch.promptOverride);
      if (!check.valid) {
        res.status(422).json({ error: check.reason, errorCode: 'prompt_override_invalid' });
        return;
      }
    }

    // Deep-merge nested objects so a partial PATCH (e.g. only collisionWindow.respectHumanAssignee)
    // does not discard sibling fields that the client did not send.
    const existingConfig = existing.agentConfig as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existingConfig, ...patch };
    const NESTED_KEYS = ['collisionWindow', 'draftExpiry', 'optIns'] as const;
    for (const key of NESTED_KEYS) {
      if (patch[key] != null && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
        merged[key] = { ...(existingConfig[key] as object), ...(patch[key] as object) };
      }
    }

    let parsedConfig;
    try {
      parsedConfig = SupportInboxAgentConfigSchema.parse(merged);
    } catch {
      res.status(422).json({ error: 'support.inbox.agent_config_invalid', errorCode: 'agent_config_invalid' });
      return;
    }

    const [updated] = await db
      .update(canonicalInboxes)
      .set({ agentConfig: parsedConfig, updatedAt: new Date() })
      .where(
        and(
          eq(canonicalInboxes.id, inboxId),
          eq(canonicalInboxes.organisationId, principal.organisationId),
        ),
      )
      .returning();

    res.json({ inbox: { id: updated.id, agentConfig: updated.agentConfig } });
  }),
);

export default router;
