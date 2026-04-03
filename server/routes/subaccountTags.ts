import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { subaccountTagService } from '../services/subaccountTagService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ── Get tags for a subaccount ─────────────────────────────────────────────

router.get('/api/subaccounts/:subaccountId/tags', authenticate, asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const tags = await subaccountTagService.getTags(req.orgId!, req.params.subaccountId);
  res.json(tags);
}));

// ── Set a tag ─────────────────────────────────────────────────────────────

router.put('/api/subaccounts/:subaccountId/tags/:key', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const { value } = req.body;
  if (!value) return res.status(400).json({ message: 'value is required' });
  const tag = await subaccountTagService.setTag(req.orgId!, req.params.subaccountId, req.params.key, value);
  res.json(tag);
}));

// ── Remove a tag ──────────────────────────────────────────────────────────

router.delete('/api/subaccounts/:subaccountId/tags/:key', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  await subaccountTagService.removeTag(req.orgId!, req.params.subaccountId, req.params.key);
  res.json({ success: true });
}));

// ── Bulk set tag across subaccounts ───────────────────────────────────────

router.post('/api/org/subaccount-tags/bulk', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const { subaccountIds, key, value } = req.body;
  if (!subaccountIds?.length || !key || !value) {
    return res.status(400).json({ message: 'subaccountIds, key, and value are required' });
  }
  await subaccountTagService.bulkSetTag(req.orgId!, subaccountIds, key, value);
  res.json({ success: true, count: subaccountIds.length });
}));

// ── List distinct tag keys ────────────────────────────────────────────────

router.get('/api/org/subaccount-tags/keys', authenticate, asyncHandler(async (req, res) => {
  const keys = await subaccountTagService.listTagKeys(req.orgId!);
  res.json(keys);
}));

// ── Filter subaccounts by tags ────────────────────────────────────────────

router.get('/api/org/subaccounts/by-tags', authenticate, asyncHandler(async (req, res) => {
  const filtersParam = req.query.filters as string | undefined;
  let filters: Array<{ key: string; value: string }> = [];
  if (filtersParam) {
    try { filters = JSON.parse(filtersParam); } catch { /* empty filters */ }
  }
  const subaccountIds = await subaccountTagService.getSubaccountsByTags(req.orgId!, filters);
  res.json(subaccountIds);
}));

export default router;
