import { z } from 'zod';

export const VoiceProfileSourceSchema = z.enum(['gmail_sent_sampler', 'drive_doc_sampler']);
export type VoiceProfileSource = z.infer<typeof VoiceProfileSourceSchema>;

// 'on_send_count' is intentionally excluded from the write API (V1 deferred)
export const VoiceProfileRefreshPolicyWriteSchema = z.enum(['manual', 'periodic']);
export const VoiceProfileRefreshPolicySchema = z.enum(['manual', 'periodic', 'on_send_count']);
export type VoiceProfileRefreshPolicy = z.infer<typeof VoiceProfileRefreshPolicySchema>;

export const VoiceProfileStateSchema = z.enum(['pending', 'deriving', 'ready', 'failed']);
export type VoiceProfileState = z.infer<typeof VoiceProfileStateSchema>;

export const VoiceProfileSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  ownerUserId: z.string().uuid().nullable(),
  subaccountId: z.string().uuid().nullable(),
  orgScope: z.boolean(),
  sources: z.array(VoiceProfileSourceSchema),
  sampleCount: z.number().int().nonnegative(),
  profileJson: z.record(z.unknown()).nullable(),
  state: VoiceProfileStateSchema,
  refreshPolicy: VoiceProfileRefreshPolicySchema,
  lastRefreshedAt: z.string().datetime({ offset: true }).nullable(),
  optedOutAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
