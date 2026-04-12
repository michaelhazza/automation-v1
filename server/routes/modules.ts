import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { moduleService } from '../services/moduleService.js';
import { subscriptionService } from '../services/subscriptionService.js';

const router = Router();

// ── Authenticated user endpoints ──────────────────────────────────────────

/** GET /api/my-sidebar-config — returns ordered nav-item slugs for the current user's org */
router.get('/api/my-sidebar-config', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json({ items: [] });
    return;
  }
  const items = await moduleService.getSidebarConfig(orgId);
  res.json({ items });
}));

/** GET /api/my-subscription — returns the org's active subscription with details */
router.get('/api/my-subscription', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json({ status: null });
    return;
  }
  const sub = await subscriptionService.getOrgSubscription(orgId);
  if (!sub) {
    res.json({ status: null });
    return;
  }
  res.json(sub);
}));

// ── System admin endpoints ────────────────────────────────────────────────

/** GET /api/system/modules — list all modules */
router.get('/api/system/modules', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const mods = await moduleService.listModules();
  res.json({ modules: mods });
}));

/** POST /api/system/modules — create a module */
router.post('/api/system/modules', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const mod = await moduleService.createModule(req.body);
  res.status(201).json(mod);
}));

/** PATCH /api/system/modules/:id — update a module */
router.patch('/api/system/modules/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const mod = await moduleService.updateModule(req.params.id, req.body);
  res.json(mod);
}));

/** GET /api/system/subscriptions — list all subscriptions */
router.get('/api/system/subscriptions', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const subs = await subscriptionService.listSubscriptions();
  res.json({ subscriptions: subs });
}));

/** POST /api/system/subscriptions — create a subscription */
router.post('/api/system/subscriptions', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const sub = await subscriptionService.createSubscription(req.body);
  res.status(201).json(sub);
}));

/** PATCH /api/system/subscriptions/:id — update a subscription */
router.patch('/api/system/subscriptions/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const sub = await subscriptionService.updateSubscription(req.params.id, req.body);
  res.json(sub);
}));

/** POST /api/system/org-subscriptions — assign a subscription to an org */
router.post('/api/system/org-subscriptions', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { organisationId, subscriptionId, isComped } = req.body;
  const orgSub = await subscriptionService.assignSubscription(organisationId, subscriptionId, { isComped });
  res.status(201).json(orgSub);
}));

export default router;
