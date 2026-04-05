import { z } from 'zod';

// POST /api/subaccounts/:subaccountId/tasks
export const createTaskBody = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  brief: z.string().optional(),
  status: z.string().max(100).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedAgentId: z.string().optional(),
  assignedAgentIds: z.array(z.string()).optional(),
  createdByAgentId: z.string().optional(),
  processId: z.string().optional(),
  dueDate: z.string().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskBody>;

// PATCH /api/subaccounts/:subaccountId/tasks/:itemId
const updateTaskBase = z.object({
  title: z.string().min(1).max(500),
  description: z.string(),
  brief: z.string(),
  status: z.string().max(100),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  assignedAgentId: z.string().nullable(),
  assignedAgentIds: z.array(z.string()).nullable(),
  processId: z.string().nullable(),
  dueDate: z.string().nullable(),
});
export const updateTaskBody = updateTaskBase.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateTaskInput = z.infer<typeof updateTaskBody>;

// PATCH /api/subaccounts/:subaccountId/tasks/:itemId/move
export const moveTaskBody = z.object({
  status: z.string().min(1).max(100),
  position: z.number().int().nonnegative(),
});
export type MoveTaskInput = z.infer<typeof moveTaskBody>;

// POST /api/subaccounts/:subaccountId/tasks/:itemId/activities
export const createActivityBody = z.object({
  activityType: z.string().min(1).max(100),
  message: z.string().min(1),
  agentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateActivityInput = z.infer<typeof createActivityBody>;

// POST /api/subaccounts/:subaccountId/tasks/:itemId/deliverables
export const createDeliverableBody = z.object({
  deliverableType: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  path: z.string().optional(),
  description: z.string().optional(),
});
export type CreateDeliverableInput = z.infer<typeof createDeliverableBody>;
