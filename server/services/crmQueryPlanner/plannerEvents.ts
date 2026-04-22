// Planner event emission — spec §17
// Writes structured logs; conditionally forwards to agent execution log.

import { logger } from '../../lib/logger.js';

// ── Envelope ──────────────────────────────────────────────────────────────────

interface PlannerEventEnvelope {
  kind: string;
  at: string;
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
  if (event.runId) {
    try {
      const isTerminal =
        kind === 'planner.result_emitted' ||
        kind === 'planner.classified' ||
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
