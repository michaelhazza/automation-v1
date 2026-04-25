import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemIncidentService } from '../services/systemIncidentService.js';
import {
  resolveIncidentBody,
  suppressIncidentBody,
  listIncidentsQuery,
  testTriggerBody,
} from '../schemas/systemIncidents.js';
import type { SystemIncidentStatus } from '../db/schema/systemIncidents.js';

const router = Router();

const SA = [authenticate, requireSystemAdmin] as const;

// ─── List incidents ──────────────────────────────────────────────────────────

router.get('/api/system/incidents', ...SA, asyncHandler(async (req, res) => {
  const query = listIncidentsQuery.parse(req.query);
  const filters = {
    status: query.status ? query.status.split(',') as SystemIncidentStatus[] : undefined,
    severity: query.severity ? query.severity.split(',') : undefined,
    source: query.source ? query.source.split(',') : undefined,
    classification: query.classification ? query.classification.split(',') : undefined,
    organisationId: query.organisationId,
    includeTestIncidents: query.includeTestIncidents === 'true',
    sort: query.sort,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
  };
  const result = await systemIncidentService.listIncidents(filters);
  res.json(result);
}));

// ─── Badge count (nav red dot) ───────────────────────────────────────────────

router.get('/api/system/incidents/badge-count', ...SA, asyncHandler(async (req, res) => {
  const { total } = await systemIncidentService.listIncidents({
    status: ['open', 'investigating', 'remediating', 'escalated'],
    severity: ['high', 'critical'],
    classification: ['system_fault'],
    includeTestIncidents: false,
    limit: 0,
  });
  res.json({ count: total });
}));

// ─── List suppressions ───────────────────────────────────────────────────────

router.get('/api/system/incidents/suppressions', ...SA, asyncHandler(async (req, res) => {
  const activeOnly = req.query.activeOnly !== 'false';
  const suppressions = await systemIncidentService.listSuppressions({ activeOnly });
  res.json(suppressions);
}));

// ─── Delete suppression ──────────────────────────────────────────────────────

router.delete('/api/system/incidents/suppressions/:id', ...SA, asyncHandler(async (req, res) => {
  await systemIncidentService.removeSuppression(req.params.id, req.user!.id);
  res.json({ message: 'Suppression removed' });
}));

// ─── Test trigger ────────────────────────────────────────────────────────────

router.post('/api/system/incidents/test-trigger', ...SA, asyncHandler(async (req, res) => {
  // guard-ignore-next-line: input-validation reason="testTriggerBody Zod parse handles validation"
  const body = testTriggerBody.parse(req.body ?? {});
  const incident = await systemIncidentService.createTestIncident(req.user!.id, body.triggerNotifications);
  res.status(201).json(incident);
}));

// ─── Get incident detail ─────────────────────────────────────────────────────

router.get('/api/system/incidents/:id', ...SA, asyncHandler(async (req, res) => {
  const result = await systemIncidentService.getIncident(req.params.id);
  res.json(result);
}));

// ─── Ack ─────────────────────────────────────────────────────────────────────

router.post('/api/system/incidents/:id/ack', ...SA, asyncHandler(async (req, res) => {
  const incident = await systemIncidentService.acknowledgeIncident(req.params.id, req.user!.id);
  res.json(incident);
}));

// ─── Resolve ─────────────────────────────────────────────────────────────────

router.post('/api/system/incidents/:id/resolve', ...SA, asyncHandler(async (req, res) => {
  // guard-ignore-next-line: input-validation reason="resolveIncidentBody Zod parse handles validation"
  const body = resolveIncidentBody.parse(req.body ?? {});
  const incident = await systemIncidentService.resolveIncident(
    req.params.id,
    req.user!.id,
    body.resolutionNote,
    body.linkedPrUrl,
  );
  res.json(incident);
}));

// ─── Suppress ────────────────────────────────────────────────────────────────

router.post('/api/system/incidents/:id/suppress', ...SA, asyncHandler(async (req, res) => {
  // guard-ignore-next-line: input-validation reason="suppressIncidentBody Zod parse handles validation"
  const body = suppressIncidentBody.parse(req.body);
  const incident = await systemIncidentService.suppressIncident(
    req.params.id,
    req.user!.id,
    body.reason,
    body.duration,
  );
  res.json(incident);
}));

// ─── Escalate (stub — filled in commit 12) ───────────────────────────────────

router.post('/api/system/incidents/:id/escalate', ...SA, asyncHandler(async (req, res) => {
  const result = await systemIncidentService.escalateIncidentToAgent(req.params.id, req.user!.id);
  res.json(result);
}));

export default router;
