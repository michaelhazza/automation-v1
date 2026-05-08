import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentObservations } from '../db/schema/index.js';
import {
  validateObservationBody,
  SUPERSESSION_DEPTH_LIMIT,
} from './agentObservationServicePure.js';
import type { ObservationType, ObservationSourceKind } from '../../shared/types/agentObservations.js';
import type { AgentObservation } from '../db/schema/agentObservations.js';
import type { PrincipalContext } from './principal/types.js';

export interface AppendObservationInput {
  agentId: string;
  eventId: string;
  observationType: ObservationType;
  body: string;
  metadata: { source_kind: ObservationSourceKind; source_id?: string; [key: string]: unknown };
  supersedesObservationId?: string | null;
  idempotencyKey?: string;
}

export async function append(
  input: AppendObservationInput,
  ctx: PrincipalContext,
): Promise<AgentObservation> {
  const db = getOrgScopedDb('agentObservationService.append');
  const organisationId = ctx.organisationId;

  // 1. Body-size validation
  const { ok, byteLength } = validateObservationBody(input.body);
  if (!ok) {
    throw { statusCode: 400, errorCode: 'observation_body_too_large', byteLength, limitBytes: 8192 };
  }

  // 2. Idempotency key derivation
  const idempotencyKey = input.idempotencyKey
    ?? createHash('sha256')
        .update(`${input.agentId}:${input.eventId}:${input.observationType}`)
        .digest('hex');

  // 3. Supersession cycle guard — DFS with FOR UPDATE row-locks (§7.3)
  if (input.supersedesObservationId) {
    // visitedIds tracks every node we've seen; detecting a back-edge means a cycle
    const visitedIds = new Set<string>([input.supersedesObservationId]);
    let current: string | null = input.supersedesObservationId;
    let depth = 0;

    while (current !== null && depth < SUPERSESSION_DEPTH_LIMIT) {
      type ChainRow = { id: string; supersedes_observation_id: string | null };
      const rows: ChainRow[] = (await db.execute(
        sql`SELECT id, supersedes_observation_id FROM agent_observations WHERE id = ${current}::uuid FOR UPDATE`,
      )) as unknown as ChainRow[];

      if (rows.length === 0) break; // row not found — chain terminates cleanly

      const nextId = rows[0].supersedes_observation_id;
      if (nextId !== null) {
        if (visitedIds.has(nextId)) {
          throw {
            statusCode: 409,
            errorCode: 'supersession_cycle_detected',
            rejectedSupersedesObservationId: input.supersedesObservationId,
          };
        }
        visitedIds.add(nextId);
      }

      current = nextId;
      depth++;
    }

    if (depth >= SUPERSESSION_DEPTH_LIMIT) {
      throw {
        statusCode: 409,
        errorCode: 'supersession_cycle_detected',
        rejectedSupersedesObservationId: input.supersedesObservationId,
      };
    }
  }

  // 4. Insert row
  try {
    const inserted = await db
      .insert(agentObservations)
      .values({
        organisationId,
        subaccountId: ctx.subaccountId ?? null,
        agentId: input.agentId,
        eventId: input.eventId,
        observationType: input.observationType,
        body: input.body,
        metadata: input.metadata as Record<string, unknown>,
        supersedesObservationId: input.supersedesObservationId ?? null,
        idempotencyKey,
      })
      .returning();

    return inserted[0];
  } catch (err: unknown) {
    // 5. 23505 unique_violation on idempotency_key → 200: return existing row
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      const existing = await db
        .select()
        .from(agentObservations)
        .where(
          and(
            eq(agentObservations.idempotencyKey, idempotencyKey),
            eq(agentObservations.organisationId, organisationId),
          ),
        )
        .limit(1);

      const row = existing[0];
      if (!row) throw { statusCode: 409, errorCode: 'idempotency_key_collision_unresolvable', idempotencyKey };
      return row;
    }

    throw err;
  }
}
