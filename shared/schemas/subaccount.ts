import { z } from 'zod';
import { ALL_METRIC_SLUGS, type BaselineMetricSlug } from '../constants/baselineMetrics.js';

const tier12ArtefactEntry = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed', 'skipped']),
  captured_at: z.string().datetime().nullable(),
  skipped_at: z.string().datetime().nullable(),
  memory_block_id: z.string().uuid().nullable(),
  captured_by_user_id: z.string().uuid().nullable(),
}).refine(
  (entry) => !(entry.captured_at !== null && entry.skipped_at !== null),
  { message: 'captured_at and skipped_at are mutually exclusive' },
);

const tier3ArtefactEntry = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed', 'skipped']),
  captured_at: z.string().datetime().nullable(),
  skipped_at: z.string().datetime().nullable(),
  workspace_memory_id: z.string().uuid().nullable(),
  captured_by_user_id: z.string().uuid().nullable(),
}).refine(
  (entry) => !(entry.captured_at !== null && entry.skipped_at !== null),
  { message: 'captured_at and skipped_at are mutually exclusive' },
);

export const baselineArtefactsStatusSchema = z.object({
  version: z.literal(1),
  tier1: z.object({
    brand_identity: tier12ArtefactEntry,
    voice_tone: tier12ArtefactEntry,
  }),
  tier2: z.object({
    offer_positioning: tier12ArtefactEntry,
    audience_icp: tier12ArtefactEntry,
  }),
  tier3: z.object({
    operating_constraints: tier3ArtefactEntry,
    proof_library: tier3ArtefactEntry,
  }),
}).superRefine((data, ctx) => {
  const tier12Entries = [
    data.tier1.brand_identity,
    data.tier1.voice_tone,
    data.tier2.offer_positioning,
    data.tier2.audience_icp,
  ];
  for (const entry of tier12Entries) {
    if (entry.status === 'skipped') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tier-1 and Tier-2 artefacts cannot be skipped',
      });
    }
  }
});

export type BaselineArtefactsStatus = z.infer<typeof baselineArtefactsStatusSchema>;

/**
 * Returns true when all Tier-1 and Tier-2 artefacts are 'completed'.
 * Tier-3 may be in any state — skip-and-complete-later is permitted.
 */
export function isWizardCompletable(status: BaselineArtefactsStatus): boolean {
  const tier12Entries = [
    status.tier1.brand_identity,
    status.tier1.voice_tone,
    status.tier2.offer_positioning,
    status.tier2.audience_icp,
  ];
  return tier12Entries.every((e) => e.status === 'completed');
}

/**
 * Parses the JSONB blob and verifies it carries the expected version.
 * Throws a typed error if the version does not match — service code must not
 * operate on an unknown shape.
 */
export function assertVersionGate(
  raw: unknown,
  expectedVersion: 1,
): BaselineArtefactsStatus {
  const version = (raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>).version : undefined);
  if (version !== expectedVersion) {
    throw {
      statusCode: 500,
      message: 'baseline_artefacts_status version mismatch',
      errorCode: 'BASELINE_ARTEFACTS_VERSION_MISMATCH',
    };
  }
  return baselineArtefactsStatusSchema.parse(raw);
}

/**
 * F3 §2 — opt-in subset of baseline metrics for this subaccount. Stored in
 * subaccounts.settings JSONB under the key `baseline_metrics_opt_in`. When
 * absent, default = full v1 set (all slugs from ALL_METRIC_SLUGS).
 */
export const subaccountSettingsSchema = z.object({
  baseline_metrics_opt_in: z.array(z.enum(ALL_METRIC_SLUGS as [BaselineMetricSlug, ...BaselineMetricSlug[]])).optional(),
}).passthrough();  // allow other settings keys (existing JSONB shape is open)

export type SubaccountSettings = z.infer<typeof subaccountSettingsSchema>;

/**
 * F3 — resolve the effective opt-in metric set for a subaccount, defaulting
 * to ALL_METRIC_SLUGS when the field is absent or settings is null.
 */
export function resolveBaselineOptIn(rawSettings: unknown): readonly BaselineMetricSlug[] {
  if (!rawSettings || typeof rawSettings !== 'object') return ALL_METRIC_SLUGS;
  const parsed = subaccountSettingsSchema.safeParse(rawSettings);
  if (!parsed.success) return ALL_METRIC_SLUGS;
  return parsed.data.baseline_metrics_opt_in ?? ALL_METRIC_SLUGS;
}
