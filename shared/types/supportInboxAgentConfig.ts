import { z } from 'zod';

export const SupportInboxAgentConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['autonomous', 'assisted', 'disabled']),
  collisionWindow: z.object({
    minMinutesSinceHumanActivity: z.number(),
    respectHumanAssignee: z.boolean(),
  }),
  draftExpiry: z.object({
    awaitingReviewHours: z.number(),
    draftHours: z.number(),
  }),
  modelOverride: z.string().optional(),
  promptOverride: z.string().optional(),
  optIns: z.object({
    autonomousReplyOnWaitingOnCustomer: z.boolean(),
    postResolutionFollowUp: z.boolean(),
  }),
});

export type SupportInboxAgentConfig = z.infer<typeof SupportInboxAgentConfigSchema>;
