import { Router, NextFunction } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { orgMemoryService } from '../services/orgMemoryService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ── Get compiled org memory ───────────────────────────────────────────────

router.get('/api/org/memory', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const memory = await orgMemoryService.getMemory(req.orgId!);
  res.json(memory);
}));

// ── Update compiled summary manually ──────────────────────────────────────

router.put('/api/org/memory', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res, _next: NextFunction) => {
  const { summary } = req.body;
  if (!summary) return res.status(400).json({ message: 'summary is required' });
  await orgMemoryService.updateSummary(req.orgId!, summary);
  res.json({ success: true });
}));

// ── List org memory entries ───────────────────────────────────────────────

router.get('/api/org/memory/entries', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const { entryType, scopeTagKey, scopeTagValue, limit } = req.query;
  const entries = await orgMemoryService.listEntries(req.orgId!, {
    entryType: entryType as string | undefined,
    scopeTagKey: scopeTagKey as string | undefined,
    scopeTagValue: scopeTagValue as string | undefined,
    limit: limit ? Number(limit) : undefined,
  });
  res.json(entries);
}));

// ── Delete an org memory entry ────────────────────────────────────────────

router.delete('/api/org/memory/entries/:entryId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  await orgMemoryService.deleteEntry(req.params.entryId, req.orgId!);
  res.json({ success: true });
}));

export default router;
