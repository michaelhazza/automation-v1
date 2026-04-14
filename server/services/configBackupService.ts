import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  configBackups,
  systemSkills,
  systemAgents,
} from '../db/schema/index.js';
import type { ConfigBackupEntity } from '../db/schema/configBackups.js';

// ---------------------------------------------------------------------------
// Config Backup Service — create and restore point-in-time configuration
// snapshots. Scoped by organisation. Currently supports 'skill_analyzer'
// scope (system_skills + systemAgents.defaultSystemSkillSlugs); extensible
// to other scopes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Snapshot capture — scope-specific entity collection
// ---------------------------------------------------------------------------

/**
 * Capture all system_skills rows and systemAgent defaultSystemSkillSlugs.
 * This is enough to fully revert a skill analyser apply operation.
 */
async function captureSkillAnalyzerEntities(): Promise<ConfigBackupEntity[]> {
  const entities: ConfigBackupEntity[] = [];

  // Snapshot all system_skills (including inactive — analyser can reactivate)
  const skills = await db.select().from(systemSkills);
  for (const skill of skills) {
    entities.push({
      entityType: 'system_skill',
      entityId: skill.id,
      snapshot: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        definition: skill.definition,
        instructions: skill.instructions,
        isActive: skill.isActive,
        visibility: skill.visibility,
        handlerKey: skill.handlerKey,
      },
    });
  }

  // Snapshot all systemAgents' skill slug arrays (only the fields the analyser mutates)
  const agents = await db
    .select({
      id: systemAgents.id,
      slug: systemAgents.slug,
      defaultSystemSkillSlugs: systemAgents.defaultSystemSkillSlugs,
    })
    .from(systemAgents)
    .where(isNull(systemAgents.deletedAt));

  for (const agent of agents) {
    entities.push({
      entityType: 'system_agent_skills',
      entityId: agent.id,
      snapshot: {
        slug: agent.slug,
        defaultSystemSkillSlugs: agent.defaultSystemSkillSlugs,
      },
    });
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Restore logic — scope-specific entity restoration
// ---------------------------------------------------------------------------

/**
 * Restore system_skills and systemAgent skill slugs from a backup.
 *
 * Strategy:
 * 1. For system_skills in the backup: restore each to its snapshotted state
 * 2. For system_skills that exist now but NOT in the backup: they were created
 *    after the backup — deactivate them (isActive=false) rather than hard-deleting,
 *    to preserve referential integrity with skill_analyzer_results.resultingSkillId
 * 3. For system_agent_skills: restore defaultSystemSkillSlugs to snapshotted value
 */
async function restoreSkillAnalyzerEntities(entities: ConfigBackupEntity[]): Promise<{
  skillsReverted: number;
  skillsDeactivated: number;
  agentsReverted: number;
}> {
  let skillsReverted = 0;
  let skillsDeactivated = 0;
  let agentsReverted = 0;

  const skillEntities = entities.filter((e) => e.entityType === 'system_skill');
  const agentEntities = entities.filter((e) => e.entityType === 'system_agent_skills');
  const backupSkillIds = new Set(skillEntities.map((e) => e.entityId));

  await db.transaction(async (tx) => {
    // 1. Restore each snapshotted skill
    for (const entity of skillEntities) {
      const { snapshot } = entity;
      const existing = await tx
        .select({ id: systemSkills.id })
        .from(systemSkills)
        .where(eq(systemSkills.id, entity.entityId))
        .limit(1);

      if (existing[0]) {
        // Update to snapshotted state
        await tx
          .update(systemSkills)
          .set({
            name: snapshot.name as string,
            description: snapshot.description as string | null,
            definition: snapshot.definition as object,
            instructions: snapshot.instructions as string | null,
            isActive: snapshot.isActive as boolean,
            visibility: snapshot.visibility as string,
            handlerKey: snapshot.handlerKey as string,
            updatedAt: new Date(),
          })
          .where(eq(systemSkills.id, entity.entityId));
        skillsReverted++;
      }
      // If skill was deleted between backup and now — skip (don't recreate;
      // the slug may conflict, and recreation would need handler wiring)
    }

    // 2. Deactivate skills created after the backup
    const currentSkills = await tx.select({ id: systemSkills.id }).from(systemSkills);
    for (const skill of currentSkills) {
      if (!backupSkillIds.has(skill.id)) {
        await tx
          .update(systemSkills)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(systemSkills.id, skill.id));
        skillsDeactivated++;
      }
    }

    // 3. Restore agent skill slug arrays
    for (const entity of agentEntities) {
      const { snapshot } = entity;
      await tx
        .update(systemAgents)
        .set({
          defaultSystemSkillSlugs: snapshot.defaultSystemSkillSlugs as string[],
          updatedAt: new Date(),
        })
        .where(and(eq(systemAgents.id, entity.entityId), isNull(systemAgents.deletedAt)));
      agentsReverted++;
    }
  });

  return { skillsReverted, skillsDeactivated, agentsReverted };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const configBackupService = {
  /**
   * Create a backup before a bulk mutation.
   */
  async createBackup(params: {
    organisationId: string;
    scope: 'skill_analyzer' | 'manual' | 'config_agent';
    label: string;
    sourceId?: string;
    createdBy?: string;
  }): Promise<{ backupId: string }> {
    let entities: ConfigBackupEntity[];

    switch (params.scope) {
      case 'skill_analyzer':
        entities = await captureSkillAnalyzerEntities();
        break;
      default:
        // Future scopes will add capture functions here
        throw { statusCode: 400, message: `Unsupported backup scope: ${params.scope}` };
    }

    const [row] = await db
      .insert(configBackups)
      .values({
        organisationId: params.organisationId,
        scope: params.scope,
        label: params.label,
        sourceId: params.sourceId ?? null,
        entities,
        createdBy: params.createdBy ?? null,
      })
      .returning({ id: configBackups.id });

    return { backupId: row.id };
  },

  /**
   * Restore configuration from a backup. Marks the backup as 'restored'.
   */
  async restoreBackup(params: {
    backupId: string;
    organisationId: string;
    restoredBy: string;
  }): Promise<{
    skillsReverted: number;
    skillsDeactivated: number;
    agentsReverted: number;
  }> {
    const [backup] = await db
      .select()
      .from(configBackups)
      .where(
        and(
          eq(configBackups.id, params.backupId),
          eq(configBackups.organisationId, params.organisationId),
        )
      );

    if (!backup) throw { statusCode: 404, message: 'Backup not found' };
    if (backup.status === 'restored') {
      throw { statusCode: 409, message: 'Backup has already been restored' };
    }

    const entities = backup.entities as ConfigBackupEntity[];
    let result: { skillsReverted: number; skillsDeactivated: number; agentsReverted: number };

    switch (backup.scope) {
      case 'skill_analyzer':
        result = await restoreSkillAnalyzerEntities(entities);
        break;
      default:
        throw { statusCode: 400, message: `Unsupported backup scope: ${backup.scope}` };
    }

    // Mark backup as restored
    await db
      .update(configBackups)
      .set({
        status: 'restored',
        restoredAt: new Date(),
        restoredBy: params.restoredBy,
      })
      .where(eq(configBackups.id, params.backupId));

    return result;
  },

  /**
   * List backups for an organisation, optionally filtered by scope.
   */
  async listBackups(params: {
    organisationId: string;
    scope?: string;
    limit?: number;
  }) {
    const conditions = [eq(configBackups.organisationId, params.organisationId)];
    if (params.scope) {
      conditions.push(eq(configBackups.scope, params.scope));
    }

    return db
      .select({
        id: configBackups.id,
        scope: configBackups.scope,
        label: configBackups.label,
        sourceId: configBackups.sourceId,
        status: configBackups.status,
        createdBy: configBackups.createdBy,
        createdAt: configBackups.createdAt,
        restoredAt: configBackups.restoredAt,
        restoredBy: configBackups.restoredBy,
      })
      .from(configBackups)
      .where(and(...conditions))
      .orderBy(desc(configBackups.createdAt))
      .limit(params.limit ?? 50);
  },

  /**
   * Get a single backup by ID (full payload including entities).
   */
  async getBackup(backupId: string, organisationId: string) {
    const [row] = await db
      .select()
      .from(configBackups)
      .where(
        and(
          eq(configBackups.id, backupId),
          eq(configBackups.organisationId, organisationId),
        )
      );

    if (!row) throw { statusCode: 404, message: 'Backup not found' };
    return row;
  },

  /**
   * Find the backup associated with a skill analyser job.
   */
  async getBackupBySourceId(sourceId: string, organisationId: string) {
    const [row] = await db
      .select({
        id: configBackups.id,
        scope: configBackups.scope,
        label: configBackups.label,
        status: configBackups.status,
        createdAt: configBackups.createdAt,
        restoredAt: configBackups.restoredAt,
      })
      .from(configBackups)
      .where(
        and(
          eq(configBackups.sourceId, sourceId),
          eq(configBackups.organisationId, organisationId),
        )
      );

    return row ?? null;
  },
};
