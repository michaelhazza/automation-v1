import { eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs } from '../../../db/schema/index.js';

/** Record that a slug's LLM classification is in-flight.
 *  Writes startedAtMs into classify_state.inFlight[slug] via a JSONB merge.
 *  The slug is a parameterized bind value — no sql.raw, injection-safe. */
export async function markSkillInFlight(
  jobId: string,
  slug: string,
  startedAtMs: number,
): Promise<void> {
  await getOrgScopedDb('skillAnalyzerService.markSkillInFlight')
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`jsonb_set(
        coalesce(classify_state, '{}'),
        ARRAY['inFlight', ${slug}]::text[],
        ${String(startedAtMs)}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

/** Remove a slug from classify_state.inFlight once classification completes. */
export async function unmarkSkillInFlight(
  jobId: string,
  slug: string,
): Promise<void> {
  await getOrgScopedDb('skillAnalyzerService.unmarkSkillInFlight')
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`coalesce(classify_state, '{}') #- ARRAY['inFlight', ${slug}]::text[]`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}
