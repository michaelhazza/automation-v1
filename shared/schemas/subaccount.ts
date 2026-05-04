import { z } from 'zod';

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
