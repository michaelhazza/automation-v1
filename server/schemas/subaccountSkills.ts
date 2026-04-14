import { z } from 'zod';
import { MAX_SKILL_DEFINITION_SIZE } from '../config/limits.js';

// POST /api/subaccounts/:subaccountId/skills
export const createSubaccountSkillBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'Slug must be lowercase alphanumeric with underscores'),
  description: z.string().max(2000).optional(),
  definition: z.object({
    name: z.string(),
    description: z.string(),
    input_schema: z.object({}).passthrough(),
  }).passthrough()
    .refine(
      (def: Record<string, unknown>) => JSON.stringify(def).length <= MAX_SKILL_DEFINITION_SIZE,
      { message: `Definition payload exceeds ${MAX_SKILL_DEFINITION_SIZE / 1000} KB limit` },
    ),
  instructions: z.string().max(50000).optional(),
});
export type CreateSubaccountSkillInput = z.infer<typeof createSubaccountSkillBody>;

// PATCH /api/subaccounts/:subaccountId/skills/:id
export const updateSubaccountSkillBody = createSubaccountSkillBody.partial();
export type UpdateSubaccountSkillInput = z.infer<typeof updateSubaccountSkillBody>;

// PATCH /api/subaccounts/:subaccountId/skills/:id/visibility
export const updateSkillVisibilityBody = z.object({
  visibility: z.enum(['none', 'basic', 'full']),
});
export type UpdateSkillVisibilityInput = z.infer<typeof updateSkillVisibilityBody>;
