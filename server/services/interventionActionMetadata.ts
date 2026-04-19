/**
 * interventionActionMetadataSchema — typed contract for `actions.metadataJson`
 * when the action is a Phase 4 intervention primitive (the 5 namespaced
 * `crm.*` / `clientpulse.operator_alert` slugs).
 *
 * Purpose: prevent implicit schema creep. The metadata column is JSONB, so
 * anything could land there at runtime — this zod schema locks the shape
 * down at the service boundary (proposer job + operator-driven route both
 * validate via `validateInterventionActionMetadata` before insert).
 *
 * Locked contract (b) in the pickup prompt enumerates the required fields;
 * this module is the single source of truth.
 */

import { z } from 'zod';

export const INTERVENTION_BANDS = ['healthy', 'watch', 'atRisk', 'critical'] as const;
export const INTERVENTION_RECOMMENDED_BY = ['scenario_detector', 'operator_manual'] as const;

export const interventionActionMetadataSchema = z
  .object({
    triggerTemplateSlug: z.string().min(1).nullable().optional(),
    triggerReason: z.string().min(1).max(5_000),
    bandAtProposal: z.enum(INTERVENTION_BANDS).nullable().optional(),
    healthScoreAtProposal: z.number().int().min(0).max(100).nullable().optional(),
    configVersion: z.string().nullable().optional(),
    recommendedBy: z.enum(INTERVENTION_RECOMMENDED_BY),

    // Set when recommendedBy='scenario_detector'
    churnAssessmentId: z.string().uuid().optional(),
    priority: z.number().int().optional(),

    // Set when recommendedBy='operator_manual'
    operatorRationale: z.string().min(1).max(5_000).optional(),
    scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.recommendedBy === 'scenario_detector' && !val.churnAssessmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['churnAssessmentId'],
        message: 'churnAssessmentId required when recommendedBy=scenario_detector',
      });
    }
    if (val.recommendedBy === 'operator_manual' && !val.operatorRationale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['operatorRationale'],
        message: 'operatorRationale required when recommendedBy=operator_manual',
      });
    }
  });

export type InterventionActionMetadata = z.infer<typeof interventionActionMetadataSchema>;

/**
 * Validate + narrow metadata at write time. Throws
 * `{ statusCode: 500, errorCode: 'INVALID_METADATA', issues }` when the
 * service layer builds a metadata object that doesn't match the contract —
 * that's a programming error (caller bug), not user input, so it's a 500.
 *
 * Callers should call this immediately before the `actions` insert.
 */
export function validateInterventionActionMetadata(
  metadata: Record<string, unknown>,
): InterventionActionMetadata {
  const result = interventionActionMetadataSchema.safeParse(metadata);
  if (!result.success) {
    throw {
      statusCode: 500,
      message: 'Intervention action metadata failed typed contract validation',
      errorCode: 'INVALID_METADATA',
      issues: result.error.issues,
    };
  }
  return result.data;
}
