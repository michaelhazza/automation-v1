// Rate-limit gate for system_monitor triage (§9.9).
//
// Max SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT (default 2) triage attempts per
// fingerprint within a SYSTEM_MONITOR_TRIAGE_RATE_LIMIT_WINDOW_HOURS (default 24h)
// rolling window. Window resets when last_triage_attempt_at is older than WINDOW_HOURS.
//
// Auto-escalation: if a rate-limited high/critical incident's window expires and
// the incident is still open, the existing manual-escalate path fires automatically.

import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidents, systemIncidentEvents } from '../../../db/schema/index.js';
import { systemIncidentService } from '../../systemIncidentService.js';
import { logger } from '../../../lib/logger.js';
import { shouldAutoEscalate } from './autoEscalate.js';

const MAX_TRIAGE = parseInt(process.env.SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT ?? '2', 10);
const WINDOW_MS = parseInt(process.env.SYSTEM_MONITOR_TRIAGE_RATE_LIMIT_WINDOW_HOURS ?? '24', 10) * 60 * 60 * 1000;
const AUTO_ESCALATE = process.env.SYSTEM_MONITOR_AUTO_ESCALATE_AFTER_RATE_LIMIT !== 'false';

// Sentinel actor used for system-triggered auto-escalation audit events.
const SYSTEM_ACTOR_ID = 'system_monitor';

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'rate_limited';
  windowExpired: boolean;
}

/**
 * Checks the rate-limit gate for a given incident.
 * Reads triage_attempt_count + last_triage_attempt_at from DB.
 * Returns allowed=true if the count is below the cap, or if the cap was hit but the window expired.
 */
// @rls-allowlist-bypass: system_incidents checkRateLimit [ref: spec §3.3.1]
export async function checkRateLimit(incidentId: string, now: Date = new Date()): Promise<RateLimitResult> {
  const [row] = await db
    .select({
      triageAttemptCount: systemIncidents.triageAttemptCount,
      lastTriageAttemptAt: systemIncidents.lastTriageAttemptAt,
    })
    .from(systemIncidents)
    .where(eq(systemIncidents.id, incidentId))
    .limit(1);

  if (!row) {
    return { allowed: true, windowExpired: false };
  }

  if (row.triageAttemptCount < MAX_TRIAGE) {
    return { allowed: true, windowExpired: false };
  }

  // Count is at or above cap — check whether window has expired.
  const windowExpired =
    !row.lastTriageAttemptAt ||
    now.getTime() - row.lastTriageAttemptAt.getTime() >= WINDOW_MS;

  if (windowExpired) {
    // Window reset: a new triage attempt is allowed.
    return { allowed: true, windowExpired: true };
  }

  return { allowed: false, reason: 'rate_limited', windowExpired: false };
}

/**
 * After a rate-limit block, checks whether the window has expired for a high/critical
 * incident and fires auto-escalation via the existing manual-escalate path if so.
 * No-op if AUTO_ESCALATE env var is false or conditions are not met.
 */
// @rls-allowlist-bypass: system_incidents maybeAutoEscalate [ref: spec §3.3.1]
export async function maybeAutoEscalate(incidentId: string, now: Date = new Date()): Promise<void> {
  if (!AUTO_ESCALATE) return;

  const [incident] = await db
    .select({
      severity: systemIncidents.severity,
      status: systemIncidents.status,
      triageAttemptCount: systemIncidents.triageAttemptCount,
      lastTriageAttemptAt: systemIncidents.lastTriageAttemptAt,
      escalationCount: systemIncidents.escalationCount,
      escalatedAt: systemIncidents.escalatedAt,
    })
    .from(systemIncidents)
    .where(eq(systemIncidents.id, incidentId))
    .limit(1);

  if (!incident) return;

  // Only fire if the window has expired (incident was rate-limited and 24h has passed)
  const windowExpired =
    !incident.lastTriageAttemptAt ||
    now.getTime() - incident.lastTriageAttemptAt.getTime() >= WINDOW_MS;

  if (!windowExpired || incident.triageAttemptCount < MAX_TRIAGE) return;

  const decision = shouldAutoEscalate(incident, now);
  if (!decision.yes) {
    logger.info('triage_auto_escalate_skipped', { incidentId, reason: decision.reason });
    return;
  }

  try {
    await systemIncidentService.escalateIncidentToAgent(incidentId, SYSTEM_ACTOR_ID, 'system');

    // Mark as auto-escalated (separate from the standard 'escalation' event written by escalateIncidentToAgent)
    await db.insert(systemIncidentEvents).values({
      incidentId,
      eventType: 'agent_auto_escalated',
      actorKind: 'agent',
      payload: {
        reason: 'rate_limit_window_expired',
        severity: incident.severity,
        triageAttemptCount: incident.triageAttemptCount,
      },
      occurredAt: now,
    });

    logger.info('triage_auto_escalated', { incidentId, severity: incident.severity });
  } catch (err) {
    // escalateIncidentToAgent writes escalation_blocked when guardrails fire — don't double-write.
    logger.warn('triage_auto_escalate_blocked', {
      incidentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
