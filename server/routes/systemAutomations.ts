/**
 * System-level process management routes.
 * All endpoints require system_admin role.
 */

import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemAutomationService } from '../services/systemAutomationService.js';

const router = Router();

// List all system automations
router.get('/api/system/automations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const rows = await systemAutomationService.list();
  res.json(rows);
}));

// Create system process
router.post('/api/system/automations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, description, webhookPath, inputSchema, outputSchema, configSchema, defaultConfig, requiredConnections, automationEngineId } = req.body;

  if (!name || !webhookPath) {
    throw { statusCode: 400, message: 'name and webhookPath are required' };
  }

  const process = await systemAutomationService.create({
    name,
    description: description ?? null,
    webhookPath,
    inputSchema: inputSchema ?? null,
    outputSchema: outputSchema ?? null,
    configSchema: configSchema ?? null,
    defaultConfig: defaultConfig ?? null,
    requiredConnections: requiredConnections ?? null,
    automationEngineId: automationEngineId ?? null,
  });

  res.status(201).json(process);
}));

// Get system process
router.get('/api/system/automations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const process = await systemAutomationService.getById(req.params.id);
  if (!process) throw { statusCode: 404, message: 'System process not found' };
  res.json(process);
}));

// Update system process
router.patch('/api/system/automations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const updated = await systemAutomationService.update(req.params.id, req.body);
  if (!updated) throw { statusCode: 404, message: 'System process not found' };
  res.json(updated);
}));

// Delete system process (soft)
router.delete('/api/system/automations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const ok = await systemAutomationService.softDelete(req.params.id);
  if (!ok) throw { statusCode: 404, message: 'System process not found' };
  res.json({ success: true });
}));

// Activate system process
router.post('/api/system/automations/:id/activate', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const updated = await systemAutomationService.setStatus(req.params.id, 'active');
  if (!updated) throw { statusCode: 404, message: 'System process not found' };
  res.json(updated);
}));

// Deactivate system process
router.post('/api/system/automations/:id/deactivate', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const updated = await systemAutomationService.setStatus(req.params.id, 'inactive');
  if (!updated) throw { statusCode: 404, message: 'System process not found' };
  res.json(updated);
}));

export default router;
