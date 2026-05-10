import { z } from 'zod';

export const SupportIntentSchema = z.enum([
  'account_question', 'billing_question', 'bug_report', 'feature_request',
  'how_to_question', 'complaint', 'cancellation_request', 'sales_inquiry', 'other',
]);

export const SupportUrgencySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const SupportRecommendedActionSchema = z.enum([
  'draft_reply', 'escalate_to_human', 'add_internal_note_only', 'close_as_no_action',
]);

export const SupportClassifyTicketResultSchema = z.object({
  intent: SupportIntentSchema,
  urgency: SupportUrgencySchema,
  recommended_action: SupportRecommendedActionSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  escalate_reason: z.string().nullable(),
});

export type SupportClassifyTicketResult = z.infer<typeof SupportClassifyTicketResultSchema>;
