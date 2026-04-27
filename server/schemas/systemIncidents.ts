import { z } from 'zod';

// POST /api/system/incidents/:id/resolve
export const resolveIncidentBody = z.object({
  resolutionNote: z.string().max(2000).optional(),
  linkedPrUrl: z.string().url().max(500).optional(),
});
export type ResolveIncidentInput = z.infer<typeof resolveIncidentBody>;

// POST /api/system/incidents/:id/suppress
export const suppressIncidentBody = z.object({
  reason: z.string().min(1).max(500),
  duration: z.enum(['24h', '7d', '30d', 'permanent']),
});
export type SuppressIncidentInput = z.infer<typeof suppressIncidentBody>;

// POST /api/system/incidents/:id/escalate
export const escalateIncidentBody = z.object({}).optional();
export type EscalateIncidentInput = z.infer<typeof escalateIncidentBody>;

// GET /api/system/incidents — query params
export const listIncidentsQuery = z.object({
  status: z.string().optional(),      // CSV of statuses
  severity: z.string().optional(),    // CSV of severities
  source: z.string().optional(),      // CSV of sources
  classification: z.string().optional(),
  organisationId: z.string().uuid().optional(),
  includeTestIncidents: z.string().optional(), // 'true' | 'false'
  sort: z.enum(['last_seen_desc', 'first_seen_desc', 'occurrence_count_desc', 'severity_desc']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
  diagnosis: z.enum(['all', 'diagnosed', 'awaiting', 'not-triaged']).optional(),
});

// POST /api/system/incidents/:id/feedback
export const recordPromptFeedbackBody = z.object({
  wasSuccessful: z.enum(['yes', 'no', 'partial']),
  text: z.string().max(2000).optional(),
});
export type RecordPromptFeedbackInput = z.infer<typeof recordPromptFeedbackBody>;

// POST /api/system/incidents/test-trigger
export const testTriggerBody = z.object({
  triggerNotifications: z.boolean().optional().default(false),
});
export type TestTriggerInput = z.infer<typeof testTriggerBody>;
