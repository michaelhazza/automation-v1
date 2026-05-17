import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { SupportInboxAgentConfigSchema } from '../../../shared/types/supportInboxAgentConfig.js';
import type { SupportInboxAgentConfig } from '../../../shared/types/supportInboxAgentConfig.js';
import { validatePromptOverride } from '../../services/promptOverridePure.js';
import type { PrincipalContext } from '../../services/principal/types.js';
import { resolveSubaccount } from '../../lib/resolveSubaccount.js';
import { listInboxes, getInboxForOrg, updateAgentConfig, assertInboxScope } from '../../services/supportInboxService.js';
import { mergeAgentConfigPatch } from '../../services/supportInboxConfigMergePure.js';

const router = Router({ mergeParams: true });

async function makePrincipal(req: Express.Request & { user?: import('../../middleware/auth.js').JwtPayload; orgId?: string; params: Record<string, string> }): Promise<PrincipalContext> {
  const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
  return {
    type: 'user',
    id: req.user!.id,
    organisationId: req.orgId!,
    subaccountId: subaccount.id,
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
    const principal = await makePrincipal(req);
    const rows = await listInboxes(principal, { activeOnly: true });
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
    const principal = await makePrincipal(req);
    const { inboxId } = req.params;

    // Load existing by org only (no subaccount filter) so that the subaccount
    // scope enforcement fires here, BEFORE any req.body validation. Sibling-
    // subaccount callers receive 403 regardless of payload validity
    // (SUPPORT-PATCH-SCOPE-ORDER, operator-approved 2026-05-15).
    const existing = await getInboxForOrg(inboxId, principal.organisationId);
    assertInboxScope(existing, principal);

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
    const merged = mergeAgentConfigPatch(existingConfig, patch);

    let parsedConfig: SupportInboxAgentConfig;
    try {
      parsedConfig = SupportInboxAgentConfigSchema.parse(merged);
    } catch {
      res.status(422).json({ error: 'support.inbox.agent_config_invalid', errorCode: 'agent_config_invalid' });
      return;
    }

    const updated = await updateAgentConfig(inboxId, parsedConfig, principal);

    res.json({ inbox: { id: updated.id, agentConfig: updated.agentConfig } });
  }),
);

export default router;
