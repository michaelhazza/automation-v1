import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { boardService } from '../services/boardService.js';
import { taskService } from '../services/taskService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

const router = Router();

// ─── Helper ───────────────────────────────────────────────────────────────────

async function resolveSubaccount(subaccountId: string, organisationId: string) {
  const [sa] = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId), isNull(subaccounts.deletedAt)));

  if (!sa) throw { statusCode: 404, message: 'Subaccount not found' };
  return sa;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD CONFIG — ORG LEVEL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/board-config
 * Get the org-level board configuration.
 */
router.get(
  '/api/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  async (req, res) => {
    try {
      const config = await boardService.getOrgBoardConfig(req.orgId!);
      res.json(config);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/board-config/init
 * Initialise org board config from a template.
 */
router.post(
  '/api/board-config/init',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      const { templateId } = req.body as { templateId?: string };
      if (!templateId) {
        res.status(400).json({ error: 'templateId is required' });
        return;
      }

      const config = await boardService.initOrgBoardFromTemplate(req.orgId!, templateId);
      res.status(201).json(config);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/board-config
 * Update the org-level board columns.
 */
router.patch(
  '/api/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      const { columns } = req.body as { columns?: unknown[] };
      if (!columns || !Array.isArray(columns)) {
        res.status(400).json({ error: 'columns array is required' });
        return;
      }

      const existing = await boardService.getOrgBoardConfig(req.orgId!);
      if (!existing) {
        res.status(404).json({ error: 'Organisation has no board configuration. Initialise first.' });
        return;
      }

      const updated = await boardService.updateBoardConfig(existing.id, req.orgId!, columns as any);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD CONFIG — SUBACCOUNT LEVEL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/subaccounts/:subaccountId/board-config
 */
router.get(
  '/api/subaccounts/:subaccountId/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      console.log('[BOARD-DEBUG] === GET /api/subaccounts/:subaccountId/board-config ===');
      console.log('[BOARD-DEBUG] subaccountId:', req.params.subaccountId);
      console.log('[BOARD-DEBUG] req.orgId:', req.orgId);
      console.log('[BOARD-DEBUG] user.role:', req.user?.role);
      console.log('[BOARD-DEBUG] user.organisationId:', req.user?.organisationId);
      console.log('[BOARD-DEBUG] X-Organisation-Id header:', req.headers['x-organisation-id']);

      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      console.log('[BOARD-DEBUG] resolveSubaccount passed');

      let config = await boardService.getSubaccountBoardConfig(req.orgId!, req.params.subaccountId);
      console.log('[BOARD-DEBUG] getSubaccountBoardConfig result:', config ? { id: config.id, columnsLength: config.columns?.length, subaccountId: config.subaccountId, organisationId: config.organisationId } : 'NULL');

      // Auto-initialise from org config if subaccount has no board yet
      if (!config) {
        const orgConfig = await boardService.getOrgBoardConfig(req.orgId!);
        console.log('[BOARD-DEBUG] No subaccount config. Org config:', orgConfig ? { id: orgConfig.id, columnsLength: orgConfig.columns?.length } : 'NULL');
        config = await boardService.initSubaccountBoard(req.orgId!, req.params.subaccountId);
        console.log('[BOARD-DEBUG] initSubaccountBoard result:', config ? { id: config.id, columnsLength: config.columns?.length } : 'NULL');
      }

      // If config exists but has empty columns, try to re-sync from org config
      if (config && Array.isArray(config.columns) && config.columns.length === 0) {
        const orgConfig = await boardService.getOrgBoardConfig(req.orgId!);
        console.log('[BOARD-DEBUG] Empty columns detected. Org config:', orgConfig ? { id: orgConfig.id, columnsLength: orgConfig.columns?.length } : 'NULL');
        if (orgConfig && orgConfig.columns.length > 0) {
          const updated = await boardService.updateBoardConfig(config.id, req.orgId!, orgConfig.columns as any);
          config = updated;
          console.log('[BOARD-DEBUG] Re-synced from org. New columnsLength:', config.columns?.length);
        }
      }

      console.log('[BOARD-DEBUG] FINAL RESPONSE:', config ? { id: config.id, columnsLength: config.columns?.length } : 'NULL');
      console.log('[BOARD-DEBUG] === END ===');
      res.json(config);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/board-config/init
 * Initialise subaccount board from org config.
 */
router.post(
  '/api/subaccounts/:subaccountId/board-config/init',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const config = await boardService.initSubaccountBoard(req.orgId!, req.params.subaccountId);
      if (!config) {
        res.status(404).json({ error: 'Organisation has no board configuration to copy from' });
        return;
      }
      res.status(201).json(config);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/board-config
 * Update subaccount board columns.
 */
router.patch(
  '/api/subaccounts/:subaccountId/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { columns } = req.body as { columns?: unknown[] };
      if (!columns || !Array.isArray(columns)) {
        res.status(400).json({ error: 'columns array is required' });
        return;
      }

      const existing = await boardService.getSubaccountBoardConfig(req.orgId!, req.params.subaccountId);
      if (!existing) {
        res.status(404).json({ error: 'Subaccount has no board configuration. Initialise first.' });
        return;
      }

      const updated = await boardService.updateBoardConfig(existing.id, req.orgId!, columns as any);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/board-config/push
 * Push org board config to this subaccount.
 */
router.post(
  '/api/subaccounts/:subaccountId/board-config/push',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const results = await boardService.pushOrgConfigToSubaccounts(req.orgId!, [req.params.subaccountId]);
      res.json(results[0]);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/board-config/push-all
 * Push org board config to ALL subaccounts.
 */
router.post(
  '/api/board-config/push-all',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      const allSubs = await db
        .select({ id: subaccounts.id })
        .from(subaccounts)
        .where(and(eq(subaccounts.organisationId, req.orgId!), isNull(subaccounts.deletedAt)));

      if (allSubs.length === 0) {
        res.json({ pushed: 0, results: [] });
        return;
      }

      const results = await boardService.pushOrgConfigToSubaccounts(
        req.orgId!,
        allSubs.map(s => s.id)
      );
      res.json({ pushed: results.length, results });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUBACCOUNT AGENTS — AGENT LINKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/subaccounts/:subaccountId/agents
 * List agents linked to this subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const agentLinks = await subaccountAgentService.listSubaccountAgents(req.orgId!, req.params.subaccountId);
      res.json(agentLinks);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/agents
 * Link an agent to this subaccount.
 */
router.post(
  '/api/subaccounts/:subaccountId/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { agentId } = req.body as { agentId?: string };

      if (!agentId) {
        res.status(400).json({ error: 'agentId is required' });
        return;
      }

      const link = await subaccountAgentService.linkAgent(req.orgId!, req.params.subaccountId, agentId);
      res.status(201).json(link);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; code?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'Agent is already linked to this subaccount' });
        return;
      }
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/agents/:agentId
 * Unlink an agent from this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/agents/:agentId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      await subaccountAgentService.unlinkAgent(req.orgId!, req.params.subaccountId, req.params.agentId);
      res.json({ message: 'Agent unlinked' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/agents/:linkId
 * Toggle agent active status.
 */
router.patch(
  '/api/subaccounts/:subaccountId/agents/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { isActive } = req.body as { isActive?: boolean };

      if (isActive === undefined) {
        res.status(400).json({ error: 'isActive is required' });
        return;
      }

      const updated = await subaccountAgentService.toggleActive(req.orgId!, req.params.linkId, isActive);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * GET /api/subaccounts/:subaccountId/agents/:linkId/data-sources
 * List subaccount-level data sources for a linked agent.
 */
router.get(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const sources = await subaccountAgentService.listSubaccountDataSources(req.params.linkId);
      res.json(sources);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/agents/:linkId/data-sources
 * Add a subaccount-level data source for a linked agent.
 */
router.post(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { name, description, sourceType, sourcePath, sourceHeaders, contentType, priority, maxTokenBudget, cacheMinutes, syncMode } =
        req.body as Record<string, unknown>;

      if (!name || !sourceType || !sourcePath) {
        res.status(400).json({ error: 'name, sourceType and sourcePath are required' });
        return;
      }

      // We need the agentId from the link — fetch it
      const links = await subaccountAgentService.listSubaccountAgents(req.orgId!, req.params.subaccountId);
      const link = links.find(l => l.id === req.params.linkId);
      if (!link) {
        res.status(404).json({ error: 'Agent link not found' });
        return;
      }

      const source = await subaccountAgentService.addSubaccountDataSource(req.params.linkId, link.agentId, {
        name: name as string,
        description: description as string | undefined,
        sourceType: sourceType as any,
        sourcePath: sourcePath as string,
        sourceHeaders: sourceHeaders as Record<string, string> | undefined,
        contentType: contentType as any,
        priority: priority as number | undefined,
        maxTokenBudget: maxTokenBudget as number | undefined,
        cacheMinutes: cacheMinutes as number | undefined,
        syncMode: syncMode as any,
      });
      res.status(201).json(source);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/agents/:linkId/data-sources/:sourceId
 * Remove a subaccount-level data source.
 */
router.delete(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources/:sourceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      await subaccountAgentService.removeSubaccountDataSource(req.params.sourceId, req.params.linkId);
      res.json({ message: 'Data source removed' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS — KANBAN CARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/subaccounts/:subaccountId/tasks
 * List tasks for a subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { status, priority, assignedAgentId, search } = req.query as Record<string, string>;
      const items = await taskService.listTasks(req.orgId!, req.params.subaccountId, {
        status,
        priority,
        assignedAgentId,
        search,
      });
      res.json(items);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/tasks
 * Create a task.
 */
router.post(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { title, description, brief, status, priority, assignedAgentId, createdByAgentId, processId, dueDate } = req.body as {
        title?: string;
        description?: string;
        brief?: string;
        status?: string;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        assignedAgentId?: string;
        createdByAgentId?: string;
        processId?: string;
        dueDate?: string;
      };

      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      const item = await taskService.createTask(
        req.orgId!,
        req.params.subaccountId,
        {
          title,
          description,
          brief,
          status,
          priority,
          assignedAgentId,
          createdByAgentId,
          processId,
          dueDate: dueDate ? new Date(dueDate) : undefined,
        },
        req.user!.id
      );

      res.status(201).json(item);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * GET /api/subaccounts/:subaccountId/tasks/:itemId
 * Get a single task with activities and deliverables.
 */
router.get(
  '/api/subaccounts/:subaccountId/tasks/:itemId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const item = await taskService.getTask(req.params.itemId, req.orgId!);
      res.json(item);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/tasks/:itemId
 * Update a task.
 */
router.patch(
  '/api/subaccounts/:subaccountId/tasks/:itemId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { title, description, brief, status, priority, assignedAgentId, processId, dueDate } = req.body as Record<string, unknown>;

      const item = await taskService.updateTask(
        req.params.itemId,
        req.orgId!,
        {
          title: title as string | undefined,
          description: description as string | undefined,
          brief: brief as string | undefined,
          status: status as string | undefined,
          priority: priority as any,
          assignedAgentId: assignedAgentId as string | null | undefined,
          processId: processId as string | null | undefined,
          dueDate: dueDate === null ? null : dueDate ? new Date(dueDate as string) : undefined,
        },
        req.user!.id
      );

      res.json(item);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/subaccounts/:subaccountId/tasks/:itemId/move
 * Move a task (drag-and-drop optimised).
 */
router.patch(
  '/api/subaccounts/:subaccountId/tasks/:itemId/move',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      const { status, position } = req.body as { status?: string; position?: number };

      if (!status || position === undefined) {
        res.status(400).json({ error: 'status and position are required' });
        return;
      }

      const item = await taskService.moveTask(req.params.itemId, req.orgId!, { status, position }, req.user!.id);
      res.json(item);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/tasks/:itemId
 * Soft-delete a task.
 */
router.delete(
  '/api/subaccounts/:subaccountId/tasks/:itemId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      await taskService.deleteTask(req.params.itemId, req.orgId!);
      res.json({ message: 'Task deleted' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITIES & DELIVERABLES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/subaccounts/:subaccountId/tasks/:itemId/activities
 */
router.get(
  '/api/subaccounts/:subaccountId/tasks/:itemId/activities',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  async (req, res) => {
    try {
      const activities = await taskService.listActivities(req.params.itemId);
      res.json(activities);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/tasks/:itemId/activities
 */
router.post(
  '/api/subaccounts/:subaccountId/tasks/:itemId/activities',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      const { activityType, message, agentId, metadata } = req.body as {
        activityType?: string;
        message?: string;
        agentId?: string;
        metadata?: Record<string, unknown>;
      };

      if (!activityType || !message) {
        res.status(400).json({ error: 'activityType and message are required' });
        return;
      }

      const activity = await taskService.addActivity(req.params.itemId, {
        activityType: activityType as any,
        message,
        agentId,
        userId: req.user!.id,
        metadata,
      });

      res.status(201).json(activity);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * GET /api/subaccounts/:subaccountId/tasks/:itemId/deliverables
 */
router.get(
  '/api/subaccounts/:subaccountId/tasks/:itemId/deliverables',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  async (req, res) => {
    try {
      const deliverables = await taskService.listDeliverables(req.params.itemId);
      res.json(deliverables);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * POST /api/subaccounts/:subaccountId/tasks/:itemId/deliverables
 */
router.post(
  '/api/subaccounts/:subaccountId/tasks/:itemId/deliverables',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      const { deliverableType, title, path, description } = req.body as {
        deliverableType?: string;
        title?: string;
        path?: string;
        description?: string;
      };

      if (!deliverableType || !title) {
        res.status(400).json({ error: 'deliverableType and title are required' });
        return;
      }

      const deliverable = await taskService.addDeliverable(req.params.itemId, {
        deliverableType: deliverableType as any,
        title,
        path,
        description,
      });

      res.status(201).json(deliverable);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/subaccounts/:subaccountId/tasks/:itemId/deliverables/:delivId
 */
router.delete(
  '/api/subaccounts/:subaccountId/tasks/:itemId/deliverables/:delivId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  async (req, res) => {
    try {
      await taskService.deleteDeliverable(req.params.delivId);
      res.json({ message: 'Deliverable deleted' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
