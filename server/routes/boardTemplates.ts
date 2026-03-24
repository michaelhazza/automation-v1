import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { boardService } from '../services/boardService.js';

const router = Router();

/**
 * GET /api/system/board-templates
 * List all board templates (system admin only).
 */
router.get('/api/system/board-templates', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const templates = await boardService.listTemplates();
    res.json(templates);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

/**
 * GET /api/system/board-templates/:id
 * Get a single board template.
 */
router.get('/api/system/board-templates/:id', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const template = await boardService.getTemplate(req.params.id);
    res.json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

/**
 * POST /api/system/board-templates
 * Create a new board template.
 */
router.post('/api/system/board-templates', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const { name, description, columns, isDefault } = req.body as {
      name?: string;
      description?: string;
      columns?: unknown[];
      isDefault?: boolean;
    };

    if (!name || !columns || !Array.isArray(columns) || columns.length === 0) {
      res.status(400).json({ error: 'name and columns are required' });
      return;
    }

    const template = await boardService.createTemplate({ name, description, columns: columns as any, isDefault });
    res.status(201).json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

/**
 * PATCH /api/system/board-templates/:id
 * Update a board template.
 */
router.patch('/api/system/board-templates/:id', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const { name, description, columns, isDefault } = req.body as {
      name?: string;
      description?: string;
      columns?: unknown[];
      isDefault?: boolean;
    };

    const template = await boardService.updateTemplate(req.params.id, { name, description, columns: columns as any, isDefault });
    res.json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

/**
 * DELETE /api/system/board-templates/:id
 * Delete a board template.
 */
router.delete('/api/system/board-templates/:id', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    await boardService.deleteTemplate(req.params.id);
    res.json({ message: 'Template deleted' });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

/**
 * GET /api/board-templates
 * List board templates for org admins (to pick from when initialising).
 */
router.get('/api/board-templates', authenticate, async (req, res) => {
  try {
    const templates = await boardService.listTemplates();
    res.json(templates);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
