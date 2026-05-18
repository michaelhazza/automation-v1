import { z } from 'zod';

// POST /api/scorecards + POST /api/subaccounts/:subaccountId/scorecards
//
// QualityCheck shape (spec §6.3): passMark drives verdict via
// observedScore >= passMark; enabled gates whether the judge runs at all.
export const createScorecardBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  qualityChecks: z.array(z.object({
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    passMark: z.number().min(0).max(1).optional(),
    enabled: z.boolean().optional(),
    // Deterministic-validator fields (spec §5.4 / §10.1)
    kind: z.enum(['deterministic', 'semantic', 'hybrid']).optional(),
    validatorSlug: z.string().max(100).optional(),
    validatorParameters: z.record(z.unknown()).optional(),
    preconditionSlugs: z.array(z.string()).optional(),
    preconditionParameters: z.array(z.record(z.unknown())).optional(),
    safetyClass: z.boolean().optional(),
  })).optional(),
  shareWithSubaccounts: z.boolean().optional(),
  judgeModelId: z.string().max(255).optional(),
});
export type CreateScorecardInput = z.infer<typeof createScorecardBody>;

// PATCH /api/scorecards/:id
export const updateScorecardBody = createScorecardBody.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateScorecardInput = z.infer<typeof updateScorecardBody>;

// POST /api/scorecards/:id/share-toggle
export const shareToggleBody = z.object({
  shareWithSubaccounts: z.boolean(),
});
export type ShareToggleInput = z.infer<typeof shareToggleBody>;

// POST /api/agents/:agentId/scorecards/attach
export const attachScorecardBody = z.object({
  scorecardId: z.string().uuid(),
  gradingFrequency: z.enum(['off', 'q1', 'q2', 'q3']).optional(),
});
export type AttachScorecardInput = z.infer<typeof attachScorecardBody>;

// POST /api/scorecards/:id/duplicate
export const duplicateScorecardBody = z.object({
  targetScopeType: z.enum(['org', 'subaccount']),
  targetScopeId: z.string().uuid().optional(),
  name: z.string().min(1).max(255).optional(),
});
export type DuplicateScorecardInput = z.infer<typeof duplicateScorecardBody>;
