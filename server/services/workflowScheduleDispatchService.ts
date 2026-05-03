/**
 * workflowScheduleDispatchService.ts — pinned-version resolution for schedule dispatch.
 *
 * Spec §3.1 + §5.4: when a schedule carries `pinned_template_version_id`, that
 * exact version is used regardless of newer published versions. If the pinned
 * version is missing, a structured error is thrown so the caller can mark the
 * run as failed.
 *
 * This function is PINNED-ONLY. The no-pin path (resolve latest published
 * version) goes through WorkflowTemplateService.getOrgTemplateLatestVersion or
 * its system-template equivalent — those already use the correct desc(version)
 * ordering and own the "what is the latest?" logic.
 *
 * Callers that do not have a pinned version should call the relevant
 * WorkflowTemplateService method directly, then pass the resolved version ID
 * to startRun().
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workflowTemplateVersions,
  workflowTemplates,
  systemWorkflowTemplateVersions,
  systemWorkflowTemplates,
} from '../db/schema/index.js';
// ─── Types ───────────────────────────────────────────────────────────────────

export interface PickVersionForScheduleInput {
  organisationId: string;
  /** The pinned template version ID from the schedule row. Required — no-pin path uses WorkflowTemplateService. */
  pinnedTemplateVersionId: string | null | undefined;
}

export interface PickVersionForScheduleResult {
  templateVersionId: string;
  definitionJson: Record<string, unknown>;
  /** Template slug for workflow_runs.workflow_slug. */
  slug: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const WorkflowScheduleDispatchService = {
  /**
   * Resolve the pinned template version for a scheduled dispatch.
   *
   * PINNED-ONLY: this function requires `pinnedTemplateVersionId` to be set.
   * The no-pin path (latest published) goes through WorkflowTemplateService.
   *
   * Throws `{ statusCode: 422, message: ..., errorCode: 'pinned_version_unavailable' }`
   * when the pinned version cannot be found in org or system tables.
   */
  async pickVersionForSchedule(
    input: PickVersionForScheduleInput,
  ): Promise<PickVersionForScheduleResult> {
    const { organisationId, pinnedTemplateVersionId } = input;

    if (!pinnedTemplateVersionId) {
      throw {
        statusCode: 422,
        message: 'Pinned template version unavailable',
        errorCode: 'pinned_version_unavailable',
      };
    }

    // Try org template versions first, then system template versions.
    // Filter on deletedAt only. workflow_template_versions has no separate
    // published-flag column (publishedAt is NOT NULL DEFAULT now(), so every
    // version row is "published" at creation). "exists and not deleted" is
    // therefore the correct proxy for "published" in this schema.
    const [orgVersion] = await db
      .select({
        id: workflowTemplateVersions.id,
        definitionJson: workflowTemplateVersions.definitionJson,
        templateSlug: workflowTemplates.slug,
      })
      .from(workflowTemplateVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplateVersions.templateId, workflowTemplates.id))
      .where(
        and(
          eq(workflowTemplateVersions.id, pinnedTemplateVersionId),
          eq(workflowTemplates.organisationId, organisationId),
          isNull(workflowTemplates.deletedAt),
        ),
      );

    if (orgVersion) {
      return {
        templateVersionId: orgVersion.id,
        definitionJson: orgVersion.definitionJson as Record<string, unknown>,
        slug: orgVersion.templateSlug,
      };
    }

    // Fall through: check system template versions.
    const [sysVersion] = await db
      .select({
        id: systemWorkflowTemplateVersions.id,
        definitionJson: systemWorkflowTemplateVersions.definitionJson,
        templateSlug: systemWorkflowTemplates.slug,
      })
      .from(systemWorkflowTemplateVersions)
      .innerJoin(
        systemWorkflowTemplates,
        eq(systemWorkflowTemplateVersions.systemTemplateId, systemWorkflowTemplates.id),
      )
      .where(eq(systemWorkflowTemplateVersions.id, pinnedTemplateVersionId));

    if (sysVersion) {
      return {
        templateVersionId: sysVersion.id,
        definitionJson: sysVersion.definitionJson as Record<string, unknown>,
        slug: sysVersion.templateSlug,
      };
    }

    // Pinned version not found in either org or system tables.
    throw {
      statusCode: 422,
      message: 'Pinned template version unavailable',
      errorCode: 'pinned_version_unavailable',
    };
  },
};
