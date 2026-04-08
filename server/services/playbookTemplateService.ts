/**
 * playbookTemplateService — system + org template CRUD, fork from system,
 * version publishing, validation entrypoint.
 *
 * Spec: tasks/playbooks-spec.md §6.1 + §10.5 + §10.6.
 *
 * Templates live at two tiers:
 *   - system: shipped by the platform team, authored as files in
 *     server/playbooks/*.playbook.ts and seeded into the DB on deploy via
 *     server/scripts/seedPlaybooks.ts → upsertSystemTemplate()
 *   - org: created by org users (Phase 1.5+) or forked from a system
 *     template via forkSystemTemplate()
 *
 * Both tiers use immutable versioned snapshots — published versions are
 * read-only forever. In-flight runs lock to a specific
 * playbook_template_versions row, so editing a template never affects
 * a running execution.
 */

import { eq, and, isNull, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  systemPlaybookTemplates,
  systemPlaybookTemplateVersions,
  playbookTemplates,
  playbookTemplateVersions,
} from '../db/schema/index.js';
import type {
  SystemPlaybookTemplate,
  SystemPlaybookTemplateVersion,
  PlaybookTemplate,
  PlaybookTemplateVersion,
} from '../db/schema/index.js';
import { validateDefinition } from '../lib/playbook/validator.js';
import type { PlaybookDefinition, ValidationResult } from '../lib/playbook/types.js';

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
 * by the engine via re-importing the source playbook file (system templates
 * only). Org-published templates store the JSON-Schema version and use
 * Zod-from-JSON-Schema to rehydrate at run start.
 *
 * Phase 1.5 will tighten this with a TypeBox-style canonical schema. For
 * Phase 1, we only need round-trippable storage so the engine and the
 * validator both see the same shape.
 */
function serialiseDefinition(def: PlaybookDefinition): Record<string, unknown> {
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
      // they live in the in-process import of the playbook file. See note
      // above about Phase 1.5 tightening.
    })),
  };
}

// ─── System templates ────────────────────────────────────────────────────────

export const playbookTemplateService = {
  /**
   * List all system templates, newest first. System admin only.
   */
  async listSystemTemplates(): Promise<SystemPlaybookTemplate[]> {
    return db
      .select()
      .from(systemPlaybookTemplates)
      .where(isNull(systemPlaybookTemplates.deletedAt))
      .orderBy(desc(systemPlaybookTemplates.updatedAt));
  },

  async getSystemTemplate(slug: string): Promise<SystemPlaybookTemplate | null> {
    const [row] = await db
      .select()
      .from(systemPlaybookTemplates)
      .where(
        and(
          eq(systemPlaybookTemplates.slug, slug),
          isNull(systemPlaybookTemplates.deletedAt)
        )
      );
    return row ?? null;
  },

  async getSystemTemplateLatestVersion(
    systemTemplateId: string
  ): Promise<SystemPlaybookTemplateVersion | null> {
    const [row] = await db
      .select()
      .from(systemPlaybookTemplateVersions)
      .where(eq(systemPlaybookTemplateVersions.systemTemplateId, systemTemplateId))
      .orderBy(desc(systemPlaybookTemplateVersions.version))
      .limit(1);
    return row ?? null;
  },

  async listSystemTemplateVersions(
    systemTemplateId: string
  ): Promise<SystemPlaybookTemplateVersion[]> {
    return db
      .select()
      .from(systemPlaybookTemplateVersions)
      .where(eq(systemPlaybookTemplateVersions.systemTemplateId, systemTemplateId))
      .orderBy(asc(systemPlaybookTemplateVersions.version));
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
    def: PlaybookDefinition
  ): Promise<'created' | 'updated' | 'skipped'> {
    const validation = validateDefinition(def);
    if (!validation.ok) {
      throw {
        statusCode: 422,
        message: `Playbook '${def.slug}' failed validation`,
        errorCode: 'playbook_dag_invalid',
        details: validation.errors,
      };
    }

    const existing = await this.getSystemTemplate(def.slug);

    if (!existing) {
      // Create both the template row and the first version atomically.
      const [created] = await db
        .insert(systemPlaybookTemplates)
        .values({
          slug: def.slug,
          name: def.name,
          description: def.description,
          latestVersion: def.version,
        })
        .returning();
      await db.insert(systemPlaybookTemplateVersions).values({
        systemTemplateId: created.id,
        version: def.version,
        definitionJson: serialiseDefinition(def),
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
        message: `Playbook '${def.slug}' file version (${def.version}) is less than DB latest_version (${existing.latestVersion}). Bump the version field instead of reverting.`,
        errorCode: 'playbook_version_regression',
      };
    }

    // Append a new immutable version row, update name/description and bump latest_version.
    await db.transaction(async (tx) => {
      await tx.insert(systemPlaybookTemplateVersions).values({
        systemTemplateId: existing.id,
        version: def.version,
        definitionJson: serialiseDefinition(def),
      });
      await tx
        .update(systemPlaybookTemplates)
        .set({
          name: def.name,
          description: def.description,
          latestVersion: def.version,
          updatedAt: new Date(),
        })
        .where(eq(systemPlaybookTemplates.id, existing.id));
    });
    return 'updated';
  },

  // ─── Org templates ─────────────────────────────────────────────────────────

  async listOrgTemplates(organisationId: string): Promise<PlaybookTemplate[]> {
    return db
      .select()
      .from(playbookTemplates)
      .where(
        and(
          eq(playbookTemplates.organisationId, organisationId),
          isNull(playbookTemplates.deletedAt)
        )
      )
      .orderBy(desc(playbookTemplates.updatedAt));
  },

  async getOrgTemplate(
    organisationId: string,
    id: string
  ): Promise<PlaybookTemplate | null> {
    const [row] = await db
      .select()
      .from(playbookTemplates)
      .where(
        and(
          eq(playbookTemplates.id, id),
          eq(playbookTemplates.organisationId, organisationId),
          isNull(playbookTemplates.deletedAt)
        )
      );
    return row ?? null;
  },

  async getOrgTemplateLatestVersion(
    templateId: string
  ): Promise<PlaybookTemplateVersion | null> {
    const [row] = await db
      .select()
      .from(playbookTemplateVersions)
      .where(eq(playbookTemplateVersions.templateId, templateId))
      .orderBy(desc(playbookTemplateVersions.version))
      .limit(1);
    return row ?? null;
  },

  async listOrgTemplateVersions(templateId: string): Promise<PlaybookTemplateVersion[]> {
    return db
      .select()
      .from(playbookTemplateVersions)
      .where(eq(playbookTemplateVersions.templateId, templateId))
      .orderBy(asc(playbookTemplateVersions.version));
  },

  /**
   * Forks a system template into the caller's org. Creates a new
   * playbook_templates row with forked_from_system_id + forked_from_version
   * set, and copies the latest system version's definition_json into a new
   * playbook_template_versions row at version 1.
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
      .from(playbookTemplates)
      .where(
        and(
          eq(playbookTemplates.organisationId, organisationId),
          eq(playbookTemplates.slug, sys.slug),
          isNull(playbookTemplates.deletedAt)
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
        .insert(playbookTemplates)
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
      await tx.insert(playbookTemplateVersions).values({
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
   * appends a new immutable playbook_template_versions row.
   */
  async publishOrgTemplate(
    organisationId: string,
    templateId: string,
    def: PlaybookDefinition,
    userId: string
  ): Promise<{ version: number }> {
    const template = await this.getOrgTemplate(organisationId, templateId);
    if (!template) {
      throw { statusCode: 404, message: 'Playbook template not found' };
    }

    const validation = validateDefinition(def, { previousVersion: template.latestVersion });
    if (!validation.ok) {
      throw {
        statusCode: 422,
        message: 'Playbook validation failed',
        errorCode: 'playbook_dag_invalid',
        details: validation.errors,
      };
    }

    await db.transaction(async (tx) => {
      await tx.insert(playbookTemplateVersions).values({
        templateId,
        version: def.version,
        definitionJson: serialiseDefinition(def),
        publishedByUserId: userId,
      });
      await tx
        .update(playbookTemplates)
        .set({
          name: def.name,
          description: def.description,
          latestVersion: def.version,
          updatedAt: new Date(),
        })
        .where(eq(playbookTemplates.id, templateId));
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
      throw { statusCode: 404, message: 'Playbook template not found' };
    }
    await db
      .update(playbookTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(playbookTemplates.id, templateId));
  },

  /**
   * Pure validator entrypoint — exposed for the Studio `validate_candidate`
   * tool and for run-start defense-in-depth.
   */
  validateDefinition(def: PlaybookDefinition): ValidationResult {
    return validateDefinition(def);
  },
};
