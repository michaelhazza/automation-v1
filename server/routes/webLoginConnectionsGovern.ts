/**
 * webLoginConnectionsGovern.ts — Govern-surface CRUD routes for web login
 * connections, scoped to subaccounts.
 *
 * operator-session-identity chunk 5.
 *
 * Routes:
 *  POST   /api/subaccounts/:subaccountId/web-login-connections
 *  PATCH  /api/subaccounts/:subaccountId/web-login-connections/:id
 *  POST   /api/subaccounts/:subaccountId/web-login-connections/:id/test
 *  DELETE /api/subaccounts/:subaccountId/web-login-connections/:id
 *
 * These routes complement the existing webLoginConnections.ts routes which
 * serve the portal surface. The Govern surface routes use the same service
 * methods but are gated on CONNECTIONS_MANAGE (subaccount-level).
 *
 * Note: GET routes (list/single) already exist in webLoginConnections.ts and
 * are re-used by the Govern surface without duplication.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireSubaccountPermission, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { webLoginConnectionService } from '../services/webLoginConnectionService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { auditService } from '../services/auditService.js';

const router = Router();

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const webLoginConfigSchema = z.object({
  loginUrl: z.string().url().max(2048),
  contentUrl: z.string().url().max(2048).optional().nullable(),
  username: z.string().min(1).max(256),
  usernameSelector: z.string().max(500).optional().nullable(),
  passwordSelector: z.string().max(500).optional().nullable(),
  submitSelector: z.string().max(500).optional().nullable(),
  successSelector: z.string().max(500).optional().nullable(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional().nullable(),
});

const createBody = z.object({
  label: z.string().min(1).max(100),
  displayName: z.string().max(200).optional(),
  config: webLoginConfigSchema,
  password: z.string().min(1).max(2048),
});

const updateBody = z.object({
  label: z.string().min(1).max(100).optional(),
  displayName: z.string().max(200).optional(),
  config: webLoginConfigSchema.partial().optional(),
  password: z.string().min(1).max(2048).optional(),
  connectionStatus: z.enum(['active', 'error']).optional(),
});

const testSavedBody = z.object({
  agentId: z.string().uuid(),
  subaccountAgentId: z.string().uuid(),
});

// ─── POST create ──────────────────────────────────────────────────────────────

router.post(
  '/api/govern/subaccounts/:subaccountId/web-login-connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = createBody.parse(req.body);

    const created = await webLoginConnectionService.create({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      label: parsed.label,
      displayName: parsed.displayName,
      config: parsed.config,
      password: parsed.password,
    });

    auditService.log({
      organisationId: req.orgId,
      actorId: req.user!.id,
      actorType: 'user',
      action: 'web_login_connection.create',
      entityType: 'integration_connection',
      entityId: created.id,
      metadata: { subaccountId: subaccount.id, label: parsed.label, surface: 'govern' },
    });

    res.status(201).json(created);
  }),
);

// ─── PATCH update ─────────────────────────────────────────────────────────────

router.patch(
  '/api/govern/subaccounts/:subaccountId/web-login-connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = updateBody.parse(req.body);

    const updated = await webLoginConnectionService.update(
      req.params.id,
      req.orgId!,
      subaccount.id,
      {
        label: parsed.label,
        displayName: parsed.displayName,
        config: parsed.config as never,
        password: parsed.password,
        connectionStatus: parsed.connectionStatus,
      },
    );

    if (!updated) {
      res.status(404).json({ error: 'web_login connection not found' });
      return;
    }

    auditService.log({
      organisationId: req.orgId,
      actorId: req.user!.id,
      actorType: 'user',
      action: 'web_login_connection.update',
      entityType: 'integration_connection',
      entityId: updated.id,
      metadata: { passwordRotated: !!parsed.password, subaccountId: subaccount.id, surface: 'govern' },
    });

    res.json(updated);
  }),
);

// ─── POST test ────────────────────────────────────────────────────────────────

router.post(
  '/api/govern/subaccounts/:subaccountId/web-login-connections/:id/test',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const conn = await webLoginConnectionService.getById(req.params.id, req.orgId!, subaccount.id);

    if (!conn) {
      res.status(404).json({ error: 'web_login connection not found' });
      return;
    }
    if (!conn.config) {
      res.status(409).json({ error: 'web_login connection missing config' });
      return;
    }

    const body = testSavedBody.parse(req.body);

    const link = await subaccountAgentService.findLink(body.subaccountAgentId, subaccount.id, body.agentId);
    if (!link) {
      res.status(404).json({ error: 'subaccount_agent_not_found_for_subaccount' });
      return;
    }

    const { agentExecutionService } = await import('../services/agentExecutionService.js');
    const result = await agentExecutionService.executeRun({
      agentId: body.agentId,
      subaccountId: subaccount.id,
      subaccountAgentId: body.subaccountAgentId,
      organisationId: req.orgId!,
      runType: 'manual',
      executionMode: 'iee_browser',
      runSource: 'manual',
      isTestRun: true,
      ieeTask: {
        type: 'browser',
        goal: `Test web_login connection: ${conn.label}`,
        mode: 'login_test',
        webLoginConnectionId: conn.id,
        startUrl: conn.config.contentUrl ?? conn.config.loginUrl,
      },
    });

    auditService.log({
      organisationId: req.orgId!,
      actorId: req.user!.id,
      actorType: 'user',
      action: 'web_login_connection.test.saved',
      entityType: 'integration_connection',
      entityId: conn.id,
      metadata: { ieeRunId: result.ieeRunId, agentRunId: result.runId, scope: 'subaccount', surface: 'govern' },
    });

    res.status(202).json({
      agentRunId: result.runId,
      ieeRunId: result.ieeRunId,
      status: result.status,
      progressUrl: `/api/iee/runs/${result.ieeRunId}/progress`,
    });
  }),
);

// ─── DELETE (revoke) ──────────────────────────────────────────────────────────

router.delete(
  '/api/govern/subaccounts/:subaccountId/web-login-connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const existing = await webLoginConnectionService.getById(req.params.id, req.orgId!, subaccount.id);

    if (!existing) {
      res.status(404).json({ error: 'web_login connection not found' });
      return;
    }

    await webLoginConnectionService.revoke(req.params.id, req.orgId!, subaccount.id);

    auditService.log({
      organisationId: req.orgId,
      actorId: req.user!.id,
      actorType: 'user',
      action: 'web_login_connection.revoke',
      entityType: 'integration_connection',
      entityId: req.params.id,
      metadata: { subaccountId: subaccount.id, surface: 'govern' },
    });

    res.json({ message: 'web_login connection revoked' });
  }),
);

export default router;
