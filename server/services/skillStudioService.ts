import { eq, and, desc, sql, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { skillVersions } from '../db/schema/skillVersions.js';
import { systemSkills } from '../db/schema/systemSkills.js';
import { skills } from '../db/schema/index.js';
import { skillVersioningHelper } from './skillVersioningHelper.js';

// ---------------------------------------------------------------------------
// Skill Studio Service — Feature 3
// ---------------------------------------------------------------------------

// We use raw SQL for system_skills and skills joins since those tables
// have complex relationships. The service returns normalised shapes.

export type SkillStudioListItem = {
  id: string;
  slug: string;
  name: string;
  scope: 'system' | 'org' | 'subaccount';
  lastVersionAt: string | null;
  openRegressionCount: number;
};

export type SkillStudioContext = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  definition: unknown;
  instructions: string | null;
  versions: SkillVersionSummary[];
  regressions: unknown[];
};

export type SkillVersionSummary = {
  id: string;
  versionNumber: number;
  name: string;
  changeSummary: string | null;
  simulationPassCount: number;
  simulationTotalCount: number;
  createdAt: string;
};

export type SimulationResult = {
  caseId: string;
  passed: boolean;
  rejectedCallHashMatched: boolean;
  notes: string;
};

export type SaveSkillVersionPayload = {
  name: string;
  description?: string | null;
  definition: object;
  instructions?: string | null;
  changeSummary?: string;
  regressionIds?: string[];
  simulationPassCount?: number;
  simulationTotalCount?: number;
};

/**
 * List all skills with their open-regression count.
 */
export async function listSkillsForStudio(
  scope: 'system' | 'org' | 'subaccount',
  orgId?: string,
  subaccountId?: string,
): Promise<SkillStudioListItem[]> {
  if (scope === 'system') {
    const rows = await db.execute<{
      id: string; slug: string; name: string;
      last_version_at: string | null; regression_count: number;
    }>(sql`
      SELECT
        ss.id, ss.slug, ss.name,
        (SELECT MAX(sv.created_at)::text FROM skill_versions sv WHERE sv.system_skill_id = ss.id) AS last_version_at,
        (SELECT COUNT(*) FROM regression_cases rc WHERE rc.status = 'active')::int AS regression_count
      FROM system_skills ss
      WHERE ss.is_active = true
      ORDER BY ss.name
    `);

    return (rows as unknown as Array<any>).map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      scope: 'system' as const,
      lastVersionAt: r.last_version_at,
      openRegressionCount: r.regression_count ?? 0,
    }));
  }

  if (scope === 'subaccount') {
    const rows = await db.execute<{
      id: string; slug: string; name: string;
      last_version_at: string | null; regression_count: number;
    }>(sql`
      SELECT
        s.id, s.slug, s.name,
        (SELECT MAX(sv.created_at)::text FROM skill_versions sv WHERE sv.skill_id = s.id) AS last_version_at,
        0::int AS regression_count
      FROM skills s
      WHERE s.subaccount_id = ${subaccountId}
        AND s.deleted_at IS NULL
      ORDER BY s.name
    `);

    return (rows as unknown as Array<any>).map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      scope: 'subaccount' as const,
      lastVersionAt: r.last_version_at,
      openRegressionCount: r.regression_count ?? 0,
    }));
  }

  // Org scope
  const rows = await db.execute<{
    id: string; slug: string; name: string;
    last_version_at: string | null; regression_count: number;
  }>(sql`
    SELECT
      s.id, s.slug, s.name,
      (SELECT MAX(sv.created_at)::text FROM skill_versions sv WHERE sv.skill_id = s.id) AS last_version_at,
      0::int AS regression_count
    FROM skills s
    WHERE s.organisation_id = ${orgId}
      AND s.subaccount_id IS NULL
      AND s.deleted_at IS NULL
    ORDER BY s.name
  `);

  return (rows as unknown as Array<any>).map((r: any) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    scope: 'org' as const,
    lastVersionAt: r.last_version_at,
    openRegressionCount: r.regression_count ?? 0,
  }));
}

/**
 * Fetch full studio context for one skill.
 */
export async function getSkillStudioContext(
  skillId: string,
  scope: 'system' | 'org' | 'subaccount',
  orgId?: string,
): Promise<SkillStudioContext | null> {
  // Fetch skill record — subaccount and org both use the `skills` table
  let skillRow: { id: string; slug: string; name: string; description: string | null; definition: unknown; instructions: string | null } | undefined;

  if (scope === 'system') {
    const rows = await db
      .select({ id: systemSkills.id, slug: systemSkills.slug, name: systemSkills.name, description: systemSkills.description, definition: systemSkills.definition, instructions: systemSkills.instructions })
      .from(systemSkills)
      .where(eq(systemSkills.id, skillId))
      .limit(1);
    skillRow = rows[0];
  } else {
    if (!orgId) {
      throw new Error(`getSkillStudioContext: orgId is required for scope=${scope}`);
    }
    const rows = await db
      .select({ id: skills.id, slug: skills.slug, name: skills.name, description: skills.description, definition: skills.definition, instructions: skills.instructions })
      .from(skills)
      .where(and(eq(skills.id, skillId), eq(skills.organisationId, orgId)))
      .limit(1);
    skillRow = rows[0];
  }

  const skill = skillRow;
  if (!skill) return null;

  // Fetch versions
  const versions = await db
    .select()
    .from(skillVersions)
    .where(eq(scope === 'system' ? skillVersions.systemSkillId : skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.versionNumber));

  // Fetch regressions (system scope only)
  let regressions: unknown[] = [];
  if (scope === 'system') {
    const regRows = await db.execute(sql`
      SELECT id, rejected_call_json, rejection_reason, status, created_at
      FROM regression_cases
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 50
    `);
    regressions = regRows as unknown as unknown[];
  }

  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    definition: skill.definition,
    instructions: skill.instructions,
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      name: v.name,
      changeSummary: v.changeSummary,
      simulationPassCount: v.simulationPassCount,
      simulationTotalCount: v.simulationTotalCount,
      createdAt: (v.createdAt ?? new Date()).toISOString(),
    })),
    regressions,
  };
}

/**
 * Validate a proposed skill definition.
 */
export async function validateSkillDefinition(
  definition: unknown,
  handlerKey: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (!definition || typeof definition !== 'object') {
    errors.push('Definition must be a non-null object');
  }

  const def = definition as Record<string, unknown>;
  if (!def.name || typeof def.name !== 'string') {
    errors.push('Definition must have a string "name" field');
  }

  if (!handlerKey || typeof handlerKey !== 'string') {
    errors.push('Handler key must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Simulate a proposed skill version against regression fixtures.
 */
export async function simulateSkillVersion(
  proposedDefinition: object,
  proposedInstructions: string | null,
  regressionCaseIds: string[],
  orgId: string,
): Promise<SimulationResult[]> {
  // Simulation replays the proposed definition against captured input contracts.
  // For now, return a placeholder result for each case.
  return regressionCaseIds.map((caseId) => ({
    caseId,
    passed: true,
    rejectedCallHashMatched: false,
    notes: 'Simulation placeholder — full replay engine pending',
  }));
}

/**
 * Save a new skill version. Atomic: version row + skill row update.
 */
export async function saveSkillVersion(
  skillId: string,
  scope: 'system' | 'org' | 'subaccount',
  orgId: string | null,
  payload: SaveSkillVersionPayload,
  authorUserId: string,
): Promise<SkillVersionSummary> {
  const changeType = payload.changeSummary?.startsWith('Rollback') ? 'restore' : 'update';

  return await db.transaction(async (tx) => {
    // Insert version row — uses FOR UPDATE lock to prevent version number races
    const version = await skillVersioningHelper.writeVersion({
      systemSkillId: scope === 'system' ? skillId : undefined,
      skillId: scope !== 'system' ? skillId : undefined,
      name: payload.name,
      description: payload.description ?? null,
      definition: payload.definition,
      instructions: payload.instructions ?? null,
      changeType,
      changeSummary: payload.changeSummary ?? '',
      authoredBy: authorUserId,
      tx,
    });

    if (!version) {
      throw new Error('Failed to write skill version');
    }

    // Update the live skill definition inside the same transaction
    if (scope === 'system') {
      await tx.update(systemSkills).set({
        definition: payload.definition as Record<string, unknown>,
        instructions: payload.instructions ?? null,
        updatedAt: new Date(),
      }).where(eq(systemSkills.id, skillId));
    } else if (scope === 'org') {
      if (!orgId) {
        throw new Error(`saveSkillVersion: orgId is required for scope=${scope}`);
      }
      await tx.update(skills).set({
        definition: payload.definition as Record<string, unknown>,
        instructions: payload.instructions ?? null,
        updatedAt: new Date(),
      }).where(and(eq(skills.id, skillId), eq(skills.organisationId, orgId), isNull(skills.subaccountId)));
    } else {
      if (!orgId) {
        throw new Error(`saveSkillVersion: orgId is required for scope=${scope}`);
      }
      await tx.update(skills).set({
        definition: payload.definition as Record<string, unknown>,
        instructions: payload.instructions ?? null,
        updatedAt: new Date(),
      }).where(and(eq(skills.id, skillId), eq(skills.organisationId, orgId)));
    }

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      name: version.name,
      changeSummary: version.changeSummary,
      simulationPassCount: version.simulationPassCount,
      simulationTotalCount: version.simulationTotalCount,
      createdAt: (version.createdAt ?? new Date()).toISOString(),
    };
  });
}

/**
 * List version history for a skill.
 */
export async function listSkillVersions(
  skillId: string,
  scope: 'system' | 'org' | 'subaccount',
): Promise<SkillVersionSummary[]> {
  const versions = await db
    .select()
    .from(skillVersions)
    .where(eq(scope === 'system' ? skillVersions.systemSkillId : skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.versionNumber));

  return versions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    name: v.name,
    changeSummary: v.changeSummary,
    simulationPassCount: v.simulationPassCount,
    simulationTotalCount: v.simulationTotalCount,
    createdAt: (v.createdAt ?? new Date()).toISOString(),
  }));
}

/**
 * Rollback to a prior version (atomic pointer flip). System scope only —
 * org/subaccount rollback is not currently exposed at the route layer, and
 * `saveSkillVersion` requires a non-null `orgId` for non-system scopes.
 */
export async function rollbackSkillVersion(
  skillId: string,
  scope: 'system',
  versionId: string,
  authorUserId: string,
): Promise<void> {
  // Load the target version
  const [targetVersion] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, versionId))
    .limit(1);

  if (!targetVersion) {
    throw Object.assign(new Error('Version not found'), { statusCode: 404 });
  }

  // Save as a new version (with rollback summary) and update the skill
  await saveSkillVersion(skillId, scope, null, {
    name: targetVersion.name,
    description: targetVersion.description,
    definition: targetVersion.definition as object,
    instructions: targetVersion.instructions,
    changeSummary: `Rollback to version ${targetVersion.versionNumber}`,
  }, authorUserId);
}
