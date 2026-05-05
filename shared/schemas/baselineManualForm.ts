import { z } from 'zod';
import { ALL_METRIC_SLUGS, metricMeta, type BaselineMetricSlug } from '../constants/baselineMetrics.js';

// F3 §6 — manual entry validation. The currency field is required when the metric
// unit is 'cents'; cross-field check via superRefine because zod cannot express
// the conditional inline without restructuring the input shape.
export const manualMetricInputSchema = z
  .object({
    slug: z.enum(ALL_METRIC_SLUGS as [BaselineMetricSlug, ...BaselineMetricSlug[]]),
    numeric: z.number().nonnegative(),
    currency: z.string().length(3).optional(),
  })
  .superRefine((val, ctx) => {
    const meta = metricMeta(val.slug);
    if (meta.unit === 'cents' && (val.currency === undefined || val.currency.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: `currency is required for metric '${val.slug}' (unit=cents)`,
      });
    }
  });

export const manualBaselineFormSchema = z.object({
  metrics: z.array(manualMetricInputSchema).min(1),
});

export const adminResetSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type ManualBaselineForm = z.infer<typeof manualBaselineFormSchema>;
export type AdminResetPayload = z.infer<typeof adminResetSchema>;
