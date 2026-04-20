/**
 * organisationConfig — platform-generic organisation-scoped operational-config
 * surface. Any module's settings UI (ClientPulse Settings today; future SEO
 * Settings, Content Settings, etc.) converges here.
 *
 * Session 1 / contracts (i), (j), (t) — spec §4.1–§4.5:
 *   POST /api/organisation/config/apply  — single dot-path write
 *   GET  /api/organisation/config        — current effective + raw override
 *
 * Replaces the retired POST /api/clientpulse/config/apply per spec §4.2.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { organisations } from '../db/schema/organisations.js';
import { systemHierarchyTemplates } from '../db/schema/systemHierarchyTemplates.js';
import {
  applyOrganisationConfigUpdate,
  resolvePortfolioHealthAgentId,
} from '../services/configUpdateOrganisationService.js';
import { resolveEffectiveOperationalConfig } from '../services/orgOperationalConfigMigrationPure.js';

const router = Router();

// Spec §4.4 — min(1) guards against empty-string payloads; max caps bound
// operator error at the wire.
const applyBodySchema = z.object({
  path: z.string().min(1).max(500),
  value: z.unknown(),
  reason: z.string().min(1).max(5_000),
  sessionId: z.string().uuid().optional(),
});

router.post(
  '/api/organisation/config/apply',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }

    const agentId = (await resolvePortfolioHealthAgentId(orgId)) ?? undefined;

    const result = await applyOrganisationConfigUpdate({
      organisationId: orgId,
      path: parsed.data.path,
      value: parsed.data.value,
      reason: parsed.data.reason,
      sourceSession: parsed.data.sessionId ?? null,
      changedByUserId: req.user?.id ?? null,
      agentId,
    });

    res.json(result);
  }),
);

// Spec §4.5 — symmetrical read endpoint for the Settings UI.
router.get(
  '/api/organisation/config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const [org] = await db
      .select({
        override: organisations.operationalConfigOverride,
        appliedTemplateId: organisations.appliedSystemTemplateId,
      })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .limit(1);

    if (!org) {
      throw { statusCode: 404, message: 'Organisation not found', errorCode: 'ORG_NOT_FOUND' };
    }

    let systemDefaults: Record<string, unknown> | null = null;
    let appliedSystemTemplateName: string | null = null;
    if (org.appliedTemplateId) {
      const [sys] = await db
        .select({
          defaults: systemHierarchyTemplates.operationalDefaults,
          name: systemHierarchyTemplates.name,
        })
        .from(systemHierarchyTemplates)
        .where(eq(systemHierarchyTemplates.id, org.appliedTemplateId))
        .limit(1);
      systemDefaults = (sys?.defaults as Record<string, unknown> | undefined) ?? null;
      appliedSystemTemplateName = sys?.name ?? null;
    }

    const overrides = (org.override as Record<string, unknown> | null) ?? null;
    const effective = resolveEffectiveOperationalConfig(systemDefaults, overrides);

    res.json({
      effective,
      overrides,
      systemDefaults,
      appliedSystemTemplateId: org.appliedTemplateId ?? null,
      appliedSystemTemplateName,
    });
  }),
);

export default router;
