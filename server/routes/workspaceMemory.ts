import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { workspaceMemoryService } from '../services/workspaceMemoryService.js';
import { generateEmbedding } from '../lib/embeddings.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { MAX_SUMMARY_LENGTH, MAX_ENTRY_LIMIT, MAX_QUERY_TEXT_CHARS } from '../config/limits.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

// ─── Get workspace memory for a subaccount ──────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/memory',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const memory = await workspaceMemoryService.getMemory(req.orgId!, subaccountId);

    if (!memory) {
      res.json({ summary: null, boardSummary: null, entries: [], version: 0 });
      return;
    }

    const entries = await workspaceMemoryService.listEntries(subaccountId, { limit: 50 });

    res.json({
      ...memory,
      entries,
    });
  })
);

// ─── Update workspace memory summary and/or quality threshold ─────────────

router.put(
  '/api/subaccounts/:subaccountId/memory',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { summary, qualityThreshold } = req.body;

    if (summary !== undefined && typeof summary !== 'string') {
      res.status(400).json({ error: 'summary must be a string' });
      return;
    }

    if (summary !== undefined && summary.length > MAX_SUMMARY_LENGTH) {
      res.status(400).json({ error: `Summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters` });
      return;
    }

    if (qualityThreshold !== undefined) {
      const t = Number(qualityThreshold);
      if (isNaN(t) || t < 0 || t > 1) {
        res.status(400).json({ error: 'qualityThreshold must be a number between 0 and 1' });
        return;
      }
    }

    let updated;
    if (summary !== undefined) {
      updated = await workspaceMemoryService.updateSummary(req.orgId!, subaccountId, summary);
    }
    if (qualityThreshold !== undefined) {
      updated = await workspaceMemoryService.updateQualityThreshold(
        req.orgId!, subaccountId, Number(qualityThreshold)
      );
    }

    if (!updated) {
      updated = await workspaceMemoryService.getMemory(req.orgId!, subaccountId);
    }

    res.json(updated);
  })
);

// ─── Force regenerate memory summary ────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/memory/regenerate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    await workspaceMemoryService.regenerateSummary(req.orgId!, subaccountId);

    const memory = await workspaceMemoryService.getMemory(req.orgId!, subaccountId);
    res.json(memory);
  })
);

// ─── List memory entries ────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/memory/entries',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { limit, offset } = req.query;

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_ENTRY_LIMIT);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const entries = await workspaceMemoryService.listEntries(subaccountId, {
      limit: safeLimit,
      offset: safeOffset,
    });

    res.json(entries);
  })
);

// ─── Delete a memory entry ──────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/memory/entries/:entryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, entryId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const deleted = await workspaceMemoryService.deleteEntry(entryId, req.orgId!, subaccountId);

    if (!deleted) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    res.json({ success: true });
  })
);

// ─── Search diagnostics (Phase B2) ─────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/workspace-memory/search-test',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { query } = req.body as { query?: string };

    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      res.status(400).json({ error: 'Query must be at least 3 characters' });
      return;
    }

    const memory = await workspaceMemoryService.getMemory(req.orgId!, subaccountId);
    if (!memory) {
      res.json([]);
      return;
    }

    const queryText = query.slice(0, MAX_QUERY_TEXT_CHARS);
    const embedding = await generateEmbedding(queryText);
    if (!embedding) {
      res.status(500).json({ error: 'Failed to generate query embedding' });
      return;
    }

    const results = await workspaceMemoryService.getRelevantMemories(
      subaccountId,
      memory.qualityThreshold,
      embedding,
      queryText,
    );

    res.json(results);
  })
);

export default router;
