import { z } from 'zod';

export const EADraftKindSchema = z.enum([
  'gmail_reply',
  'gmail_new',
  'slack_post',
  'slack_dm',
  'calendar_create',
  'calendar_update',
  'calendar_respond',
]);
export type EADraftKind = z.infer<typeof EADraftKindSchema>;

export const EADraftSendStateSchema = z.enum(['idle', 'sending', 'sent', 'send_failed']);
export type EADraftSendState = z.infer<typeof EADraftSendStateSchema>;

export const EADraftSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  agentId: z.string().uuid(),
  runId: z.string().uuid(),
  proposalActionId: z.string().uuid(),
  kind: EADraftKindSchema,
  targetRef: z.record(z.unknown()),
  body: z.record(z.unknown()),
  sendState: EADraftSendStateSchema,
  externalResultId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type EADraft = z.infer<typeof EADraftSchema>;

export type InsertEADraft = Omit<EADraft, 'id' | 'createdAt' | 'updatedAt' | 'sendState' | 'externalResultId'> & {
  sendState?: EADraftSendState;
  externalResultId?: string | null;
};
