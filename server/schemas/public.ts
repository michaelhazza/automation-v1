import { z } from 'zod';

// Form submission — accepts arbitrary form fields as key-value pairs.
// Validation is intentionally loose because field names are user-defined
// in the page builder. The service layer handles field-level validation.
// We enforce that it's a non-empty object to prevent garbage payloads.
export const formSubmissionBody = z.record(z.string(), z.unknown()).refine(
  obj => Object.keys(obj).length > 0,
  { message: 'Form submission must include at least one field' }
);
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
