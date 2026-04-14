import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../db/index.js';
import { skillVersions, type SkillVersion } from '../db/schema/skillVersions.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// skillVersioningHelper — Focused service for writing skill_versions rows.
// Every code path that mutates a skill (system, org, subaccount) calls this
// helper instead of duplicating the version-insert logic.
// ---------------------------------------------------------------------------

/** Structured change type for version history filtering and audit clarity. */
export type VersionChangeType = 'create' | 'update' | 'merge' | 'restore' | 'deactivate';

export interface WriteVersionParams {
  /** Set ONE of these to link the version to the correct skill. */
  systemSkillId?: string;
  skillId?: string;

  /** Snapshot of the skill state AFTER the mutation. */
  name: string;
  description?: string | null;
  definition: object;
  instructions?: string | null;

  /** Structured type of the change — enables filtering and analytics. */
  changeType: VersionChangeType;

  /** Human-readable description of what changed. */
  changeSummary: string;

  /** User who authored this change (null for system/automated). */
  authoredBy?: string | null;

  /** Optional idempotency key. When provided, duplicate writes with the same
   *  key for the same skill are silently skipped (ON CONFLICT DO NOTHING).
   *  Use for retry-prone paths: analyser execute, restore, bulk operations. */
  idempotencyKey?: string;

  /** Drizzle transaction handle. REQUIRED — all versioned writes MUST run
   *  inside the caller's transaction for atomicity with the skill mutation. */
  tx: OrgScopedTx;
}

/** Options for service methods that support optional version skipping. */
export interface VersionOpts {
  /** When true, the service method skips its default version write. */
  skipVersionWrite?: boolean;
  /** Must be true when skipVersionWrite is true — acknowledges the caller owns versioning. */
  externalVersionWrite?: boolean;
}

/**
 * Runtime guard: if skipVersionWrite is set but externalVersionWrite is not,
 * throw immediately. Prevents silent version omission.
 */
export function assertVersionOwnership(opts: VersionOpts): void {
  if (opts.skipVersionWrite && !opts.externalVersionWrite) {
    throw new Error(
      'skipVersionWrite requires externalVersionWrite: true to confirm the caller owns versioning',
    );
  }
}

export const skillVersioningHelper = {
  /**
   * Append a new version row. Auto-increments versionNumber by locking the
   * parent skill row first, then computing MAX(version_number) + 1.
   *
   * Concurrency strategy:
   * 1. Lock the PARENT skill row (system_skills or skills) with FOR UPDATE.
   * 2. Compute MAX(version_number) + 1 (safe — parent lock serialises writes).
   * 3. UNIQUE constraint on (COALESCE(system_skill_id, skill_id), version_number)
   *    acts as a safety net.
   * 4. When idempotencyKey is provided, ON CONFLICT DO NOTHING prevents dupes.
   *
   * Returns the created SkillVersion row (or null if idempotency key hit).
   */
  async writeVersion(params: WriteVersionParams): Promise<SkillVersion | null> {
    const runner = params.tx;
    const refId = params.systemSkillId ?? params.skillId;

    // Defensive: version writes require a persisted skill reference
    if (!refId) {
      throw new Error('writeVersion requires a persisted skill reference (systemSkillId or skillId)');
    }

    // Step 1: Lock the parent skill row to serialise concurrent version writes.
    if (params.systemSkillId) {
      await runner.execute(
        sql`SELECT id FROM system_skills WHERE id = ${refId} FOR UPDATE`,
      );
    } else {
      await runner.execute(
        sql`SELECT id FROM skills WHERE id = ${refId} FOR UPDATE`,
      );
    }

    // Step 2: Compute next version number (safe — parent lock prevents races)
    const maxResult = await runner.execute(
      sql`SELECT COALESCE(MAX(version_number), 0) AS max_version
          FROM skill_versions
          WHERE COALESCE(system_skill_id, skill_id) = ${refId}`,
    );
    const nextVersion = ((maxResult.rows?.[0] as any)?.max_version ?? 0) + 1;

    // Step 3: Insert with ON CONFLICT guard for idempotency when key is provided
    if (params.idempotencyKey) {
      const result = await runner.execute(
        sql`INSERT INTO skill_versions (
              system_skill_id, skill_id, version_number, name, description,
              definition, instructions, change_type, change_summary,
              authored_by, idempotency_key,
              simulation_pass_count, simulation_total_count
            ) VALUES (
              ${params.systemSkillId ?? null}, ${params.skillId ?? null},
              ${nextVersion}, ${params.name}, ${params.description ?? null},
              ${JSON.stringify(params.definition)}::jsonb, ${params.instructions ?? null},
              ${params.changeType}, ${params.changeSummary},
              ${params.authoredBy ?? null}, ${params.idempotencyKey},
              0, 0
            )
            ON CONFLICT (COALESCE(system_skill_id, skill_id), idempotency_key)
              WHERE idempotency_key IS NOT NULL
            DO NOTHING
            RETURNING *`,
      );
      const row = (result.rows?.[0] as SkillVersion | undefined) ?? null;
      if (!row) {
        logger.info('skill_version_idempotent_skip', {
          idempotencyKey: params.idempotencyKey,
          skillRef: refId,
        });
      }
      return row;
    }

    // No idempotency key — standard insert via Drizzle
    const [version] = await runner
      .insert(skillVersions)
      .values({
        systemSkillId: params.systemSkillId ?? undefined,
        skillId: params.skillId ?? undefined,
        versionNumber: nextVersion,
        name: params.name,
        description: params.description ?? null,
        definition: params.definition as Record<string, unknown>,
        instructions: params.instructions ?? null,
        changeType: params.changeType,
        changeSummary: params.changeSummary,
        authoredBy: params.authoredBy ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        simulationPassCount: 0,
        simulationTotalCount: 0,
      })
      .returning();

    return version!;
  },
};
