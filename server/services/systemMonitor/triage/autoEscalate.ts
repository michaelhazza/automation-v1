// Pure decision helper for auto-escalation past the triage rate limit.
// No DB access or env reads — accepts pre-loaded incident fields.
// Wraps the existing Phase 0/0.5 escalation guardrail (computeEscalationVerdict)
// so auto-escalation inherits the same hard-cap / cooldown constraints as manual escalation.

import type { SystemIncidentSeverity, SystemIncidentStatus } from '../../../db/schema/systemIncidents.js';
import { computeEscalationVerdict } from '../../systemIncidentServicePure.js';

const HIGH_SEVERITY: ReadonlySet<SystemIncidentSeverity> = new Set(['high', 'critical']);
const TERMINAL_STATUS: ReadonlySet<SystemIncidentStatus> = new Set(['resolved', 'suppressed']);

export interface AutoEscalateDecision {
  yes: boolean;
  reason?: 'guardrail_cap' | 'cooldown' | 'severity_too_low' | 'incident_terminal';
}

export function shouldAutoEscalate(
  incident: {
    severity: SystemIncidentSeverity;
    status: SystemIncidentStatus;
    escalationCount: number | null;
    escalatedAt: Date | null;
  },
  now: Date,
): AutoEscalateDecision {
  if (!HIGH_SEVERITY.has(incident.severity)) {
    return { yes: false, reason: 'severity_too_low' };
  }
  if (TERMINAL_STATUS.has(incident.status)) {
    return { yes: false, reason: 'incident_terminal' };
  }

  const guardrailVerdict = computeEscalationVerdict({
    escalationCount: incident.escalationCount ?? 0,
    escalatedAt: incident.escalatedAt ?? null,
    now,
  });

  if (!guardrailVerdict.allowed) {
    return {
      yes: false,
      reason: guardrailVerdict.reason === 'hard_cap_reached' ? 'guardrail_cap' : 'cooldown',
    };
  }

  return { yes: true };
}
