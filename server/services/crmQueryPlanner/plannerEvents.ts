// Planner event emission — spec §17
// Writes structured logs; conditionally forwards to agent execution log.

import { logger } from '../../lib/logger.js';

// ── Envelope ──────────────────────────────────────────────────────────────────

interface PlannerEventEnvelope {
  kind: string;
  at: number; // epoch ms — matches shared PlannerEvent.at in shared/types/crmQueryPlanner.ts
  orgId: string;
  subaccountId: string;
  runId?: string;
  briefId?: string;
  intentHash: string;
}

export type PlannerEvent = PlannerEventEnvelope & Record<string, unknown>;

// ── Emit ──────────────────────────────────────────────────────────────────────

export async function emit(event: PlannerEvent): Promise<void> {
  const { kind, ...rest } = event;

  // 1. Structured log (always)
  const level = kind === 'planner.error_emitted' ? 'warn' : 'info';
  logger[level](kind, rest as Record<string, unknown>);

  // 2. Agent execution log (runId-gated; lazy import avoids drizzle-orm at module load)
  //
  // Terminal projection to the agent-execution-log surface must fire EXACTLY
  // ONCE per planner request. The planner emits both `planner.classified` and
  // `planner.result_emitted` on the success path (classified = terminal-state
  // marker per spec §17.1; result_emitted = the actual result envelope). Both
  // carry `stageResolved`, but only ONE of them should append a
  // `skill.completed` row — otherwise a single logical execution double-counts.
  // `planner.classified` stays a structured-log-only status marker; the
  // terminal forwarders are `planner.result_emitted` (success) and
  // `planner.error_emitted` (failure) — never both, never `classified`.
  if (event.runId) {
    try {
      const isTerminal =
        kind === 'planner.result_emitted' ||
        kind === 'planner.error_emitted';
      if (isTerminal) {
        const { appendEvent } = await import('../agentExecutionEventService.js');
        const status = kind === 'planner.error_emitted' ? 'error' : 'ok';
        await appendEvent({
          runId:          event.runId,
          organisationId: event.orgId,
          subaccountId:   event.subaccountId,
          sourceService:  'skillExecutor',
          payload: {
            eventType:    'skill.completed',
            critical:      false,
            skillSlug:     'crm.query',
            durationMs:    0,
            status,
            resultSummary: kind,
          },
        });
      }
    } catch {
      // Agent log forwarding is best-effort — never block the response.
    }
  }
}
