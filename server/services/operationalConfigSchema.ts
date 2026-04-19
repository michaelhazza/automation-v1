/**
 * JSON Schema (via Zod) for `operational_config` on `hierarchy_templates` and
 * `system_hierarchy_templates`. Ship-gate B4 (§17.6.1, §26.1) — sensitive-path
 * enumeration + sum-constraint validation for health-score weights.
 *
 * Spec: tasks/clientpulse-ghl-gap-analysis.md §§12.2, 17.6.
 *
 * This module is intentionally pure — no DB, no env, no I/O. Imported by the
 * Configuration Agent skill (Phase 4.5, deferred) and test suite directly.
 *
 * `SENSITIVE_CONFIG_PATHS` is the source-of-truth list of dot-paths that must
 * route through the action→review queue rather than write directly. Phase 4.5's
 * sensitive-path router (B5) consumes this list.
 */

import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────────────────

const weight01 = z.number().min(0).max(1);
const weightPos = z.number().min(0).max(10);
const percent0to100 = z.number().min(0).max(100);

const bandTuple = z.tuple([z.number().int().min(0).max(100), z.number().int().min(0).max(100)]);

// ── Existing block schemas (summary — full shape lives in orgConfigService.ts types) ──

const healthScoreFactorSchema = z.object({
  metricSlug: z.string().min(1),
  weight: weight01,
  label: z.string().min(1),
  periodType: z.string().optional(),
  normalisation: z.object({
    type: z.enum(['linear', 'inverse_linear', 'threshold', 'percentile']),
    minValue: z.number(),
    maxValue: z.number(),
    invertDirection: z.boolean().optional(),
  }),
});

const churnRiskSignalSchema = z.object({
  signalSlug: z.string().min(1),
  weight: weight01,
  type: z.enum(['metric_trend', 'metric_threshold', 'staleness', 'anomaly_count', 'health_score_level']),
  metricSlug: z.string().optional(),
  condition: z.string().optional(),
  periods: z.number().int().positive().optional(),
  thresholdValue: z.number().optional(),
  maxDaysInactive: z.number().int().positive().optional(),
});

// ── ClientPulse block schemas (§12.2 Gap A) ────────────────────────────────

export const staffActivityDefinitionSchema = z.object({
  countedMutationTypes: z
    .array(z.object({ type: z.string().min(1), weight: weightPos }))
    .min(1),
  excludedUserKinds: z.array(z.enum(['automation', 'contact', 'unknown', 'staff'])),
  automationUserResolution: z.object({
    strategy: z.enum(['outlier_by_volume', 'named_list']),
    threshold: z.number().min(0).max(1),
    cacheMonths: z.number().int().positive(),
  }),
  lookbackWindowsDays: z.array(z.number().int().positive()).min(1),
  churnFlagThresholds: z.object({
    zeroActivityDays: z.number().int().positive(),
    weekOverWeekDropPct: percent0to100,
  }),
});

export const integrationFingerprintConfigSchema = z.object({
  seedLibrary: z.array(
    z.object({
      integrationSlug: z.string().min(1),
      displayName: z.string().min(1),
      vendorUrl: z.string().url().optional(),
      fingerprints: z
        .array(
          z.object({
            type: z.enum([
              'conversation_provider_id',
              'workflow_action_type',
              'outbound_webhook_domain',
              'custom_field_prefix',
              'tag_prefix',
              'contact_source',
            ]),
            value: z.string().optional(),
            valuePattern: z.string().optional(),
          }).refine((d) => d.value !== undefined || d.valuePattern !== undefined, {
            message: 'fingerprint must declare either value or valuePattern',
          }),
        )
        .min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  scanFingerprintTypes: z.array(z.string().min(1)),
  unclassifiedSignalPromotion: z.object({
    surfaceAfterOccurrenceCount: z.number().int().positive(),
    surfaceAfterSubaccountCount: z.number().int().positive(),
  }),
});

export const churnBandsSchema = z
  .object({
    healthy: bandTuple,
    watch: bandTuple,
    atRisk: bandTuple,
    critical: bandTuple,
  })
  .refine(
    (b) => b.healthy[0] <= b.healthy[1] && b.watch[0] <= b.watch[1] && b.atRisk[0] <= b.atRisk[1] && b.critical[0] <= b.critical[1],
    { message: 'each band must be [low, high] with low <= high' },
  );

export const interventionDefaultsSchema = z.object({
  cooldownHours: z.number().int().positive(),
  cooldownScope: z.enum(['proposed', 'executed', 'any_outcome']),
  defaultGateLevel: z.enum(['auto', 'review']),
  maxProposalsPerDayPerSubaccount: z.number().int().positive(),
  maxProposalsPerDayPerOrg: z.number().int().positive(),
});

export const onboardingMilestoneDefSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  targetDays: z.number().int().positive(),
  signal: z.string().min(1),
});

// ── Full operational_config schema ─────────────────────────────────────────

export const operationalConfigSchema = z
  .object({
    healthScoreFactors: z.array(healthScoreFactorSchema).optional(),
    churnRiskSignals: z.array(churnRiskSignalSchema).optional(),
    staffActivity: staffActivityDefinitionSchema.optional(),
    integrationFingerprints: integrationFingerprintConfigSchema.optional(),
    churnBands: churnBandsSchema.optional(),
    interventionDefaults: interventionDefaultsSchema.optional(),
    onboardingMilestones: z.array(onboardingMilestoneDefSchema).optional(),
    // Remaining top-level keys (alertLimits, coldStartConfig, dataRetention, anomalyConfig,
    // interventionTypes, execution scaling knobs) are validated loosely here — their strict
    // schemas live in orgConfigService.ts types and can tighten incrementally.
  })
  .passthrough()
  .superRefine((cfg, ctx) => {
    if (cfg.healthScoreFactors && cfg.healthScoreFactors.length > 0) {
      const sum = cfg.healthScoreFactors.reduce((acc, f) => acc + f.weight, 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['healthScoreFactors'],
          message: `healthScoreFactors weights must sum to 1.0 (got ${sum.toFixed(3)})`,
        });
      }
    }
  });

export type OperationalConfigValidated = z.infer<typeof operationalConfigSchema>;

// ── Sensitive paths — B5 routing consumes this list (Phase 4.5) ────────────
//
// Dot-paths into `operational_config` that MUST route through the action→review
// queue rather than write directly. Per §17.6.2, these are paths where a
// misconfiguration would have meaningful business or trust impact on the org.

export const SENSITIVE_CONFIG_PATHS: readonly string[] = Object.freeze([
  // Intervention governance — changes affect every subsequent proposal
  'interventionDefaults.defaultGateLevel',
  'interventionDefaults.cooldownHours',
  'interventionDefaults.maxProposalsPerDayPerSubaccount',
  'interventionDefaults.maxProposalsPerDayPerOrg',
  'interventionTemplates', // Phase 4.5+ — templates themselves are sensitive
  // Scoring / band definitions — changing these reshapes every client's view
  'healthScoreFactors',
  'churnRiskSignals',
  'churnBands',
  // Staff-activity classification — excluding a user kind hides activity signals
  'staffActivity.excludedUserKinds',
  'staffActivity.automationUserResolution',
  'staffActivity.churnFlagThresholds',
  // Alert limits — lowering these can mask incidents
  'alertLimits.maxAlertsPerRun',
  'alertLimits.maxAlertsPerAccountPerDay',
  // Data retention — shortening destroys history
  'dataRetention',
]);

/**
 * Is the given dot-path considered sensitive and thus required to route through
 * the action→review queue (B5)?
 *
 * Matches prefix: `interventionDefaults.cooldownHours` matches input
 * `interventionDefaults.cooldownHours` and also any deeper sub-path
 * `interventionDefaults.cooldownHours.anything`.
 */
export function isSensitiveConfigPath(path: string): boolean {
  for (const sensitive of SENSITIVE_CONFIG_PATHS) {
    if (path === sensitive || path.startsWith(sensitive + '.')) return true;
  }
  return false;
}

/**
 * Validate an operational_config payload. Returns { ok, config } on success,
 * { ok: false, issues } on failure. Never throws.
 */
export function validateOperationalConfig(input: unknown):
  | { ok: true; config: OperationalConfigValidated }
  | { ok: false; issues: z.ZodIssue[] } {
  const result = operationalConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, issues: result.error.issues };
}
