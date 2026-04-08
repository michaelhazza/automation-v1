/**
 * web_login integration connection routes — Code Change D from the
 * Reporting Agent paywall workflow spec.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §6.3 (UI), §6.6 (T1).
 *
 * Routes:
 *  GET    /api/subaccounts/:subaccountId/web-login-connections
 *  POST   /api/subaccounts/:subaccountId/web-login-connections
 *  GET    /api/subaccounts/:subaccountId/web-login-connections/:id
 *  PATCH  /api/subaccounts/:subaccountId/web-login-connections/:id
 *  DELETE /api/subaccounts/:subaccountId/web-login-connections/:id
 *  POST   /api/subaccounts/:subaccountId/web-login-connections/:id/test
 *  POST   /api/subaccounts/:subaccountId/web-login-connections/test-draft
 *
 * Org-level equivalents are mounted at /api/org/web-login-connections.
 *
 * The "test" endpoints enqueue an iee-browser-task with mode='login_test'.
 * The route returns the executionRunId immediately; the client polls the
 * existing /api/iee/runs/:executionRunId endpoint for status.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { webLoginConnectionService } from '../services/webLoginConnectionService.js';
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

const testDraftBody = z.object({
  config: webLoginConfigSchema,
  password: z.string().min(1).max(2048),
});

// ─── Subaccount-scoped routes ─────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/web-login-connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await webLoginConnectionService.list(req.orgId!, subaccount.id);
    res.json(rows);
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/web-login-connections',
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
      metadata: { subaccountId: subaccount.id, label: parsed.label },
    });
    res.status(201).json(created);
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/web-login-connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const row = await webLoginConnectionService.getById(req.params.id, req.orgId!, subaccount.id);
    if (!row) {
      res.status(404).json({ error: 'web_login connection not found' });
      return;
    }
    res.json(row);
  }),
);

router.patch(
  '/api/subaccounts/:subaccountId/web-login-connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = updateBody.parse(req.body);
    const updated = await webLoginConnectionService.update(req.params.id, req.orgId!, subaccount.id, {
      label: parsed.label,
      displayName: parsed.displayName,
      config: parsed.config as never,
      password: parsed.password,
      connectionStatus: parsed.connectionStatus,
    });
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
      metadata: { passwordRotated: !!parsed.password, subaccountId: subaccount.id },
    });
    res.json(updated);
  }),
);

router.delete(
  '/api/subaccounts/:subaccountId/web-login-connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const ok = await webLoginConnectionService.revoke(req.params.id, req.orgId!, subaccount.id);
    if (!ok) {
      res.status(404).json({ error: 'web_login connection not found' });
      return;
    }
    auditService.log({
      organisationId: req.orgId,
      actorId: req.user!.id,
      actorType: 'user',
      action: 'web_login_connection.revoke',
      entityType: 'integration_connection',
      entityId: req.params.id,
      metadata: { subaccountId: subaccount.id },
    });
    res.json({ message: 'web_login connection revoked' });
  }),
);

/**
 * Test a saved connection. Enqueues an iee-browser-task with mode='login_test'
 * which runs performLogin + optional contentUrl navigation deterministically
 * (no LLM execution loop) and captures a success/failure screenshot.
 *
 * The route returns immediately with the executionRunId. The client polls
 * GET /api/iee/runs/:executionRunId for status.
 *
 * In v1 the actual enqueue path is left as a TODO until D7 lands; the route
 * is wired here so the schema and the front end can integrate against the
 * real shape from the start.
 */
router.post(
  '/api/subaccounts/:subaccountId/web-login-connections/:id/test',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const conn = await webLoginConnectionService.getById(req.params.id, req.orgId!, subaccount.id);
    if (!conn) {
      res.status(404).json({ error: 'web_login connection not found' });
      return;
    }
    // TODO(D7): enqueue a real iee-browser-task with mode='login_test' and
    // return the executionRunId. For now, return 501 so the client surface
    // exists but the test functionality is gated until D7 lands.
    res.status(501).json({
      error: 'connection_test_not_yet_implemented',
      message: 'Connection-test enqueue path will be wired in the next commit (D7).',
      connectionId: conn.id,
    });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/web-login-connections/test-draft',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = testDraftBody.parse(req.body);
    // TODO(D7): enqueue an unsaved iee-browser-task with mode='login_test'
    // using the parsed config + password directly. The worker still fetches
    // by reference for SAVED connections, but for draft tests we pass the
    // password through the payload as a one-shot — the row is never written
    // and the payload is purged from pg-boss after the job completes. This
    // is the only place the plaintext password traverses the queue, and
    // only for the explicit "Test Connection" button before save.
    res.status(501).json({
      error: 'draft_connection_test_not_yet_implemented',
      message: 'Draft test enqueue path will be wired in the next commit (D7).',
      configEcho: parsed.config,
    });
  }),
);

// ─── Org-level mirror routes ──────────────────────────────────────────────────
// (mounted at /api/org/web-login-connections)
// Subaccount-less variant for org-wide credentials shared across subaccounts.

router.get(
  '/api/org/web-login-connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const rows = await webLoginConnectionService.list(req.orgId!, null);
    res.json(rows);
  }),
);

router.post(
  '/api/org/web-login-connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const parsed = createBody.parse(req.body);
    const created = await webLoginConnectionService.create({
      organisationId: req.orgId!,
      subaccountId: null,
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
      metadata: { scope: 'org', label: parsed.label },
    });
    res.status(201).json(created);
  }),
);

export default router;
