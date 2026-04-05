import { z } from 'zod';

// POST /api/subaccounts/:subaccountId/agents
export const linkAgentBody = z.object({
  agentId: z.string().min(1),
});
export type LinkAgentInput = z.infer<typeof linkAgentBody>;

// PATCH /api/subaccounts/:subaccountId/agents/:linkId
const updateLinkBase = z.object({
  isActive: z.boolean(),
  parentSubaccountAgentId: z.string().nullable(),
  agentRole: z.string().nullable(),
  agentTitle: z.string().nullable(),
  heartbeatEnabled: z.boolean(),
  heartbeatIntervalHours: z.number().positive().nullable(),
  heartbeatOffsetHours: z.number().nonnegative(),
});
export const updateLinkBody = updateLinkBase.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateLinkInput = z.infer<typeof updateLinkBody>;

// POST /api/subaccounts/:subaccountId/agents/:linkId/data-sources
export const createSubaccountDataSourceBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  sourceType: z.string().min(1).max(100),
  sourcePath: z.string().min(1),
  sourceHeaders: z.record(z.string()).optional(),
  contentType: z.string().max(100).optional(),
  priority: z.number().int().optional(),
  maxTokenBudget: z.number().int().positive().optional(),
  cacheMinutes: z.number().int().nonnegative().optional(),
  syncMode: z.string().max(50).optional(),
});
export type CreateSubaccountDataSourceInput = z.infer<typeof createSubaccountDataSourceBody>;
