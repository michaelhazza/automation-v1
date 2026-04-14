import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  configBackups,
  systemSkills,
  systemAgents,
} from '../db/schema/index.js';
import type { ConfigBackupEntity } from '../db/schema/configBackups.js';
import { skillVersioningHelper } from './skillVersioningHelper.js';

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
 * Runs inside a transaction so the two reads share a consistent snapshot.
 */
async function captureSkillAnalyzerEntities(): Promise<ConfigBackupEntity[]> {
  return db.transaction(async (tx) => {
    const entities: ConfigBackupEntity[] = [];

    // Snapshot all system_skills (including inactive — analyser can reactivate)
    const skills = await tx.select().from(systemSkills);
    for (const skill of skills) {
      entities.push({
        entityType: 'system_skill',
        entityId: skill.id,
        snapshot: {
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
    const agents = await tx
      .select({
        id: systemAgents.id,
        defaultSystemSkillSlugs: systemAgents.defaultSystemSkillSlugs,
      })
      .from(systemAgents)
      .where(isNull(systemAgents.deletedAt));

    for (const agent of agents) {
      entities.push({
        entityType: 'system_agent_skills',
        entityId: agent.id,
        snapshot: {
          defaultSystemSkillSlugs: agent.defaultSystemSkillSlugs,
        },
      });
    }

    return entities;
  });
}

// ---------------------------------------------------------------------------
// Restore logic — scope-specific entity restoration
// ---------------------------------------------------------------------------

/**
 * Restore system_skills and systemAgent skill slugs from a backup.
 * Runs inside the caller's transaction for atomicity.
 *
 * Strategy:
 * 1. For system_skills in the backup: restore each to its snapshotted state
 * 2. For system_skills that exist now but NOT in the backup: they were created
 *    after the backup — deactivate them (isActive=false) rather than hard-deleting,
 *    to preserve referential integrity with skill_analyzer_results.resultingSkillId
 * 3. For system_agent_skills: restore defaultSystemSkillSlugs to snapshotted value
 */
async function restoreSkillAnalyzerEntities(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  entities: ConfigBackupEntity[],
  backupId: string,
): Promise<{
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

  // 1. Restore each snapshotted skill
  for (const entity of skillEntities) {
    const { snapshot } = entity;
    const existing = await tx
      .select({ id: systemSkills.id })
      .from(systemSkills)
      .where(eq(systemSkills.id, entity.entityId))
      .limit(1);

    if (existing[0]) {
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

      await skillVersioningHelper.writeVersion({
        systemSkillId: entity.entityId,
        name: snapshot.name as string,
        description: (snapshot.description as string) ?? null,
        definition: snapshot.definition as object,
        instructions: (snapshot.instructions as string) ?? null,
        changeType: 'restore',
        changeSummary: 'Reverted to backup snapshot',
        authoredBy: null,
        idempotencyKey: `restore:${backupId}:${entity.entityId}:revert`,
        tx,
      });

      skillsReverted++;
    }
    // If skill was deleted between backup and now — skip (don't recreate;
    // the slug may conflict, and recreation would need handler wiring)
  }

  // 2. Deactivate skills created after the backup
  const currentSkills = await tx
    .select({ id: systemSkills.id, name: systemSkills.name, description: systemSkills.description, definition: systemSkills.definition, instructions: systemSkills.instructions })
    .from(systemSkills);
  for (const skill of currentSkills) {
    if (!backupSkillIds.has(skill.id)) {
      await tx
        .update(systemSkills)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(systemSkills.id, skill.id));

      await skillVersioningHelper.writeVersion({
        systemSkillId: skill.id,
        name: skill.name,
        description: skill.description,
        definition: skill.definition as object,
        instructions: skill.instructions,
        changeType: 'deactivate',
        changeSummary: 'Deactivated during backup restore (created after backup)',
        authoredBy: null,
        idempotencyKey: `restore:${backupId}:${skill.id}:deactivate`,
        tx,
      });

      skillsDeactivated++;
    }
  }

  // 3. Restore agent skill slug arrays (only count if the row was actually updated)
  for (const entity of agentEntities) {
    const { snapshot } = entity;
    const updated = await tx
      .update(systemAgents)
      .set({
        defaultSystemSkillSlugs: snapshot.defaultSystemSkillSlugs as string[],
        updatedAt: new Date(),
      })
      .where(and(eq(systemAgents.id, entity.entityId), isNull(systemAgents.deletedAt)))
      .returning({ id: systemAgents.id });
    if (updated.length > 0) agentsReverted++;
  }

  return { skillsReverted, skillsDeactivated, agentsReverted };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const configBackupService = {
  /**
   * Create a backup before a bulk mutation.
   * Throws 409 if a backup for this sourceId already exists (prevents duplicates
   * from double-click or retry on the same job).
   */
  async createBackup(params: {
    organisationId: string;
    scope: 'skill_analyzer' | 'manual' | 'config_agent';
    label: string;
    sourceId?: string;
    createdBy?: string;
  }): Promise<{ backupId: string }> {
    // Guard: prevent duplicate backups for the same source
    if (params.sourceId) {
      const [existing] = await db
        .select({ id: configBackups.id })
        .from(configBackups)
        .where(
          and(
            eq(configBackups.sourceId, params.sourceId),
            eq(configBackups.organisationId, params.organisationId),
          )
        )
        .limit(1);
      if (existing) {
        throw { statusCode: 409, message: 'A backup for this source already exists' };
      }
    }

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
   * Delete a backup row (used to clean up phantom backups when no mutations succeed).
   */
  async deleteBackup(backupId: string): Promise<void> {
    await db.delete(configBackups).where(eq(configBackups.id, backupId));
  },

  /**
   * Restore configuration from a backup. Marks the backup as 'restored'.
   * The status check, entity restore, and status flip all run inside a single
   * transaction to prevent TOCTOU races and partial-restore inconsistency.
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
    return db.transaction(async (tx) => {
      // Atomically claim the backup: set status='restored' only if currently active
      const [claimed] = await tx
        .update(configBackups)
        .set({
          status: 'restored' as const,
          restoredAt: new Date(),
          restoredBy: params.restoredBy,
        })
        .where(
          and(
            eq(configBackups.id, params.backupId),
            eq(configBackups.organisationId, params.organisationId),
            eq(configBackups.status, 'active'),
          )
        )
        .returning();

      if (!claimed) {
        // Either not found or already restored — check which
        const [row] = await tx
          .select({ status: configBackups.status })
          .from(configBackups)
          .where(
            and(
              eq(configBackups.id, params.backupId),
              eq(configBackups.organisationId, params.organisationId),
            )
          );
        if (!row) throw { statusCode: 404, message: 'Backup not found' };
        throw { statusCode: 409, message: 'Backup has already been restored' };
      }

      const entities = claimed.entities as ConfigBackupEntity[];
      let result: { skillsReverted: number; skillsDeactivated: number; agentsReverted: number };

      switch (claimed.scope) {
        case 'skill_analyzer':
          result = await restoreSkillAnalyzerEntities(tx, entities, params.backupId);
          break;
        default:
          throw { statusCode: 400, message: `Unsupported backup scope: ${claimed.scope}` };
      }

      return result;
    });
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

    const limit = Math.min(params.limit ?? 50, 200);

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
      .limit(limit);
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
   * Batch fetch backups for multiple source IDs. Returns a Map from sourceId to backup summary.
   * Used to enrich job list responses without N+1 queries.
   */
  async getBackupsBySourceIds(
    sourceIds: string[],
    organisationId: string,
  ): Promise<Map<string, { id: string; status: string }>> {
    if (sourceIds.length === 0) return new Map();

    const rows = await db
      .select({
        id: configBackups.id,
        sourceId: configBackups.sourceId,
        status: configBackups.status,
      })
      .from(configBackups)
      .where(
        and(
          inArray(configBackups.sourceId, sourceIds),
          eq(configBackups.organisationId, organisationId),
        )
      )
      .orderBy(desc(configBackups.createdAt));

    // Keep only the most recent backup per sourceId (defensive against duplicates)
    const result = new Map<string, { id: string; status: string }>();
    for (const row of rows) {
      if (row.sourceId && !result.has(row.sourceId)) {
        result.set(row.sourceId, { id: row.id, status: row.status });
      }
    }
    return result;
  },

  /**
   * Find the backup associated with a skill analyser job.
   * Returns the most recent match (defensive against any duplicates).
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
      )
      .orderBy(desc(configBackups.createdAt))
      .limit(1);

    return row ?? null;
  },
};
