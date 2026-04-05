import { z } from 'zod';

// POST /api/agents
export const createAgentBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  masterPrompt: z.string().min(1),
  modelProvider: z.string().max(100).optional(),
  modelId: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  responseMode: z.string().max(50).optional(),
  outputSize: z.string().max(50).optional(),
  allowModelOverride: z.boolean().optional(),
  defaultSkillSlugs: z.array(z.string()).optional(),
  icon: z.string().max(255).optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentBody>;

// PATCH /api/agents/:id
export const updateAgentBody = createAgentBody.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateAgentInput = z.infer<typeof updateAgentBody>;

// POST /api/agents/:id/data-sources
export const createDataSourceBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  sourceType: z.string().min(1).max(100),
  sourcePath: z.string().min(1),
  sourceHeaders: z.record(z.string()).optional(),
  contentType: z.string().max(100).optional(),
  priority: z.number().int().optional(),
  maxTokenBudget: z.number().int().positive().optional(),
  cacheMinutes: z.number().int().nonnegative().optional(),
});
export type CreateDataSourceInput = z.infer<typeof createDataSourceBody>;

// PATCH /api/agents/:id/data-sources/:sourceId
export const updateDataSourceBody = createDataSourceBody.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateDataSourceInput = z.infer<typeof updateDataSourceBody>;

// POST /api/agents/:id/conversations/:convId/messages
export const sendMessageBody = z.object({
  content: z.string().min(1),
  attachments: z.array(z.unknown()).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageBody>;
