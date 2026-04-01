import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { boardService } from '../services/boardService.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

/**
 * GET /api/system/board-templates
 * List all board templates (system admin only).
 */
router.get('/api/system/board-templates', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const templates = await boardService.listTemplates();
  res.json(templates);
}));

/**
 * GET /api/system/board-templates/:id
 * Get a single board template.
 */
router.get('/api/system/board-templates/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const template = await boardService.getTemplate(req.params.id);
  res.json(template);
}));

/**
 * POST /api/system/board-templates
 * Create a new board template.
 */
router.post('/api/system/board-templates', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
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
}));

/**
 * PATCH /api/system/board-templates/:id
 * Update a board template.
 */
router.patch('/api/system/board-templates/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, description, columns, isDefault } = req.body as {
    name?: string;
    description?: string;
    columns?: unknown[];
    isDefault?: boolean;
  };

  const template = await boardService.updateTemplate(req.params.id, { name, description, columns: columns as any, isDefault });
  res.json(template);
}));

/**
 * DELETE /api/system/board-templates/:id
 * Delete a board template.
 */
router.delete('/api/system/board-templates/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  await boardService.deleteTemplate(req.params.id);
  res.json({ message: 'Template deleted' });
}));

/**
 * GET /api/board-templates
 * List board templates for org admins (to pick from when initialising).
 */
router.get('/api/board-templates', authenticate, asyncHandler(async (req, res) => {
  const templates = await boardService.listTemplates();
  res.json(templates);
}));

export default router;
