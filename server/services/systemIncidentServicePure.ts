// Pure helpers for the system incident service.
import type { SystemIncidentStatus } from '../db/schema/systemIncidents.js';

// ---------------------------------------------------------------------------
// State machine — valid lifecycle transitions
// ---------------------------------------------------------------------------

// Resolved and suppressed are terminal from the sysadmin's perspective;
// they can be re-opened by a new occurrence (which creates a new row).
const VALID_TRANSITIONS: Record<SystemIncidentStatus, SystemIncidentStatus[]> = {
  open:         ['investigating', 'remediating', 'resolved', 'suppressed', 'escalated'],
  investigating: ['remediating', 'resolved', 'suppressed', 'escalated'],
  remediating:  ['resolved', 'suppressed', 'escalated'],
  escalated:    ['investigating', 'remediating', 'resolved', 'suppressed'],
  resolved:     [], // terminal — new occurrences create a new row
  suppressed:   ['open'], // can be unsuppressed via suppression removal
};

export function canTransition(from: SystemIncidentStatus, to: SystemIncidentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Escalation guardrail verdict
// ---------------------------------------------------------------------------

export interface EscalationVerdictInput {
  escalationCount: number;
  escalatedAt: Date | null;
  now: Date;
  hardCap?: number;      // default 3
  rateLimitSeconds?: number; // default 60
}

export type EscalationVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'hard_cap_reached'; escalationCount: number }
  | { allowed: false; reason: 'rate_limited'; secondsRemaining: number }
  | { allowed: false; reason: 'soft_block'; message: string };

export function computeEscalationVerdict(input: EscalationVerdictInput): EscalationVerdict {
  const hardCap = input.hardCap ?? 3;
  const rateLimitSeconds = input.rateLimitSeconds ?? 60;

  if (input.escalationCount >= hardCap) {
    return { allowed: false, reason: 'hard_cap_reached', escalationCount: input.escalationCount };
  }

  if (input.escalatedAt) {
    const secondsSince = (input.now.getTime() - input.escalatedAt.getTime()) / 1000;
    if (secondsSince < rateLimitSeconds) {
      return {
        allowed: false,
        reason: 'rate_limited',
        secondsRemaining: Math.ceil(rateLimitSeconds - secondsSince),
      };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Resolution payload builder
// ---------------------------------------------------------------------------

export function resolutionEventPayload(params: {
  incidentId: string;
  escalatedTaskId: string | null;
  escalationCount: number;
  previousTaskIds: string[];
  resolvedByUserId: string;
  resolutionNote?: string;
  linkedPrUrl?: string;
}): { resolve: Record<string, unknown>; resolutionLinkedToTask: Record<string, unknown> | null } {
  const resolve: Record<string, unknown> = {
    resolvedByUserId: params.resolvedByUserId,
    resolutionNote: params.resolutionNote ?? null,
    linkedPrUrl: params.linkedPrUrl ?? null,
  };

  const resolutionLinkedToTask = params.escalatedTaskId
    ? {
        taskId: params.escalatedTaskId,
        escalationCount: params.escalationCount,
        previousTaskIds: params.previousTaskIds,
        resolvedByUserId: params.resolvedByUserId,
        resolutionNote: params.resolutionNote ?? null,
        linkedPrUrl: params.linkedPrUrl ?? null,
        wasSuccessful: null, // Phase 0.5: not collected; reserved for future UI prompt
      }
    : null;

  return { resolve, resolutionLinkedToTask };
}
