// writeDiagnosis — writes agent_diagnosis + investigate_prompt on a locked-to-incident row.
// Idempotent on (incidentId, agentRunId): if agent_diagnosis_run_id already equals agentRunId,
// the write is a no-op and success is returned.
// When investigatePrompt is provided, validates it per spec §9.8. Returns
// { success: false, error: 'PROMPT_VALIDATION_FAILED', retryable: true } on rejection —
// the agent's run loop retries up to 2× before the triage handler emits agent_triage_failed.
//
// Terminal-transition race (§11.0): if the predicated UPDATE returns 0 rows because the
// row is no longer triage_status='running' (staleness sweep / another writer won), this
// is a benign race outcome — not a failure. Returns { success: true, suppressed: true }
// so the agent's tool loop does not treat it as an error and does not retry.
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidents } from '../../../db/schema/systemIncidents.js';
import { systemIncidentEvents } from '../../../db/schema/systemIncidentEvents.js';
import { validateInvestigatePrompt } from '../triage/promptValidation.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

export async function executeWriteDiagnosis(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const incidentId = input.incidentId as string | undefined;
  const agentRunId = input.agentRunId as string | undefined;
  const diagnosis = input.diagnosis as Record<string, unknown> | undefined;
  const investigatePrompt = input.investigatePrompt as string | undefined;

  if (!incidentId) return { success: false, error: 'incidentId is required' };
  if (!agentRunId) return { success: false, error: 'agentRunId is required' };
  if (!diagnosis) return { success: false, error: 'diagnosis is required' };

  // Validate investigate_prompt before touching the DB — return a retryable error
  // so the agent's run loop can correct and retry (max 2 retries per spec §9.8).
  if (investigatePrompt !== undefined) {
    const validation = validateInvestigatePrompt(investigatePrompt);
    if (!validation.valid) {
      return {
        success: false,
        error: 'PROMPT_VALIDATION_FAILED',
        retryable: true,
        details: validation.errors,
      };
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Advisory lock scoped to this incident — prevents concurrent triage writes.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('triage:' || ${incidentId}::text)::bigint)`);

      const rows = await tx
        .select({ id: systemIncidents.id, agentDiagnosisRunId: systemIncidents.agentDiagnosisRunId })
        .from(systemIncidents)
        .where(eq(systemIncidents.id, incidentId))
        .limit(1);

      if (rows.length === 0) throw new Error(`Incident ${incidentId} not found`);

      const incident = rows[0]!;
      // Idempotency: skip if already written for this run.
      if (incident.agentDiagnosisRunId === agentRunId) {
        return { ok: true as const, suppressed: false as const };
      }

      // diagnosis_status is the explicit signal the UI reads to decide whether to
      // surface "Prompt validation failed" inline. 'valid' means the agent landed
      // both the diagnosis and a validated investigate_prompt; 'partial' means the
      // diagnosis is recorded but no valid prompt accompanies it (validation failed
      // upstream, or the agent omitted it). See migration 0237.
      const diagnosisStatus = investigatePrompt !== undefined ? 'valid' : 'partial';

      // §11.0 single-writer terminal-event invariant (per spec §11.3): the UPDATE
      // includes WHERE triage_status='running' and the agent_diagnosis_added event
      // INSERT runs in the same transaction, gated on the UPDATE returning 1 row.
      // A 0-row return means the staleness sweep (or another writer) already
      // claimed the row's terminal transition — suppress the event.
      const updated = await tx
        .update(systemIncidents)
        .set({
          agentDiagnosis: diagnosis,
          agentDiagnosisRunId: agentRunId,
          ...(investigatePrompt !== undefined ? { investigatePrompt } : {}),
          diagnosisStatus,
          updatedAt: new Date(),
        })
        .where(
          sql`${systemIncidents.id} = ${incidentId}::uuid
            AND ${systemIncidents.triageStatus} = 'running'`,
        )
        .returning({ id: systemIncidents.id });

      if (updated.length !== 1) {
        return { ok: true as const, suppressed: true as const };
      }

      await tx
        .insert(systemIncidentEvents)
        .values({
          incidentId,
          eventType: 'diagnosis',
          actorKind: 'agent',
          actorAgentRunId: agentRunId,
          payload: { agentRunId, hasInvestigatePrompt: investigatePrompt !== undefined },
          correlationId: context.runId,
          occurredAt: new Date(),
        });

      return { ok: true as const, suppressed: false as const };
    });

    if (result.suppressed) {
      // §11.0 single-writer invariant: another writer (typically the staleness sweep)
      // already claimed the terminal transition. Suppression is the correct outcome,
      // not an error — the agent's tool loop should not retry. Return success with
      // the suppressed flag for observability.
      return {
        success: true,
        suppressed: true,
        reason: 'terminal_transition_lost',
      };
    }

    // Explicit `suppressed: false` for contract symmetry with the suppression
    // branch above — consumers can rely on the field always being present
    // rather than coercing `undefined → false`.
    return { success: true, suppressed: false };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const WRITE_DIAGNOSIS_DEFINITION = {
  name: 'write_diagnosis',
  description: 'Write an agent diagnosis and optional investigate_prompt to a system incident. Idempotent on (incidentId, agentRunId).',
  input_schema: {
    type: 'object' as const,
    properties: {
      incidentId: { type: 'string', description: 'UUID of the system incident to annotate.' },
      agentRunId: { type: 'string', description: 'UUID of the agent run producing this diagnosis.' },
      diagnosis: { type: 'object', description: 'Structured diagnosis object written to agent_diagnosis column.' },
      investigatePrompt: { type: 'string', description: 'Optional investigate prompt text (200–6,000 chars, all §5.2 sections required). Returns PROMPT_VALIDATION_FAILED if invalid — retry with corrected text.' },
    },
    required: ['incidentId', 'agentRunId', 'diagnosis'],
  },
};
