/**
 * workflowPublishService.ts — publish-with-notes + concurrent-edit detection.
 *
 * Spec: tasks/Workflows-spec.md §10.4, §10.5.
 *
 * Wraps WorkflowTemplateService.publishOrgTemplate with:
 *   1. Concurrent-edit guard: compare expectedUpstreamUpdatedAt against the
 *      latest version's publishedAt timestamp.
 *   2. Validation via workflowValidatorPure (same rules as publishOrgTemplate;
 *      duplicated here so the route can return the structured result shape
 *      without letting the service throw).
 *   3. Publish notes written to workflow_template_versions.publish_notes.
 *
 * The result type is a discriminated union — the route translates it to the
 * HTTP response:
 *   ok             → 200 { version_id, version_number }
 *   validation_failed → 422 { error: 'validation_failed', errors: [] }
 *   concurrent_publish → 409 { error: 'concurrent_publish', ... }
 */

import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowTemplates, workflowTemplateVersions } from '../db/schema/index.js';
import { validate as validateV1Rules } from './workflowValidatorPure.js';
import type { ValidatorError } from '../../shared/types/workflowValidator.js';
import type { WorkflowStepDefinition } from './workflowValidatorPure.js';

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface PublishWithNotesInput {
  templateId: string;
  /** Step definitions to publish. Validated before any DB writes. */
  steps: WorkflowStepDefinition[];
  publishNotes?: string;
  /**
   * ISO 8601 timestamp the caller observed as the latest version's timestamp
   * when it opened the canvas. When provided, compared against the current
   * latest version's publishedAt. Mismatch → concurrent_publish result.
   */
  expectedUpstreamUpdatedAt?: string;
  organisationId: string;
  callerUserId: string;
}

export type PublishWithNotesResult =
  | { ok: true; versionId: string; versionNumber: number }
  | {
      ok: false;
      reason: 'concurrent_publish';
      upstreamUpdatedAt: string;
      upstreamUserId: string | null;
    }
  | { ok: false; reason: 'validation_failed'; errors: ValidatorError[] };

// ─── Pure helpers (extracted for unit testing) ────────────────────────────────

/**
 * Decide the publish outcome based on concurrency check + validator result.
 *
 * Pure function — no DB calls. Used directly in unit tests.
 */
export function decidePublishOutcome(input: {
  expectedTimestamp: string | undefined;
  currentTimestamp: string;
  currentUserId: string | null;
  validatorOk: boolean;
  validatorErrors: ValidatorError[];
}): 'ok' | 'concurrent_publish' | 'validation_failed' {
  const { expectedTimestamp, currentTimestamp, validatorOk, validatorErrors } = input;

  if (
    expectedTimestamp !== undefined &&
    new Date(currentTimestamp) > new Date(expectedTimestamp)
  ) {
    return 'concurrent_publish';
  }

  if (!validatorOk || validatorErrors.length > 0) {
    return 'validation_failed';
  }

  return 'ok';
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const WorkflowPublishService = {
  /**
   * Publish a new version of an org template with optional notes and
   * concurrent-edit detection.
   *
   * Does NOT throw on validation_failed or concurrent_publish — returns the
   * structured result shape instead. The route translates to HTTP status codes.
   *
   * Throws with { statusCode, message } for unexpected errors (template not
   * found, DB errors).
   */
  async publishWithNotes(
    input: PublishWithNotesInput
  ): Promise<PublishWithNotesResult> {
    const {
      templateId,
      steps,
      publishNotes,
      expectedUpstreamUpdatedAt,
      organisationId,
      callerUserId,
    } = input;

    // ── Load template ──────────────────────────────────────────────────────
    const [template] = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, templateId))
      .limit(1);

    if (!template || template.organisationId !== organisationId || template.deletedAt) {
      throw { statusCode: 404, message: 'Workflow template not found' };
    }

    // ── Load latest version for concurrent-edit detection ──────────────────
    const [latestVersion] = await db
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.templateId, templateId))
      .orderBy(desc(workflowTemplateVersions.version))
      .limit(1);

    // ── Run V1 validation ──────────────────────────────────────────────────
    // Accept legacy type names when the template was forked from a system
    // template (may still carry engine names from the fork).
    const acceptLegacyTypes = !!template.forkedFromSystemId;
    const validatorResult = validateV1Rules({ steps }, { acceptLegacyTypes });

    // ── Decide outcome ─────────────────────────────────────────────────────
    const currentTimestamp = latestVersion?.publishedAt?.toISOString() ?? new Date(0).toISOString();
    const currentUserId = latestVersion?.publishedByUserId ?? null;

    const outcome = decidePublishOutcome({
      expectedTimestamp: expectedUpstreamUpdatedAt,
      currentTimestamp,
      currentUserId,
      validatorOk: validatorResult.ok,
      validatorErrors: validatorResult.errors,
    });

    if (outcome === 'concurrent_publish') {
      return {
        ok: false,
        reason: 'concurrent_publish',
        upstreamUpdatedAt: currentTimestamp,
        upstreamUserId: currentUserId,
      };
    }

    if (outcome === 'validation_failed') {
      return {
        ok: false,
        reason: 'validation_failed',
        errors: validatorResult.errors,
      };
    }

    // ── Persist new version ────────────────────────────────────────────────
    const newVersionNumber = template.latestVersion + 1;

    let newVersionId!: string;
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(workflowTemplateVersions)
        .values({
          templateId,
          version: newVersionNumber,
          definitionJson: { steps } as Record<string, unknown>,
          publishedByUserId: callerUserId,
          publishNotes: publishNotes ?? null,
        })
        .returning({ id: workflowTemplateVersions.id });
      newVersionId = inserted.id;

      await tx
        .update(workflowTemplates)
        .set({ latestVersion: newVersionNumber, updatedAt: new Date() })
        .where(eq(workflowTemplates.id, templateId));
    });

    return { ok: true, versionId: newVersionId, versionNumber: newVersionNumber };
  },
};
