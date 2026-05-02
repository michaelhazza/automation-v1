/**
 * WorkflowTemplateService — system + org template CRUD, fork from system,
 * version publishing, validation entrypoint.
 *
 * Spec: tasks/Workflows-spec.md §6.1 + §10.5 + §10.6.
 *
 * Templates live at two tiers:
 *   - system: shipped by the platform team, authored as files in
 *     server/Workflows/*.Workflow.ts and seeded into the DB on deploy via
 *     server/scripts/seedWorkflows.ts → upsertSystemTemplate()
 *   - org: created by org users (Phase 1.5+) or forked from a system
 *     template via forkSystemTemplate()
 *
 * Both tiers use immutable versioned snapshots — published versions are
 * read-only forever. In-flight runs lock to a specific
 * workflow_template_versions row, so editing a template never affects
 * a running execution.
 */

import { eq, and, isNull, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  systemWorkflowTemplates,
  systemWorkflowTemplateVersions,
  workflowTemplates,
  workflowTemplateVersions,
} from '../db/schema/index.js';
import type {
  SystemWorkflowTemplate,
  SystemWorkflowTemplateVersion,
  WorkflowTemplate,
  WorkflowTemplateVersion,
} from '../db/schema/index.js';
import { validateDefinition } from '../lib/workflow/validator.js';
import type { WorkflowDefinition, ValidationResult } from '../lib/workflow/types.js';
import { validate as validateV1Rules } from './workflowValidatorPure.js';
import type { ValidatorResult } from '../../shared/types/workflowValidator.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Serialise a definition for storage. Zod schemas inside the definition are
 * not directly serialisable — we replace them with their JSON Schema
 * representation when storing. The seeder ships the definition as JS so the
 * Zod objects exist at runtime; the database stores a JSON-Schema-friendly
 * version.
 *
 * For Phase 1 we keep things simple: store the slug + name + step shape +
 * structural fields. The actual Zod instances are reconstructed at run-time
 * by the engine via re-importing the source Workflow file (system templates
 * only). Org-published templates store the JSON-Schema version and use
 * Zod-from-JSON-Schema to rehydrate at run start.
 *
 * Phase 1.5 will tighten this with a TypeBox-style canonical schema. For
 * Phase 1, we only need round-trippable storage so the engine and the
 * validator both see the same shape.
 */
function serialiseDefinition(def: WorkflowDefinition): Record<string, unknown> {
  return {
    slug: def.slug,
    name: def.name,
    description: def.description,
    version: def.version,
    maxParallelSteps: def.maxParallelSteps,
    // Zod schemas are stripped — we store only their structural metadata
    // (which is enough for the engine to rehydrate via the in-process
    // reference for system templates). Org templates lose the Zod
    // instances on publish; the run engine re-validates outputs against
    // the structural shape we store here.
    steps: def.steps.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      dependsOn: s.dependsOn,
      humanReviewRequired: s.humanReviewRequired ?? false,
      sideEffectType: s.sideEffectType,
      failurePolicy: s.failurePolicy ?? 'fail_run',
      timeoutSeconds: s.timeoutSeconds,
      retryPolicy: s.retryPolicy,
      prompt: s.prompt,
      model: s.model,
      agentRef: s.agentRef,
      agentInputs: s.agentInputs,
      formDescription: s.formDescription,
      approvalPrompt: s.approvalPrompt,
      condition: s.condition,
      trueOutput: s.trueOutput,
      falseOutput: s.falseOutput,
      // outputSchema and formSchema are intentionally NOT serialised here;
      // they live in the in-process import of the Workflow file. See note
      // above about Phase 1.5 tightening.
    })),
  };
}

// ─── System templates ────────────────────────────────────────────────────────

export const WorkflowTemplateService = {
  /**
   * List all system templates, newest first. System admin only.
   */
  async listSystemTemplates(): Promise<SystemWorkflowTemplate[]> {
    return db
      .select()
      .from(systemWorkflowTemplates)
      .where(isNull(systemWorkflowTemplates.deletedAt))
      .orderBy(desc(systemWorkflowTemplates.updatedAt));
  },

  async getSystemTemplate(slug: string): Promise<SystemWorkflowTemplate | null> {
    const [row] = await db
      .select()
      .from(systemWorkflowTemplates)
      .where(
        and(
          eq(systemWorkflowTemplates.slug, slug),
          isNull(systemWorkflowTemplates.deletedAt)
        )
      );
    return row ?? null;
  },

  async getSystemTemplateLatestVersion(
    systemTemplateId: string
  ): Promise<SystemWorkflowTemplateVersion | null> {
    const [row] = await db
      .select()
      .from(systemWorkflowTemplateVersions)
      .where(eq(systemWorkflowTemplateVersions.systemTemplateId, systemTemplateId))
      .orderBy(desc(systemWorkflowTemplateVersions.version))
      .limit(1);
    return row ?? null;
  },

  async listSystemTemplateVersions(
    systemTemplateId: string
  ): Promise<SystemWorkflowTemplateVersion[]> {
    return db
      .select()
      .from(systemWorkflowTemplateVersions)
      .where(eq(systemWorkflowTemplateVersions.systemTemplateId, systemTemplateId))
      .orderBy(asc(systemWorkflowTemplateVersions.version));
  },

  /**
   * Seeder entrypoint. Validates the definition, then either creates a new
   * system template row + first version, or appends a new version if the
   * file's version number is greater than the current latest_version.
   *
   * Returns: 'created' | 'updated' | 'skipped' (no version change).
   * Throws: validation errors via throwing the ValidationResult shape.
   */
  async upsertSystemTemplate(
    def: WorkflowDefinition
  ): Promise<'created' | 'updated' | 'skipped'> {
    const validation = validateDefinition(def);
    if (!validation.ok) {
      throw {
        statusCode: 422,
        message: `Workflow '${def.slug}' failed validation`,
        errorCode: 'workflow_dag_invalid',
        details: validation.errors,
      };
    }

    // V1 publish-time rules. System templates use engine type names, so
    // acceptLegacyTypes is always true here.
    const v1Validation: ValidatorResult = validateV1Rules(
      { steps: def.steps.map((s) => ({ id: s.id, type: s.type, dependsOn: s.dependsOn, params: s.params })) },
      { acceptLegacyTypes: true }
    );
    if (!v1Validation.ok) {
      throw {
        statusCode: 422,
        message: `Workflow '${def.slug}' failed V1 validation`,
        errorCode: 'validation_failed',
        details: v1Validation.errors,
      };
    }

    const existing = await this.getSystemTemplate(def.slug);

    if (!existing) {
      // Create both the template row and the first version atomically.
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(systemWorkflowTemplates)
          .values({
            slug: def.slug,
            name: def.name,
            description: def.description,
            latestVersion: def.version,
          })
          .returning();
        await tx.insert(systemWorkflowTemplateVersions).values({
          systemTemplateId: created.id,
          version: def.version,
          definitionJson: serialiseDefinition(def),
        });
      });
      return 'created';
    }

    // Existing template — compare versions.
    if (def.version === existing.latestVersion) {
      return 'skipped';
    }
    if (def.version < existing.latestVersion) {
      throw {
        statusCode: 422,
        message: `Workflow '${def.slug}' file version (${def.version}) is less than DB latest_version (${existing.latestVersion}). Bump the version field instead of reverting.`,
        errorCode: 'workflow_version_regression',
      };
    }

    // Append a new immutable version row, update name/description and bump latest_version.
    await db.transaction(async (tx) => {
      await tx.insert(systemWorkflowTemplateVersions).values({
        systemTemplateId: existing.id,
        version: def.version,
        definitionJson: serialiseDefinition(def),
      });
      await tx
        .update(systemWorkflowTemplates)
        .set({
          name: def.name,
          description: def.description,
          latestVersion: def.version,
          updatedAt: new Date(),
        })
        .where(eq(systemWorkflowTemplates.id, existing.id));
    });
    return 'updated';
  },

  // ─── Org templates ─────────────────────────────────────────────────────────

  async listOrgTemplates(organisationId: string): Promise<WorkflowTemplate[]> {
    return db
      .select()
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.organisationId, organisationId),
          isNull(workflowTemplates.deletedAt)
        )
      )
      .orderBy(desc(workflowTemplates.updatedAt));
  },

  async getOrgTemplate(
    organisationId: string,
    id: string
  ): Promise<WorkflowTemplate | null> {
    const [row] = await db
      .select()
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.id, id),
          eq(workflowTemplates.organisationId, organisationId),
          isNull(workflowTemplates.deletedAt)
        )
      );
    return row ?? null;
  },

  async getOrgTemplateLatestVersion(
    templateId: string
  ): Promise<WorkflowTemplateVersion | null> {
    const [row] = await db
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.templateId, templateId))
      .orderBy(desc(workflowTemplateVersions.version))
      .limit(1);
    return row ?? null;
  },

  async listOrgTemplateVersions(templateId: string): Promise<WorkflowTemplateVersion[]> {
    return db
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.templateId, templateId))
      .orderBy(asc(workflowTemplateVersions.version));
  },

  /**
   * Forks a system template into the caller's org. Creates a new
   * workflow_templates row with forked_from_system_id + forked_from_version
   * set, and copies the latest system version's definition_json into a new
   * workflow_template_versions row at version 1.
   */
  async forkSystemTemplate(
    organisationId: string,
    systemTemplateSlug: string,
    userId: string
  ): Promise<{ id: string; version: number; forkedFromVersion: number }> {
    const sys = await this.getSystemTemplate(systemTemplateSlug);
    if (!sys) {
      throw { statusCode: 404, message: `System template '${systemTemplateSlug}' not found` };
    }
    const sysVersion = await this.getSystemTemplateLatestVersion(sys.id);
    if (!sysVersion) {
      throw {
        statusCode: 422,
        message: `System template '${systemTemplateSlug}' has no published version`,
      };
    }

    // Fail if an org template with the same slug already exists.
    const [existing] = await db
      .select()
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.organisationId, organisationId),
          eq(workflowTemplates.slug, sys.slug),
          isNull(workflowTemplates.deletedAt)
        )
      );
    if (existing) {
      throw {
        statusCode: 409,
        message: `Org already has a template with slug '${sys.slug}'`,
      };
    }

    let result!: { id: string; version: number; forkedFromVersion: number };
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workflowTemplates)
        .values({
          organisationId,
          slug: sys.slug,
          name: sys.name,
          description: sys.description,
          forkedFromSystemId: sys.id,
          forkedFromVersion: sysVersion.version,
          latestVersion: 1,
          createdByUserId: userId,
        })
        .returning();
      await tx.insert(workflowTemplateVersions).values({
        templateId: created.id,
        version: 1,
        definitionJson: sysVersion.definitionJson,
        publishedByUserId: userId,
      });
      result = { id: created.id, version: 1, forkedFromVersion: sysVersion.version };
    });
    return result;
  },

  /**
   * Publishes a new version of an org template. Re-runs the validator
   * against the supplied definition with strict version monotonicity, then
   * appends a new immutable workflow_template_versions row.
   */
  async publishOrgTemplate(
    organisationId: string,
    templateId: string,
    def: WorkflowDefinition,
    userId: string
  ): Promise<{ version: number }> {
    const template = await this.getOrgTemplate(organisationId, templateId);
    if (!template) {
      throw { statusCode: 404, message: 'Workflow template not found' };
    }

    const validation = validateDefinition(def, { previousVersion: template.latestVersion });
    if (!validation.ok) {
      throw {
        statusCode: 422,
        message: 'Workflow validation failed',
        errorCode: 'workflow_dag_invalid',
        details: validation.errors,
      };
    }

    // V1 publish-time rules. Accept legacy engine type names only when the
    // template was forked from a system template (may still carry engine names).
    // Fresh Studio-authored templates must use V1 user-facing type names.
    const acceptLegacyTypes = !!template.forkedFromSystemId;
    const v1Validation: ValidatorResult = validateV1Rules(
      { steps: def.steps.map((s) => ({ id: s.id, type: s.type, dependsOn: s.dependsOn, params: s.params })) },
      { acceptLegacyTypes }
    );
    if (!v1Validation.ok) {
      throw {
        statusCode: 422,
        message: 'Workflow template failed validation',
        errorCode: 'validation_failed',
        details: v1Validation.errors,
      };
    }

    await db.transaction(async (tx) => {
      await tx.insert(workflowTemplateVersions).values({
        templateId,
        version: def.version,
        definitionJson: serialiseDefinition(def),
        publishedByUserId: userId,
      });
      await tx
        .update(workflowTemplates)
        .set({
          name: def.name,
          description: def.description,
          latestVersion: def.version,
          updatedAt: new Date(),
        })
        .where(eq(workflowTemplates.id, templateId));
    });
    return { version: def.version };
  },

  /**
   * Soft-deletes an org template. The version rows stay so any in-flight
   * runs locked to a specific version continue to function.
   */
  async deleteOrgTemplate(organisationId: string, templateId: string): Promise<void> {
    const template = await this.getOrgTemplate(organisationId, templateId);
    if (!template) {
      throw { statusCode: 404, message: 'Workflow template not found' };
    }
    await db
      .update(workflowTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowTemplates.id, templateId));
  },

  /**
   * Pure validator entrypoint — exposed for the Studio `validate_candidate`
   * tool and for run-start defense-in-depth.
   */
  validateDefinition(def: WorkflowDefinition): ValidationResult {
    return validateDefinition(def);
  },
};
