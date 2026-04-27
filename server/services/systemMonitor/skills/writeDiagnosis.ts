// writeDiagnosis — writes agent_diagnosis + investigate_prompt on a locked-to-incident row.
// Idempotent on (incidentId, agentRunId): if agent_diagnosis_run_id already equals agentRunId,
// the write is a no-op and success is returned.
// When investigatePrompt is provided, validates it per spec §9.8. Returns
// { success: false, error: 'PROMPT_VALIDATION_FAILED', retryable: true } on rejection —
// the agent's run loop retries up to 2× before the triage handler emits agent_triage_failed.
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
    await db.transaction(async (tx) => {
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
      if (incident.agentDiagnosisRunId === agentRunId) return;

      await tx
        .update(systemIncidents)
        .set({
          agentDiagnosis: diagnosis,
          agentDiagnosisRunId: agentRunId,
          ...(investigatePrompt !== undefined ? { investigatePrompt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(systemIncidents.id, incidentId));

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
    });

    return { success: true };
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
