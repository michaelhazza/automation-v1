/**
 * workflowPublishService — wraps WorkflowTemplateService.publishOrgTemplate
 * with concurrent-edit detection.
 *
 * Concurrent-edit detection is delegated to publishOrgTemplate and performed
 * atomically inside its DB transaction — no TOCTOU window.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14a.
 */

import { WorkflowTemplateService } from './workflowTemplateService.js';
import { workflowTemplateVersions } from '../db/schema/index.js';
import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import type { WorkflowStep, WorkflowDefinition } from '../lib/workflow/types.js';

export const workflowPublishService = {
  async publish(params: {
    organisationId: string;
    templateId: string;
    steps: WorkflowStep[];
    publishNotes?: string;
    expectedUpstreamUpdatedAt?: string;
    userId: string;
  }): Promise<{ versionId: string; versionNumber: number }> {
    // 1. Load the template (scoped to org)
    const template = await WorkflowTemplateService.getOrgTemplate(
      params.organisationId,
      params.templateId
    );
    if (!template) {
      throw { statusCode: 404, message: 'Workflow template not found' };
    }

    // 2. Load latest version for initialInputSchema
    const latestVersionRow = await WorkflowTemplateService.getOrgTemplateLatestVersion(
      params.templateId
    );
    const latestDef = latestVersionRow?.definitionJson as Record<string, unknown> | null;

    // 3. Reconstruct WorkflowDefinition
    const newVersion = template.latestVersion + 1;
    const def: WorkflowDefinition = {
      slug: template.slug,
      name: template.name,
      description: template.description,
      version: newVersion,
      initialInputSchema: (latestDef?.initialInputSchema ?? null) as WorkflowDefinition['initialInputSchema'],
      steps: params.steps,
    };

    // 4. Publish — concurrent-edit check is atomic inside publishOrgTemplate's transaction
    await WorkflowTemplateService.publishOrgTemplate(
      params.organisationId,
      params.templateId,
      def,
      params.userId,
      params.publishNotes,
      params.expectedUpstreamUpdatedAt ? new Date(params.expectedUpstreamUpdatedAt) : undefined
    );

    // 5. Fetch the new version row for its UUID
    const [newVersionRow] = await db
      .select({ id: workflowTemplateVersions.id, version: workflowTemplateVersions.version })
      .from(workflowTemplateVersions)
      .where(
        and(
          eq(workflowTemplateVersions.templateId, params.templateId),
          eq(workflowTemplateVersions.version, newVersion)
        )
      );

    if (!newVersionRow) {
      throw {
        statusCode: 500,
        message: 'Version row not found after publish',
        errorCode: 'publish_inconsistent',
      };
    }
    return { versionId: newVersionRow.id, versionNumber: newVersionRow.version };
  },
};
