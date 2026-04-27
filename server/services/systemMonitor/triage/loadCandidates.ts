// Loads sweep candidates for the 15-minute window.
// Cross-tenant reads via withAdminConnectionGuarded.
// Day-one: agent runs only. Phase 2.5 adds skill execution, job, and connector entities.

import { sql } from 'drizzle-orm';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import type { Candidate, EntityKind } from '../heuristics/types.js';
import type { AgentRunEntity } from '../heuristics/candidateTypes.js';

const WINDOW_MINUTES = 15;
const CANDIDATE_LIMIT = 200; // hard ceiling before heuristic evaluation

/** ISO-format 15-min bucket for the given date — used for singletonKey scoping. */
export function bucket15min(now: Date): string {
  const ms = now.getTime();
  const bucketMs = Math.floor(ms / (15 * 60 * 1000)) * (15 * 60 * 1000);
  return new Date(bucketMs).toISOString();
}

/** Summary fields only — no full payloads or message content blobs. */
async function loadAgentRunCandidates(now: Date): Promise<Candidate[]> {
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000);

  type Row = {
    run_id: string;
    agent_id: string;
    agent_slug: string;
    organisation_id: string;
    status: string;
    run_result_status: string | null;
    duration_ms: number | null;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    token_budget: number;
    error_message: string | null;
    summary: string | null;
    is_test_run: boolean;
    // last message fields (may be null if no messages yet)
    last_msg_role: string | null;
    last_msg_content: string | null;
  };

  const rows = await withAdminConnectionGuarded<Row[]>(
    { allowRlsBypass: true, source: 'system_monitor_sweep', reason: 'cross-tenant agent run sweep for heuristic evaluation' },
    async (adminDb) => {
      const result = await adminDb.execute<Row>(sql`
        SELECT
          ar.id                         AS run_id,
          ar.agent_id,
          a.slug                        AS agent_slug,
          ar.organisation_id,
          ar.status,
          ar.run_result_status,
          EXTRACT(EPOCH FROM (ar.completed_at - ar.created_at)) * 1000 AS duration_ms,
          ar.input_tokens,
          ar.output_tokens,
          ar.total_tokens,
          ar.token_budget,
          ar.error_message,
          ar.summary,
          ar.is_test_run,
          msg.role                      AS last_msg_role,
          CASE
            WHEN msg.content::text IS NULL THEN NULL
            WHEN LENGTH(msg.content::text) > 2000
            THEN LEFT(msg.content::text, 2000) || '...[truncated]'
            ELSE msg.content::text
          END                           AS last_msg_content
        FROM agent_runs ar
        JOIN agents a ON a.id = ar.agent_id
        LEFT JOIN LATERAL (
          SELECT role, content
          FROM agent_run_messages
          WHERE run_id = ar.id
          ORDER BY sequence_number DESC
          LIMIT 1
        ) msg ON true
        WHERE ar.completed_at >= ${windowStart}
          AND ar.status NOT IN ('pending', 'running', 'delegated')
          AND (ar.run_source IS NULL OR ar.run_source != 'system')
        ORDER BY ar.completed_at DESC
        LIMIT ${CANDIDATE_LIMIT}
      `);
      return result.rows as Row[];
    },
  );

  return rows.map((row): Candidate => {
    const lastContentStr = row.last_msg_content ?? '';
    const reachedMaxTurns = row.status === 'budget_exceeded';

    const entity: AgentRunEntity = {
      runId: row.run_id,
      agentId: row.agent_id,
      agentSlug: row.agent_slug,
      organisationId: row.organisation_id,
      status: row.status,
      runResultStatus: (row.run_result_status as AgentRunEntity['runResultStatus']) ?? null,
      durationMs: row.duration_ms,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      tokenBudget: row.token_budget,
      errorMessage: row.error_message,
      summary: row.summary,
      isTestRun: Boolean(row.is_test_run),
      reachedMaxTurns,
      finalMessageRole: (row.last_msg_role as AgentRunEntity['finalMessageRole']) ?? null,
      finalMessageContent: lastContentStr || null,
      finalMessageLengthChars: lastContentStr.length,
      skillInvocationCounts: {},  // Phase 2.5 enrichment
      outputHash: null,           // Phase 2.5 enrichment
      recentRunOutputs: [],       // Phase 2.5 enrichment
    };

    return {
      entityKind: 'agent_run' as EntityKind,
      entityId: row.run_id,
      entity,
    };
  });
}

export async function loadCandidates(now: Date): Promise<{ candidates: Candidate[]; limitReached: boolean }> {
  const candidates = await loadAgentRunCandidates(now);
  return {
    candidates,
    limitReached: candidates.length >= CANDIDATE_LIMIT,
  };
}
