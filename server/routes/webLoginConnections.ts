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

/**
 * Codex iteration-3 finding P2: the test modal needs the subaccount's
 * agent list to let the operator attribute the run. Listing via the
 * existing GET /api/subaccounts/:subaccountId/agents is gated on
 * ORG_PERMISSIONS.SUBACCOUNTS_VIEW, which portal users with
 * subaccount-level CONNECTIONS_MANAGE do not hold — they'd see
 * "Failed to load agents" and be blocked from testing.
 *
 * This narrow endpoint returns only the fields the test modal needs,
 * gated on the same CONNECTIONS_MANAGE + AGENTS_EDIT pair that the
 * /test endpoint requires. Declared before GET /:id so Express does
 * not route `test-eligible-agents` through the :id parameter.
 */
router.get(
  '/api/subaccounts/:subaccountId/web-login-connections/test-eligible-agents',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await webLoginConnectionService.listTestEligibleAgents(req.orgId!, subaccount.id);
    res.json(rows);
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
/**
 * Test connection — saved connection variant. Enqueues a login_test IEE task
 * against the saved connection and returns the ieeRunId so the client can
 * poll progress.
 *
 * Audit fix (Phase 0 follow-up): previously returned 501 with a TODO(D7)
 * marker. Now wired to agentExecutionService.executeRun with a login_test
 * browser task. The caller provides the agentId + subaccountAgentId so the
 * test is attributed to a real agent for audit/billing purposes (tests are
 * flagged as test runs — excluded from agency P&L per isTestRun semantics).
 */
const testSavedBody = z.object({
  agentId: z.string().uuid(),
  subaccountAgentId: z.string().uuid(),
});

router.post(
  '/api/subaccounts/:subaccountId/web-login-connections/:id/test',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  // Codex iteration-3 finding P1: this endpoint now enqueues a real
  // agent run via executeRun, so it must require the same permission
  // the other test-run endpoints do (AGENTS_EDIT) — not just the
  // connection-management perm. Otherwise a user who can manage
  // credentials but not trigger agent runs could launch billed
  // browser jobs through this path.
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

    // Codex dual-review finding #1: prove the supplied subaccount-agent link
    // actually belongs to this subaccount AND matches the supplied agentId
    // before handing the execution service a client-controlled pair.
    // executeRun loads the link solely by subaccountAgentId; without this
    // guard, a crafted POST could attribute the test run to one subaccount
    // in the URL while running against another's agent link, corrupting
    // budget/config/audit attribution.
    const link = await webLoginConnectionService.validateSubaccountAgentLink(
      body.subaccountAgentId, subaccount.id, body.agentId,
    );
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
        // contentUrl is optional — if the connection has one, worker navigates
        // there after login to validate the session is usable. See
        // worker/src/browser/executor.ts login_test branch.
        startUrl: conn.config.contentUrl ?? conn.config.loginUrl,
      },
    });

    // Audit: user triggered a credential test.
    auditService.log({
      organisationId: req.orgId!,
      actorId: req.user!.id,
      actorType: 'user',
      action: 'web_login_connection.test.saved',
      entityType: 'integration_connection',
      entityId: conn.id,
      metadata: { ieeRunId: result.ieeRunId, agentRunId: result.runId, scope: 'subaccount' },
    });

    res.status(202).json({
      agentRunId: result.runId,
      ieeRunId: result.ieeRunId,
      status: result.status,
      progressUrl: `/api/iee/runs/${result.ieeRunId}/progress`,
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
    // Draft testing (credentials passed inline without saving first) requires
    // worker-side inline-credential support plus a short-lived encrypted
    // payload path through pg-boss. That is substantially more work than
    // saved-connection testing and is intentionally deferred. The supported
    // UX today is: save the connection, test it, edit or delete if it fails.
    //
    // Previously this route returned 501 with a TODO(D7) marker. The 501 is
    // retained with an updated message pointing callers at the saved-test
    // flow. Tracked in docs/iee-delegation-lifecycle-spec.md under "deferred
    // to follow-up".
    res.status(501).json({
      error: 'draft_connection_test_not_supported',
      message: 'Draft connection testing is not supported. Save the connection first, then use POST /api/subaccounts/:subaccountId/web-login-connections/:id/test.',
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
