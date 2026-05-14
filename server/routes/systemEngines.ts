/**
 * System-level engine management routes.
 * All endpoints require system_admin role.
 */

import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { engineService } from '../services/engineService.js';

const router = Router();

// List all system engines
router.get('/api/system/engines', authenticate, requireSystemAdmin, asyncHandler(async (_req, res) => {
  const engines = await engineService.listSystemEngines();
  res.json(engines);
}));

// Create system engine
router.post('/api/system/engines', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, engineType, baseUrl, apiKey } = req.body;

  if (!name || !engineType || !baseUrl) {
    throw { statusCode: 400, message: 'name, engineType, and baseUrl are required' };
  }

  const engine = await engineService.createSystemEngine({ name, engineType, baseUrl, apiKey });
  res.status(201).json(engine);
}));

// Get system engine
router.get('/api/system/engines/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const engine = await engineService.getSystemEngineById(req.params.id);
  res.json(engine);
}));

// Update system engine
router.patch('/api/system/engines/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, engineType, baseUrl, apiKey, status, metadata } = req.body;
  const engine = await engineService.updateSystemEngine(req.params.id, { name, engineType, baseUrl, apiKey, status, metadata });
  res.json(engine);
}));

// Delete system engine (soft)
router.delete('/api/system/engines/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  await engineService.deleteSystemEngine(req.params.id);
  res.json({ success: true });
}));

export default router;
