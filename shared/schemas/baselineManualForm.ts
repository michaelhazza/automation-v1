import { z } from 'zod';
import { ALL_METRIC_SLUGS, type BaselineMetricSlug } from '../constants/baselineMetrics.js';

export const manualMetricInputSchema = z.object({
  slug: z.enum(ALL_METRIC_SLUGS as [BaselineMetricSlug, ...BaselineMetricSlug[]]),
  numeric: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
});

export const manualBaselineFormSchema = z.object({
  metrics: z.array(manualMetricInputSchema).min(1),
});

export const adminResetSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type ManualBaselineForm = z.infer<typeof manualBaselineFormSchema>;
export type AdminResetPayload = z.infer<typeof adminResetSchema>;
