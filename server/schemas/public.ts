import { z } from 'zod';

// Form submission accepts arbitrary fields as a flat record
export const formSubmissionBody = z.object({}).passthrough();
export type FormSubmissionInput = z.infer<typeof formSubmissionBody>;

// Page view tracking
export const pageTrackingBody = z.object({
  pageId: z.string().uuid(),
  sessionId: z.string().max(200).optional(),
  referrer: z.string().max(2000).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
}).strict();
export type PageTrackingInput = z.infer<typeof pageTrackingBody>;
