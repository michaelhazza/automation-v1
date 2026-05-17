import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import { systemSkills } from '../../../db/schema/systemSkills.js';
import { systemAgentService } from '../../systemAgentService.js';
import type { SystemSkill } from '../../systemSkillService.js';
import type { MatchedSkillContent, AvailableSystemAgent, EnrichedResult, GetJobResponse } from '../types.js';

/** Get job status and results. Validates that job belongs to the org.
 *  Phase 1 of skill-analyzer-v2 extends the response with two new fields:
 *  - matchedSkillContent on each result with a non-null matchedSkillId
 *  - availableSystemAgents on the job (combobox source for Phase 4) */
export async function getJob(
  jobId: string,
  organisationId: string
): Promise<GetJobResponse> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  const job = jobRows[0];
  if (!job) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const rawResults = await getOrgScopedDb('skillAnalyzerService.getJob.results')
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.jobId, jobId))
    .orderBy(skillAnalyzerResults.candidateIndex);

  // Live lookup: for every result with matchedSkillId set, fetch the current
  // system_skills row and attach as matchedSkillContent. If the skill was
  // deleted between analysis and now, omit the field for that result (the
  // Review UI handles the missing field with a fallback notice — spec §7.4).
  // Single batched query — avoid N+1 over getSkill().
  const matchedSkillIds = Array.from(
    new Set(
      rawResults
        .map((r) => r.matchedSkillId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  );
  const matchedSkillsById = new Map<string, SystemSkill>();
  if (matchedSkillIds.length > 0) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
    const rows = await db
      .select()
      .from(systemSkills)
      .where(inArray(systemSkills.id, matchedSkillIds));
    for (const row of rows) {
      const visibility =
        row.visibility === 'none' || row.visibility === 'basic' || row.visibility === 'full'
          ? row.visibility
          : 'none';
      matchedSkillsById.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? '',
        isActive: row.isActive,
        visibility,
        definition: row.definition as SystemSkill['definition'],
        instructions: row.instructions ?? null,
        sideEffects: row.sideEffects,
      });
    }
  }

  const results: EnrichedResult[] = rawResults.map((r) => {
    if (!r.matchedSkillId) return r;
    const matched = matchedSkillsById.get(r.matchedSkillId);
    if (!matched) return r;
    const matchedSkillContent: MatchedSkillContent = {
      id: matched.id,
      slug: matched.slug,
      name: matched.name,
      description: matched.description,
      definition: matched.definition as object,
      instructions: matched.instructions,
    };
    return { ...r, matchedSkillContent };
  });

  // Live read of system_agents for the "Add another system agent" combobox.
  // Full inventory at request time — not cached.
  const allAgents = await systemAgentService.listAgents();
  const availableSystemAgents: AvailableSystemAgent[] = allAgents.map((a) => ({
    systemAgentId: a.id,
    slug: a.slug,
    name: a.name,
  }));

  return { job, results, availableSystemAgents };
}

/** Load a job by ID without org validation (for internal job processing only). */
export async function getJobById(
  jobId: string
): Promise<typeof skillAnalyzerJobs.$inferSelect | null> {
  const rows = await getOrgScopedDb('skillAnalyzerService.getJobById')
    .select()
    .from(skillAnalyzerJobs)
    .where(eq(skillAnalyzerJobs.id, jobId))
    .limit(1);
  return rows[0] ?? null;
}

/** List jobs for an org (most recent first). */
export async function listJobs(
  organisationId: string,
  limit = 20,
  offset = 0
): Promise<(typeof skillAnalyzerJobs.$inferSelect)[]> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  return db
    .select()
    .from(skillAnalyzerJobs)
    .where(eq(skillAnalyzerJobs.organisationId, organisationId))
    .orderBy(desc(skillAnalyzerJobs.createdAt))
    .limit(limit)
    .offset(offset);
}
