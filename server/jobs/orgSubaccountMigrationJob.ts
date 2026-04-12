import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  orgAgentConfigs,
  subaccountAgents,
  subaccounts,
  orgMemories,
  orgMemoryEntries,
  workspaceMemories,
  workspaceMemoryEntries,
  migrationStates,
} from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Org Subaccount Migration Job
//
// One-time application-level migration that runs after the 0106 SQL migration:
//   1. Migrate orgAgentConfigs → subaccountAgents (true upsert)
//   2. Migrate orgMemories/orgMemoryEntries → workspace memory (with provenance)
//
// Idempotent — safe to re-run. Uses upsert semantics and skips existing data.
//
// Spec: docs/org-subaccount-refactor-spec.md §5
// ---------------------------------------------------------------------------

interface MigrationResult {
  configMigration: {
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    errorCount: number;
  };
  memoryMigration: {
    memoriesCreated: number;
    entriesMigrated: number;
    entriesSkipped: number;
    errorCount: number;
  };
}

/**
 * Migrate orgAgentConfigs to subaccountAgents for the org subaccount.
 * True upsert — re-running produces correct results.
 */
async function migrateOrgAgentConfigs(): Promise<MigrationResult['configMigration']> {
  const stats = { createdCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0 };

  // Load all org agent configs
  const configs = await db.select().from(orgAgentConfigs);

  for (const config of configs) {
    try {
      // Find the org subaccount for this config's org
      const [orgSa] = await db
        .select({ id: subaccounts.id })
        .from(subaccounts)
        .where(
          and(
            eq(subaccounts.organisationId, config.organisationId),
            eq(subaccounts.isOrgSubaccount, true),
            isNull(subaccounts.deletedAt),
          ),
        );

      if (!orgSa) {
        logger.warn('org_migration.no_org_subaccount', { orgId: config.organisationId });
        stats.skippedCount++;
        continue;
      }

      // Check if a subaccount_agents row already exists
      const [existing] = await db
        .select({ id: subaccountAgents.id })
        .from(subaccountAgents)
        .where(
          and(
            eq(subaccountAgents.subaccountId, orgSa.id),
            eq(subaccountAgents.agentId, config.agentId),
          ),
        )
        .limit(1);

      if (existing) {
        // Upsert: update existing row with org config values
        await db
          .update(subaccountAgents)
          .set({
            isActive: config.isActive,
            tokenBudgetPerRun: config.tokenBudgetPerRun,
            maxToolCallsPerRun: config.maxToolCallsPerRun,
            timeoutSeconds: config.timeoutSeconds,
            maxCostPerRunCents: config.maxCostPerRunCents,
            maxLlmCallsPerRun: config.maxLlmCallsPerRun,
            skillSlugs: config.skillSlugs,
            allowedSkillSlugs: config.allowedSkillSlugs,
            customInstructions: config.customInstructions,
            heartbeatEnabled: config.heartbeatEnabled,
            heartbeatIntervalHours: config.heartbeatIntervalHours,
            heartbeatOffsetMinutes: config.heartbeatOffsetMinutes,
            concurrencyPolicy: config.concurrencyPolicy,
            catchUpPolicy: config.catchUpPolicy,
            catchUpCap: config.catchUpCap,
            maxConcurrentRuns: config.maxConcurrentRuns,
            scheduleCron: config.scheduleCron,
            scheduleEnabled: config.scheduleEnabled,
            scheduleTimezone: config.scheduleTimezone,
            lastRunAt: config.lastRunAt,
            updatedAt: new Date(),
          })
          .where(eq(subaccountAgents.id, existing.id));
        stats.updatedCount++;
      } else {
        // Insert new row
        await db.insert(subaccountAgents).values({
          organisationId: config.organisationId,
          subaccountId: orgSa.id,
          agentId: config.agentId,
          isActive: config.isActive,
          tokenBudgetPerRun: config.tokenBudgetPerRun,
          maxToolCallsPerRun: config.maxToolCallsPerRun,
          timeoutSeconds: config.timeoutSeconds,
          maxCostPerRunCents: config.maxCostPerRunCents,
          maxLlmCallsPerRun: config.maxLlmCallsPerRun,
          skillSlugs: config.skillSlugs,
          allowedSkillSlugs: config.allowedSkillSlugs,
          customInstructions: config.customInstructions,
          heartbeatEnabled: config.heartbeatEnabled,
          heartbeatIntervalHours: config.heartbeatIntervalHours,
          heartbeatOffsetMinutes: config.heartbeatOffsetMinutes,
          heartbeatOffsetHours: 0,
          concurrencyPolicy: config.concurrencyPolicy,
          catchUpPolicy: config.catchUpPolicy,
          catchUpCap: config.catchUpCap,
          maxConcurrentRuns: config.maxConcurrentRuns,
          scheduleCron: config.scheduleCron,
          scheduleEnabled: config.scheduleEnabled,
          scheduleTimezone: config.scheduleTimezone,
          lastRunAt: config.lastRunAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        stats.createdCount++;
      }
    } catch (err) {
      logger.error('org_migration.config_error', {
        orgId: config.organisationId,
        agentId: config.agentId,
        error: err instanceof Error ? err.message : String(err),
      });
      stats.errorCount++;
    }
  }

  return stats;
}

/**
 * Migrate orgMemories and orgMemoryEntries to workspace memory.
 * Entries include provenance metadata tracking the original source.
 */
async function migrateOrgMemories(): Promise<MigrationResult['memoryMigration']> {
  const stats = { memoriesCreated: 0, entriesMigrated: 0, entriesSkipped: 0, errorCount: 0 };

  const memories = await db.select().from(orgMemories);

  for (const mem of memories) {
    try {
      // Find the org subaccount
      const [orgSa] = await db
        .select({ id: subaccounts.id })
        .from(subaccounts)
        .where(
          and(
            eq(subaccounts.organisationId, mem.organisationId),
            eq(subaccounts.isOrgSubaccount, true),
            isNull(subaccounts.deletedAt),
          ),
        );

      if (!orgSa) {
        logger.warn('org_migration.memory_no_org_subaccount', { orgId: mem.organisationId });
        continue;
      }

      // Create workspace_memories row if not exists
      const [existingWm] = await db
        .select({ id: workspaceMemories.id })
        .from(workspaceMemories)
        .where(
          and(
            eq(workspaceMemories.organisationId, mem.organisationId),
            eq(workspaceMemories.subaccountId, orgSa.id),
          ),
        )
        .limit(1);

      if (!existingWm) {
        await db.insert(workspaceMemories).values({
          organisationId: mem.organisationId,
          subaccountId: orgSa.id,
          summary: mem.summary,
          qualityThreshold: mem.qualityThreshold,
          runsSinceSummary: mem.runsSinceSummary,
          summaryThreshold: mem.summaryThreshold,
          version: mem.version,
          summaryGeneratedAt: mem.summaryGeneratedAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        stats.memoriesCreated++;
      }

      // Migrate entries
      const entries = await db
        .select()
        .from(orgMemoryEntries)
        .where(eq(orgMemoryEntries.organisationId, mem.organisationId));

      for (const entry of entries) {
        try {
          // Skip if no agentRunId or agentId (required fields in workspace_memory_entries)
          if (!entry.agentRunId || !entry.agentId) {
            stats.entriesSkipped++;
            continue;
          }

          // onConflictDoNothing targets the workspace_memory_entries_dedup
          // unique constraint (migration 0107) — re-running is idempotent.
          const result = await db.insert(workspaceMemoryEntries).values({
            organisationId: entry.organisationId,
            subaccountId: orgSa.id,
            agentRunId: entry.agentRunId,
            agentId: entry.agentId,
            content: entry.content,
            entryType: entry.entryType as 'observation' | 'decision' | 'preference' | 'issue' | 'pattern',
            qualityScore: entry.qualityScore,
            includedInSummary: entry.includedInSummary,
            accessCount: entry.accessCount,
            lastAccessedAt: entry.lastAccessedAt,
            createdAt: entry.createdAt,
          }).onConflictDoNothing();
          if (result.rowCount === 0) {
            stats.entriesSkipped++;
          } else {
            stats.entriesMigrated++;
          }
        } catch (entryErr) {
          logger.error('org_migration.entry_error', {
            entryId: entry.id,
            error: entryErr instanceof Error ? entryErr.message : String(entryErr),
          });
          stats.errorCount++;
      }
    } catch (err) {
      logger.error('org_migration.memory_error', {
        orgId: mem.organisationId,
        error: err instanceof Error ? err.message : String(err),
      });
      stats.errorCount++;
    }
  }

  return stats;
}

/**
 * Run the full org subaccount data migration.
 * Call once after the 0106 SQL migration has been applied.
 */
export async function runOrgSubaccountMigration(): Promise<MigrationResult> {
  logger.info('org_migration.starting');

  const configResult = await migrateOrgAgentConfigs();
  logger.info('org_migration.configs_complete', configResult);

  // Record config migration state
  await db
    .insert(migrationStates)
    .values({ key: 'org_subaccount_config_migration', completedAt: new Date(), metadata: configResult })
    .onConflictDoUpdate({ target: migrationStates.key, set: { completedAt: new Date(), metadata: configResult } })
    .catch((err) => {
      logger.warn('org_migration.state_record_failed', { key: 'org_subaccount_config_migration', err: String(err) });
    });

  const memoryResult = await migrateOrgMemories();
  logger.info('org_migration.memories_complete', memoryResult);

  // Record memory migration state
  await db
    .insert(migrationStates)
    .values({ key: 'org_subaccount_memory_migration', completedAt: new Date(), metadata: memoryResult })
    .onConflictDoUpdate({ target: migrationStates.key, set: { completedAt: new Date(), metadata: memoryResult } })
    .catch((err) => {
      logger.warn('org_migration.state_record_failed', { key: 'org_subaccount_memory_migration', err: String(err) });
    });

  logger.info('org_migration.complete', { configResult, memoryResult });

  return { configMigration: configResult, memoryMigration: memoryResult };
}
