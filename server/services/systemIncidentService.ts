// System Incident Service — CRUD + lifecycle actions for system_incidents.
// All mutating methods write a system_incident_events row inside the same tx.
import { eq, and, or, inArray, isNull, sql, desc, asc, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { taskService } from './taskService.js';
import { resolveSystemOpsContext } from './systemOperationsOrgResolver.js';
import {
  systemIncidents,
  systemIncidentEvents,
  systemIncidentSuppressions,
} from '../db/schema/index.js';
import type { SystemIncident, SystemIncidentStatus } from '../db/schema/systemIncidents.js';
import type { SystemIncidentEvent } from '../db/schema/systemIncidentEvents.js';
import type { SystemIncidentSuppression } from '../db/schema/systemIncidentSuppressions.js';
import {
  canTransition,
  computeEscalationVerdict,
  resolutionEventPayload,
} from './systemIncidentServicePure.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuppressionDuration = '24h' | '7d' | '30d' | 'permanent';

export interface IncidentListFilters {
  status?: SystemIncidentStatus | SystemIncidentStatus[];
  severity?: string | string[];
  source?: string | string[];
  classification?: string | string[];
  organisationId?: string;
  includeTestIncidents?: boolean;
  sort?: 'last_seen_desc' | 'first_seen_desc' | 'occurrence_count_desc' | 'severity_desc';
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function suppressionExpiryFromDuration(duration: SuppressionDuration): Date | null {
  const now = new Date();
  if (duration === 'permanent') return null;
  const hours = duration === '24h' ? 24 : duration === '7d' ? 168 : 720;
  return new Date(now.getTime() + hours * 3_600_000);
}

const SEVERITY_SORT_SQL = sql`CASE
  WHEN ${systemIncidents.severity} = 'critical' THEN 4
  WHEN ${systemIncidents.severity} = 'high' THEN 3
  WHEN ${systemIncidents.severity} = 'medium' THEN 2
  ELSE 1 END`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const systemIncidentService = {
  async listIncidents(filters: IncidentListFilters): Promise<{ incidents: SystemIncident[]; total: number }> {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      conditions.push(inArray(systemIncidents.status, statuses) as unknown as ReturnType<typeof eq>);
    }
    if (filters.severity) {
      const severities = Array.isArray(filters.severity) ? filters.severity : [filters.severity];
      conditions.push(inArray(systemIncidents.severity, severities) as unknown as ReturnType<typeof eq>);
    }
    if (filters.source) {
      const sources = Array.isArray(filters.source) ? filters.source : [filters.source];
      conditions.push(inArray(systemIncidents.source, sources) as unknown as ReturnType<typeof eq>);
    }
    if (filters.classification) {
      const classes = Array.isArray(filters.classification) ? filters.classification : [filters.classification];
      conditions.push(inArray(systemIncidents.classification, classes) as unknown as ReturnType<typeof eq>);
    }
    if (filters.organisationId) {
      conditions.push(eq(systemIncidents.organisationId, filters.organisationId) as unknown as ReturnType<typeof eq>);
    }
    if (!filters.includeTestIncidents) {
      conditions.push(eq(systemIncidents.isTestIncident, false) as unknown as ReturnType<typeof eq>);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderBy = (() => {
      switch (filters.sort) {
        case 'first_seen_desc': return desc(systemIncidents.firstSeenAt);
        case 'occurrence_count_desc': return desc(systemIncidents.occurrenceCount);
        case 'severity_desc': return desc(SEVERITY_SORT_SQL);
        default: return desc(systemIncidents.lastSeenAt);
      }
    })();

    const [incidents, totalResult] = await Promise.all([
      db.select().from(systemIncidents).where(where).orderBy(orderBy).limit(limit).offset(offset),
      db.select({ count: count() }).from(systemIncidents).where(where),
    ]);

    return { incidents, total: Number(totalResult[0]?.count ?? 0) };
  },

  async getIncident(id: string): Promise<{ incident: SystemIncident; events: SystemIncidentEvent[] }> {
    const [incident] = await db.select().from(systemIncidents).where(eq(systemIncidents.id, id));
    if (!incident) throw { statusCode: 404, message: 'Incident not found' };

    const events = await db
      .select()
      .from(systemIncidentEvents)
      .where(eq(systemIncidentEvents.incidentId, id))
      .orderBy(asc(systemIncidentEvents.occurredAt));

    return { incident, events };
  },

  async acknowledgeIncident(id: string, userId: string): Promise<SystemIncident> {
    return db.transaction(async (tx) => {
      const [incident] = await tx.select().from(systemIncidents).where(eq(systemIncidents.id, id));
      if (!incident) throw { statusCode: 404, message: 'Incident not found' };

      const now = new Date();
      const [updated] = await tx
        .update(systemIncidents)
        .set({ acknowledgedAt: now, acknowledgedByUserId: userId, updatedAt: now })
        .where(eq(systemIncidents.id, id))
        .returning();

      await tx.insert(systemIncidentEvents).values({
        incidentId: id,
        eventType: 'ack',
        actorKind: 'user',
        actorUserId: userId,
        payload: { acknowledgedAt: now.toISOString() },
        occurredAt: now,
      });

      return updated;
    });
  },

  async resolveIncident(id: string, userId: string, note?: string, linkedPrUrl?: string): Promise<SystemIncident> {
    return db.transaction(async (tx) => {
      const [incident] = await tx.select().from(systemIncidents).where(eq(systemIncidents.id, id));
      if (!incident) throw { statusCode: 404, message: 'Incident not found' };
      if (!canTransition(incident.status, 'resolved')) {
        throw { statusCode: 409, message: `Cannot resolve incident in status '${incident.status}'` };
      }

      const now = new Date();
      const [updated] = await tx
        .update(systemIncidents)
        .set({
          status: 'resolved',
          resolvedAt: now,
          resolvedByUserId: userId,
          resolutionNote: note ?? null,
          linkedPrUrl: linkedPrUrl ?? null,
          updatedAt: now,
        })
        .where(eq(systemIncidents.id, id))
        .returning();

      const { resolve: resolvePayload, resolutionLinkedToTask } = resolutionEventPayload({
        incidentId: id,
        escalatedTaskId: incident.escalatedTaskId ?? null,
        escalationCount: incident.escalationCount,
        previousTaskIds: (incident.previousTaskIds as string[]) ?? [],
        resolvedByUserId: userId,
        resolutionNote: note,
        linkedPrUrl,
      });

      await tx.insert(systemIncidentEvents).values({
        incidentId: id,
        eventType: 'resolve',
        actorKind: 'user',
        actorUserId: userId,
        payload: resolvePayload,
        occurredAt: now,
      });

      if (resolutionLinkedToTask) {
        await tx.insert(systemIncidentEvents).values({
          incidentId: id,
          eventType: 'resolution_linked_to_task',
          actorKind: 'user',
          actorUserId: userId,
          payload: resolutionLinkedToTask,
          occurredAt: now,
        });
      }

      return updated;
    });
  },

  async suppressIncident(id: string, userId: string, reason: string, duration: SuppressionDuration): Promise<SystemIncident> {
    return db.transaction(async (tx) => {
      const [incident] = await tx.select().from(systemIncidents).where(eq(systemIncidents.id, id));
      if (!incident) throw { statusCode: 404, message: 'Incident not found' };
      if (!canTransition(incident.status, 'suppressed')) {
        throw { statusCode: 409, message: `Cannot suppress incident in status '${incident.status}'` };
      }

      const now = new Date();
      const expiresAt = suppressionExpiryFromDuration(duration);

      // Create or update the suppression rule for this fingerprint+org
      await tx
        .insert(systemIncidentSuppressions)
        .values({
          fingerprint: incident.fingerprint,
          organisationId: incident.organisationId ?? null,
          reason,
          expiresAt,
          createdByUserId: userId,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [systemIncidentSuppressions.fingerprint, systemIncidentSuppressions.organisationId],
          set: { reason, expiresAt, createdByUserId: userId },
        });

      const [updated] = await tx
        .update(systemIncidents)
        .set({ status: 'suppressed', updatedAt: now })
        .where(eq(systemIncidents.id, id))
        .returning();

      await tx.insert(systemIncidentEvents).values({
        incidentId: id,
        eventType: 'suppress',
        actorKind: 'user',
        actorUserId: userId,
        payload: { reason, duration, expiresAt: expiresAt?.toISOString() ?? null },
        occurredAt: now,
      });

      return updated;
    });
  },

  async escalateIncidentToAgent(id: string, userId: string): Promise<{ incident: SystemIncident; taskId: string }> {
    const { incident } = await this.getIncident(id);

    const now = new Date();
    const verdict = computeEscalationVerdict({
      escalationCount: incident.escalationCount ?? 0,
      escalatedAt: incident.escalatedAt ?? null,
      now,
    });

    if (!verdict.allowed) {
      // Write escalation_blocked event then throw
      await db.insert(systemIncidentEvents).values({
        incidentId: incident.id,
        eventType: 'escalation_blocked',
        actorKind: 'user',
        actorUserId: userId,
        payload: JSON.parse(JSON.stringify(verdict)) as Record<string, unknown>,
        occurredAt: now,
      });
      const msg = verdict.reason === 'hard_cap_reached'
        ? `Escalation hard cap reached (${verdict.escalationCount}/3)`
        : verdict.reason === 'rate_limited'
        ? `Rate limited — wait ${verdict.secondsRemaining}s`
        : (verdict as { message: string }).message ?? 'Escalation blocked';
      throw Object.assign(new Error(msg), { statusCode: 429, errorCode: `escalation_${verdict.reason}` });
    }

    const sysOps = await resolveSystemOpsContext();
    const previousTaskIds = (incident.previousTaskIds ?? []) as string[];

    // Create task + update incident inside a single transaction to prevent orphan tasks on rollback.
    // taskService.createTask runs its own internal db calls — this wraps them atomically.
    const updated = await db.transaction(async (tx) => {
      const task = await taskService.createTask(
        sysOps.organisationId,
        sysOps.subaccountId,
        {
          title: `[Incident] ${incident.summary.slice(0, 120)}`,
          description: [
            `**Source:** ${incident.source}`,
            `**Severity:** ${incident.severity}`,
            `**Error code:** ${incident.errorCode ?? '—'}`,
            `**Occurrences:** ${incident.occurrenceCount}`,
            `**First seen:** ${incident.firstSeenAt.toISOString()}`,
            `**Fingerprint:** \`${incident.fingerprint}\``,
          ].join('\n'),
          priority: incident.severity === 'critical' ? 'urgent' : incident.severity === 'high' ? 'high' : 'normal',
        },
        userId,
      );

      const [row] = await tx.update(systemIncidents).set({
        status: 'escalated',
        escalationCount: (incident.escalationCount ?? 0) + 1,
        escalatedAt: now,
        escalatedTaskId: task.id,
        previousTaskIds: [...previousTaskIds, ...(incident.escalatedTaskId ? [incident.escalatedTaskId] : [])],
        updatedAt: now,
      })
        .where(eq(systemIncidents.id, id))
        .returning();

      await tx.insert(systemIncidentEvents).values({
        incidentId: id,
        eventType: 'escalated',
        actorKind: 'user',
        actorUserId: userId,
        payload: {
          taskId: task.id,
          escalationCount: (incident.escalationCount ?? 0) + 1,
        },
        occurredAt: now,
      });

      return { row, taskId: task.id };
    });

    return { incident: updated.row, taskId: updated.taskId };
  },

  async listSuppressions(filter?: { activeOnly?: boolean }): Promise<SystemIncidentSuppression[]> {
    const now = new Date();
    const conditions = filter?.activeOnly
      ? [or(isNull(systemIncidentSuppressions.expiresAt), sql`${systemIncidentSuppressions.expiresAt} > ${now}`) as unknown as ReturnType<typeof eq>]
      : [];

    return db
      .select()
      .from(systemIncidentSuppressions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(systemIncidentSuppressions.createdAt));
  },

  async removeSuppression(id: string, userId: string): Promise<void> {
    const [suppression] = await db
      .select()
      .from(systemIncidentSuppressions)
      .where(eq(systemIncidentSuppressions.id, id));

    if (!suppression) throw { statusCode: 404, message: 'Suppression not found' };

    await db.delete(systemIncidentSuppressions).where(eq(systemIncidentSuppressions.id, id));

    // If there's an incident that's currently suppressed with this fingerprint, unsuppress it
    const [suppressedIncident] = await db
      .select()
      .from(systemIncidents)
      .where(
        and(
          eq(systemIncidents.fingerprint, suppression.fingerprint),
          eq(systemIncidents.status, 'suppressed'),
        )
      )
      .limit(1);

    if (suppressedIncident) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(systemIncidents)
          .set({ status: 'open', updatedAt: now })
          .where(eq(systemIncidents.id, suppressedIncident.id));

        await tx.insert(systemIncidentEvents).values({
          incidentId: suppressedIncident.id,
          eventType: 'unsuppress',
          actorKind: 'user',
          actorUserId: userId,
          payload: { suppressionId: id, removedAt: now.toISOString() },
          occurredAt: now,
        });
      });
    }
  },

  // Test incident trigger (admin page test button, §8.9)
  async createTestIncident(userId: string, triggerNotifications = false): Promise<SystemIncident> {
    const { recordIncident } = await import('./incidentIngestor.js');
    const { hashFingerprint } = await import('./incidentIngestorPure.js');
    const timestamp = Date.now();

    await recordIncident({
      source: 'route',
      severity: 'low',
      classification: 'system_fault',
      summary: `[TEST] Manual test incident triggered by sysadmin`,
      errorCode: 'TEST_MANUAL_TRIGGER',
      fingerprintOverride: `test:manual:sysadmin:trigger`,
      correlationId: `test-${timestamp}`,
    });

    const hash = hashFingerprint('test:manual:sysadmin:trigger');
    const [incident] = await db
      .select()
      .from(systemIncidents)
      .where(eq(systemIncidents.fingerprint, hash))
      .orderBy(desc(systemIncidents.createdAt))
      .limit(1);

    if (!incident) throw { statusCode: 500, message: 'Test incident creation failed' };
    return incident;
  },
};
