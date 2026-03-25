import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { workspaceMemoryService } from '../services/workspaceMemoryService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { MAX_SUMMARY_LENGTH, MAX_ENTRY_LIMIT } from '../config/limits.js';

const router = Router();

// ─── Get workspace memory for a subaccount ──────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/memory',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  async (req, res) => {
    try {
      const { subaccountId } = req.params;
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
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Update workspace memory summary manually ──────────────────────────────

router.put(
  '/api/subaccounts/:subaccountId/memory',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      const { subaccountId } = req.params;
      const { summary } = req.body;

      if (typeof summary !== 'string') {
        res.status(400).json({ error: 'summary (string) is required' });
        return;
      }

      if (summary.length > MAX_SUMMARY_LENGTH) {
        res.status(400).json({ error: `Summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters` });
        return;
      }

      const updated = await workspaceMemoryService.updateSummary(
        req.orgId!,
        subaccountId,
        summary
      );

      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Force regenerate memory summary ────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/memory/regenerate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      const { subaccountId } = req.params;

      await workspaceMemoryService.regenerateSummary(req.orgId!, subaccountId);

      const memory = await workspaceMemoryService.getMemory(req.orgId!, subaccountId);
      res.json(memory);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── List memory entries ────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/memory/entries',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  async (req, res) => {
    try {
      const { subaccountId } = req.params;
      const { limit, offset } = req.query;

      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_ENTRY_LIMIT);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      const entries = await workspaceMemoryService.listEntries(subaccountId, {
        limit: safeLimit,
        offset: safeOffset,
      });

      res.json(entries);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Delete a memory entry ──────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/memory/entries/:entryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      const { subaccountId, entryId } = req.params;
      const deleted = await workspaceMemoryService.deleteEntry(entryId, req.orgId!, subaccountId);

      if (!deleted) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }

      res.json({ success: true });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
