/**
 * server/services/agentRecommendationsService.ts
 *
 * Central write-path service for agent_recommendations.
 * Implements the full §6.2 decision flow: advisory lock → cooldown check →
 * open-match lookup → cap check → eviction-or-drop → insert/update.
 *
 * SINGLE-WRITER INVARIANT: all INSERT / UPDATE against agent_recommendations
 * must go through this module. No other code imports db.insert(agentRecommendations)
 * or db.update(agentRecommendations) directly. This is enforced by the
 * agentRecommendations.singleWriter.test.ts static-analysis test.
 *
 * Spec: docs/sub-account-optimiser-spec.md §6.2 + §6.5
 */

import { sql } from 'drizzle-orm';
import { comparePriority as _comparePriority, type PriorityTuple } from './agentRecommendationsServicePure.js';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { emitOrgUpdate } from '../websocket/emitters.js';
import {
  materialDelta,
  severityRank,
  evidenceHash as computeEvidenceHash,
  COOLDOWN_HOURS_BY_SEVERITY,
  type OutputRecommendInput,
  type OutputRecommendOutput,
} from '../../shared/types/agentRecommendations.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpsertRecommendationContext {
  organisationId: string;
  agentId: string;
  agentNamespace?: string; // derived from calling agent's role definition
}

export interface ListRecommendationsParams {
  orgId: string;
  scopeType?: 'org' | 'subaccount';
  scopeId?: string;
  includeDescendantSubaccounts?: boolean;
  limit?: number;
}

export interface ListRecommendationsResult {
  rows: Array<{
    id: string;
    scope_type: string;
    scope_id: string;
    subaccount_display_name?: string;
    category: string;
    severity: string;
    title: string;
    body: string;
    action_hint: string | null;
    evidence: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    acknowledged_at: string | null;
    dismissed_at: string | null;
  }>;
  total: number;
}

// ── Per-scope advisory lock key ────────────────────────────────────────────────
//
// Lock granularity is (scope_type, scope_id, producing_agent_id).
// This ensures the cap-check + eviction + insert sequence is atomic across
// ALL categories from the same writer to that scope.

function advisoryLockId(scopeType: string, scopeId: string, producingAgentId: string): string {
  // hashtext() is a Postgres-only function; we compose a stable string and use
  // it directly in the SQL. The lock id must fit in a bigint (63-bit signed).
  // We pass the raw string to hashtext() in SQL.
  return `${scopeType}:${scopeId}:${producingAgentId}`;
}

// ── upsertRecommendation ──────────────────────────────────────────────────────

/**
 * Full §6.2 decision flow inside an advisory-locked transaction.
 *
 * Returns an OutputRecommendOutput discriminated by was_new / reason.
 * Never throws on 23505 unique-constraint violation — catches and re-looks up.
 */
export async function upsertRecommendation(
  ctx: UpsertRecommendationContext,
  input: OutputRecommendInput,
): Promise<OutputRecommendOutput> {
  const { organisationId, agentId } = ctx;
  const { scope_type, scope_id, category, severity, title, body, evidence, action_hint, dedupe_key } = input;

  // Compute evidence hash before the transaction
  const newEvidenceHash = computeEvidenceHash(evidence as Record<string, unknown>);

  try {
    const result = await db.transaction(async (tx) => {
      // Acquire advisory lock: (scope_type, scope_id, producing_agent_id)
      // Lock is released automatically when the transaction commits/rolls back.
      const lockKey = advisoryLockId(scope_type, scope_id, agentId);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`,
      );

      // Step 1: Cooldown check
      const cooldownRows = await tx.execute<{
        id: string;
        severity: string;
        dismissed_until: string | null;
      }>(sql`
        SELECT id, severity, dismissed_until
        FROM agent_recommendations
        WHERE scope_type = ${scope_type}
          AND scope_id = ${scope_id}::uuid
          AND category = ${category}
          AND dedupe_key = ${dedupe_key}
          AND dismissed_at IS NOT NULL
          AND dismissed_until > now()
        ORDER BY dismissed_at DESC
        LIMIT 1
      `);

      if (cooldownRows.length > 0) {
        const cooldownRow = cooldownRows[0];
        const existingSeverityRank = severityRank(cooldownRow.severity as 'info' | 'warn' | 'critical');
        const newSeverityRank = severityRank(severity);

        if (newSeverityRank > existingSeverityRank) {
          // Severity-escalation bypass: fall through to step 2
          logger.info('recommendations.skipped.cooldown_bypassed', {
            category,
            dedupe_key,
            existing_severity: cooldownRow.severity,
            candidate_severity: severity,
          });
        } else {
          // No bypass: return cooldown
          const dismissedUntil = cooldownRow.dismissed_until;
          const dismissedUntilMs = dismissedUntil ? new Date(dismissedUntil).getTime() : 0;
          const remainingS = Math.max(0, Math.floor((dismissedUntilMs - Date.now()) / 1000));

          logger.info('recommendations.skipped.cooldown', {
            category,
            dedupe_key,
            dismissed_until_remaining_s: remainingS,
            current_severity: cooldownRow.severity,
            candidate_severity: severity,
          });

          return {
            recommendation_id: cooldownRow.id,
            was_new: false,
            reason: 'cooldown' as const,
          };
        }
      }

      // Step 2: Open-match lookup (FOR UPDATE)
      const openMatchRows = await tx.execute<{
        id: string;
        evidence: Record<string, unknown>;
        evidence_hash: string;
        acknowledged_at: string | null;
      }>(sql`
        SELECT id, evidence, evidence_hash, acknowledged_at
        FROM agent_recommendations
        WHERE scope_type = ${scope_type}
          AND scope_id = ${scope_id}::uuid
          AND category = ${category}
          AND dedupe_key = ${dedupe_key}
          AND dismissed_at IS NULL
        FOR UPDATE
        LIMIT 1
      `);

      if (openMatchRows.length > 0) {
        const existing = openMatchRows[0];
        const existingHash = existing.evidence_hash;

        if (existingHash === newEvidenceHash) {
          // Hash match: no-op
          logger.info('recommendations.no_change.hash_match', {
            category,
            dedupe_key,
            evidence_hash: newEvidenceHash,
          });
          return {
            recommendation_id: existing.id,
            was_new: false,
          };
        }

        // Hashes differ: check materialDelta
        // Strip the category discriminator from the stored evidence before comparing
        const prevEvidence = existing.evidence as Record<string, unknown>;
        const nextEvidence = evidence as Record<string, unknown>;

        // Get the short category key for the materialDelta lookup
        const shortCategory = categoryToShortKey(category);
        const deltaFn = shortCategory ? materialDelta[shortCategory as keyof typeof materialDelta] : null;
        const isMaterial = deltaFn ? deltaFn(prevEvidence, nextEvidence) : true;

        if (!isMaterial) {
          logger.info('recommendations.skipped.sub_threshold', {
            category,
            dedupe_key,
            prev_evidence_hash: existingHash,
            next_evidence_hash: newEvidenceHash,
          });
          return {
            recommendation_id: existing.id,
            was_new: false,
            reason: 'sub_threshold' as const,
          };
        }

        // Material change: update in place
        await tx.execute(sql`
          UPDATE agent_recommendations
          SET
            title = ${title},
            body = ${body},
            evidence = ${JSON.stringify(nextEvidence)}::jsonb,
            evidence_hash = ${newEvidenceHash},
            severity = ${severity},
            action_hint = ${action_hint ?? null},
            updated_at = now(),
            acknowledged_at = NULL
          WHERE id = ${existing.id}::uuid
        `);

        emitOrgUpdate(organisationId, 'dashboard.recommendations.changed', {
          recommendation_id: existing.id,
          scope_type,
          scope_id,
          change: 'updated',
        });

        return {
          recommendation_id: existing.id,
          was_new: false,
          reason: 'updated_in_place' as const,
        };
      }

      // Step 3: Cap check
      const capRows = await tx.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt
        FROM agent_recommendations
        WHERE scope_type = ${scope_type}
          AND scope_id = ${scope_id}::uuid
          AND producing_agent_id = ${agentId}::uuid
          AND dismissed_at IS NULL
      `);
      const openCount = parseInt(capRows[0]?.cnt ?? '0', 10);

      if (openCount < 10) {
        // Insert new row
        const inserted = await insertNewRecommendation(tx, {
          organisationId,
          scopeType: scope_type,
          scopeId: scope_id,
          producingAgentId: agentId,
          category,
          severity,
          title,
          body,
          evidence: evidence as Record<string, unknown>,
          evidenceHash: newEvidenceHash,
          actionHint: action_hint ?? null,
          dedupeKey: dedupe_key,
        });

        emitOrgUpdate(organisationId, 'dashboard.recommendations.changed', {
          recommendation_id: inserted.id,
          scope_type,
          scope_id,
          change: 'created',
        });

        return {
          recommendation_id: inserted.id,
          was_new: true,
        };
      }

      // Step 4: Eviction check (cap reached)
      // Find the lowest-priority open rec for (scope, producing_agent_id):
      // severity asc (lowest severity first), then updated_at asc (stalest first),
      // then category desc (earlier alphabet = higher priority = later evicted),
      // then dedupe_key desc.
      const lowestRows = await tx.execute<{
        id: string;
        severity: string;
        category: string;
        dedupe_key: string;
        updated_at: string;
      }>(sql`
        SELECT id, severity, category, dedupe_key, updated_at
        FROM agent_recommendations
        WHERE scope_type = ${scope_type}
          AND scope_id = ${scope_id}::uuid
          AND producing_agent_id = ${agentId}::uuid
          AND dismissed_at IS NULL
        ORDER BY
          CASE severity WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END ASC,
          updated_at ASC,
          category DESC,
          dedupe_key DESC
        LIMIT 1
      `);

      if (lowestRows.length === 0) {
        // Shouldn't happen, but handle gracefully
        logger.warn('recommendations.dropped_due_to_cap', {
          scope_type,
          scope_id,
          producing_agent_id: agentId,
          category,
          severity,
          dedupe_key,
        });
        return {
          recommendation_id: '',
          was_new: false,
          reason: 'cap_reached' as const,
        };
      }

      const lowestRec = lowestRows[0];
      const lowestSeverityRank = severityRank(lowestRec.severity as 'info' | 'warn' | 'critical');
      const newSeverityRank = severityRank(severity);

      // Compare priority: severity rank > updated_at > category > dedupe_key
      const newIsHigherPriority = _comparePriority(
        { severity: newSeverityRank, updatedAt: new Date().toISOString(), category, dedupeKey: dedupe_key },
        { severity: lowestSeverityRank, updatedAt: lowestRec.updated_at, category: lowestRec.category, dedupeKey: lowestRec.dedupe_key },
      ) > 0;

      if (!newIsHigherPriority) {
        // Cap-reached drop
        logger.info('recommendations.dropped_due_to_cap', {
          scope_type,
          scope_id,
          producing_agent_id: agentId,
          category,
          severity,
          dedupe_key,
        });
        return {
          recommendation_id: '',
          was_new: false,
          reason: 'cap_reached' as const,
        };
      }

      // Evict the lowest-priority open rec
      await tx.execute(sql`
        UPDATE agent_recommendations
        SET
          dismissed_at = now(),
          dismissed_reason = 'evicted_by_higher_priority',
          dismissed_until = now() + interval '6 hours',
          updated_at = now()
        WHERE id = ${lowestRec.id}::uuid
      `);

      logger.info('recommendations.evicted_lower_priority', {
        scope_type,
        scope_id,
        producing_agent_id: agentId,
        evicted_recommendation_id: lowestRec.id,
        evicted_category: lowestRec.category,
        evicted_severity: lowestRec.severity,
        evicted_dedupe_key: lowestRec.dedupe_key,
        incoming_category: category,
        incoming_severity: severity,
        incoming_dedupe_key: dedupe_key,
      });

      // Insert new row
      const inserted = await insertNewRecommendation(tx, {
        organisationId,
        scopeType: scope_type,
        scopeId: scope_id,
        producingAgentId: agentId,
        category,
        severity,
        title,
        body,
        evidence: evidence as Record<string, unknown>,
        evidenceHash: newEvidenceHash,
        actionHint: action_hint ?? null,
        dedupeKey: dedupe_key,
      });

      emitOrgUpdate(organisationId, 'dashboard.recommendations.changed', {
        recommendation_id: inserted.id,
        scope_type,
        scope_id,
        change: 'created',
      });

      return {
        recommendation_id: inserted.id,
        was_new: true,
        reason: 'evicted_lower_priority' as const,
      };
    });

    return result;
  } catch (err: unknown) {
    // Catch 23505 unique-constraint violation (race between concurrent producers
    // with different advisory lock keys — possible for cross-agent category collisions).
    // Re-run open-match lookup and return was_new=false.
    if (isUniqueViolation(err)) {
      const existing = await db.execute<{ id: string }>(sql`
        SELECT id FROM agent_recommendations
        WHERE scope_type = ${scope_type}
          AND scope_id = ${scope_id}::uuid
          AND category = ${category}
          AND dedupe_key = ${dedupe_key}
          AND dismissed_at IS NULL
        LIMIT 1
      `);
      return {
        recommendation_id: existing[0]?.id ?? '',
        was_new: false,
      };
    }
    throw err;
  }
}

// ── Helper: insert new recommendation row ─────────────────────────────────────

interface InsertRecommendationInput {
  organisationId: string;
  scopeType: 'org' | 'subaccount';
  scopeId: string;
  producingAgentId: string;
  category: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  evidenceHash: string;
  actionHint: string | null;
  dedupeKey: string;
}

async function insertNewRecommendation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: InsertRecommendationInput,
): Promise<{ id: string }> {
  const rows = await tx.execute<{ id: string }>(sql`
    INSERT INTO agent_recommendations (
      organisation_id, scope_type, scope_id, producing_agent_id,
      category, severity, title, body, evidence, evidence_hash,
      action_hint, dedupe_key
    ) VALUES (
      ${input.organisationId}::uuid,
      ${input.scopeType},
      ${input.scopeId}::uuid,
      ${input.producingAgentId}::uuid,
      ${input.category},
      ${input.severity},
      ${input.title},
      ${input.body},
      ${JSON.stringify(input.evidence)}::jsonb,
      ${input.evidenceHash},
      ${input.actionHint},
      ${input.dedupeKey}
    )
    RETURNING id
  `);
  return { id: rows[0].id };
}

// ── Helper: priority comparison ───────────────────────────────────────────────
// Re-exported from agentRecommendationsServicePure.ts so tests can import the
// pure function without pulling in the DB module graph.

export { comparePriority } from './agentRecommendationsServicePure.js';
export type { PriorityTuple } from './agentRecommendationsServicePure.js';

// ── Helper: category short key for materialDelta lookup ───────────────────────
//
// The stored category uses the full 3-segment form (e.g. 'optimiser.agent.over_budget').
// The materialDelta registry uses the short 2-segment form ('agent.over_budget').

function categoryToShortKey(category: string): string | null {
  const parts = category.split('.');
  if (parts.length < 3) return null;
  return parts.slice(1).join('.');
}

// ── Helper: detect Postgres 23505 unique violation ───────────────────────────

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return e['code'] === '23505';
  }
  return false;
}

// ── listRecommendations ───────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listRecommendations(
  params: ListRecommendationsParams,
): Promise<ListRecommendationsResult> {
  const { orgId, scopeType, scopeId, includeDescendantSubaccounts = false, limit = 20 } = params;

  // Guard against SQL injection: scopeId is interpolated into sql.raw(), validate format
  if (scopeId !== undefined && !UUID_REGEX.test(scopeId)) {
    throw { statusCode: 422, message: 'scopeId must be a valid UUID' };
  }

  if (scopeType !== undefined && scopeType !== 'org' && scopeType !== 'subaccount') {
    throw { statusCode: 422, message: 'scopeType must be org or subaccount' };
  }

  const clampedLimit = Math.min(limit, 100);

  // Build WHERE conditions
  const conditions: string[] = [
    `ar.organisation_id = '${orgId}'::uuid`,
    `ar.dismissed_at IS NULL`,
    `ar.acknowledged_at IS NULL`,
  ];

  if (scopeType && scopeId) {
    if (includeDescendantSubaccounts && scopeType === 'org') {
      conditions.push(
        `(ar.scope_type = 'org' AND ar.scope_id = '${scopeId}'::uuid OR (ar.scope_type = 'subaccount' AND ar.scope_id IN (SELECT id FROM subaccounts WHERE organisation_id = '${orgId}'::uuid AND deleted_at IS NULL)))`,
      );
    } else {
      conditions.push(`ar.scope_type = '${scopeType}'`);
      conditions.push(`ar.scope_id = '${scopeId}'::uuid`);
    }
  }

  const whereClause = conditions.join(' AND ');

  if (clampedLimit === 0) {
    // Short-circuit to COUNT(*) only
    // orgId is server-derived from the authenticated session — safe for sql.raw interpolation
    const countRows = await db.execute<{ cnt: string }>(sql.raw(`
      SELECT count(*)::text AS cnt
      FROM agent_recommendations ar
      WHERE ${whereClause}
    `));
    return { rows: [], total: parseInt(countRows[0]?.cnt ?? '0', 10) };
  }

  // Full query with LEFT JOIN to subaccounts for subaccount_display_name
  const rows = await db.execute<{
    id: string;
    scope_type: string;
    scope_id: string;
    subaccount_display_name: string | null;
    category: string;
    severity: string;
    title: string;
    body: string;
    action_hint: string | null;
    evidence: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    acknowledged_at: string | null;
    dismissed_at: string | null;
  }>(sql.raw(`
    SELECT
      ar.id,
      ar.scope_type,
      ar.scope_id::text,
      CASE WHEN ar.scope_type = 'subaccount' THEN s.name ELSE NULL END AS subaccount_display_name,
      ar.category,
      ar.severity,
      ar.title,
      ar.body,
      ar.action_hint,
      ar.evidence,
      ar.created_at::text,
      ar.updated_at::text,
      ar.acknowledged_at::text,
      ar.dismissed_at::text
    FROM agent_recommendations ar
    LEFT JOIN subaccounts s ON s.id = ar.scope_id AND ar.scope_type = 'subaccount'
    WHERE ${whereClause}
    ORDER BY
      CASE ar.severity WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END DESC,
      ar.updated_at DESC
    LIMIT ${clampedLimit}
  `));

  const countRows = await db.execute<{ cnt: string }>(sql.raw(`
    SELECT count(*)::text AS cnt
    FROM agent_recommendations ar
    WHERE ${whereClause}
  `));
  const total = parseInt(countRows[0]?.cnt ?? '0', 10);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      ...(r.subaccount_display_name != null ? { subaccount_display_name: r.subaccount_display_name } : {}),
      category: r.category,
      severity: r.severity,
      title: r.title,
      body: r.body,
      action_hint: r.action_hint,
      evidence: r.evidence,
      created_at: r.created_at,
      updated_at: r.updated_at,
      acknowledged_at: r.acknowledged_at,
      dismissed_at: r.dismissed_at,
    })),
    total,
  };
}

// ── acknowledgeRecommendation ─────────────────────────────────────────────────

export interface AcknowledgeResult {
  success: true;
  alreadyAcknowledged: boolean;
  scope_type: string;
  scope_id: string;
}

export async function acknowledgeRecommendation(
  recId: string,
  orgId: string,
): Promise<AcknowledgeResult | null> {
  // CTE pattern: distinguish "row absent/RLS-hidden" from "already acknowledged"
  const result = await db.execute<{ existed: string; updated_rows: string; scope_type: string; scope_id: string }>(sql`
    WITH existing AS (
      SELECT id, acknowledged_at, scope_type, scope_id
      FROM agent_recommendations
      WHERE id = ${recId}::uuid
      FOR UPDATE
    ),
    updated AS (
      UPDATE agent_recommendations
      SET acknowledged_at = now(), updated_at = now()
      WHERE id = ${recId}::uuid AND acknowledged_at IS NULL
      RETURNING id
    )
    SELECT
      (SELECT count(*)::text FROM existing) AS existed,
      (SELECT count(*)::text FROM updated) AS updated_rows,
      (SELECT scope_type FROM existing LIMIT 1) AS scope_type,
      (SELECT scope_id::text FROM existing LIMIT 1) AS scope_id
  `);

  const row = result[0];
  if (!row) return null;

  const existed = parseInt(row.existed, 10);
  if (existed === 0) return null; // 404

  const updatedRows = parseInt(row.updated_rows, 10);
  return {
    success: true,
    alreadyAcknowledged: updatedRows === 0,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
  };
}

// ── dismissRecommendation ─────────────────────────────────────────────────────

export interface DismissResult {
  success: true;
  alreadyDismissed: boolean;
  dismissed_until: string;
  scope_type: string;
  scope_id: string;
}

export interface DismissOptions {
  reason: string;
  cooldownHours?: number; // admin-only override
  isAdmin?: boolean;
}

export async function dismissRecommendation(
  recId: string,
  orgId: string,
  options: DismissOptions,
): Promise<DismissResult | null> {
  const { reason, cooldownHours: rawCooldownHours, isAdmin = false } = options;

  // Step 1: lock and read the row to derive cooldown from severity (CTE pattern per spec §6.5).
  // We need severity to compute the cooldown interval before the update CTE, so we
  // first SELECT FOR UPDATE to lock the row, then conditionally UPDATE.
  const result = await db.transaction(async (tx) => {
    // CTE step 1: lock the target row
    const targetRows = await tx.execute<{
      id: string;
      severity: string;
      dismissed_at: string | null;
      dismissed_until: string | null;
      scope_type: string;
      scope_id: string;
    }>(sql`
      SELECT id, severity, dismissed_at, dismissed_until::text, scope_type, scope_id::text
      FROM agent_recommendations
      WHERE id = ${recId}::uuid
      FOR UPDATE
    `);

    if (targetRows.length === 0) return null; // 404 — row absent or RLS-hidden

    const target = targetRows[0];
    const scopeType = target.scope_type;
    const scopeId = target.scope_id;

    if (target.dismissed_at !== null) {
      // Already dismissed — idempotent no-op
      return {
        success: true as const,
        alreadyDismissed: true,
        dismissed_until: target.dismissed_until ?? new Date().toISOString(),
        scope_type: scopeType,
        scope_id: scopeId,
      };
    }

    // Compute cooldown from severity
    const severity = target.severity as 'info' | 'warn' | 'critical';
    const defaultCooldownH = COOLDOWN_HOURS_BY_SEVERITY[severity];
    let effectiveCooldownH = defaultCooldownH;

    if (isAdmin && rawCooldownHours !== undefined) {
      // Clamp to [1, 24*90]
      effectiveCooldownH = Math.min(Math.max(rawCooldownHours, 1), 24 * 90);
    }

    // CTE step 2: UPDATE only if still not dismissed (guard against concurrent dismiss)
    const updateRows = await tx.execute<{ dismissed_until: string }>(sql`
      UPDATE agent_recommendations
      SET
        dismissed_at = now(),
        dismissed_reason = ${reason.slice(0, 500)},
        dismissed_until = now() + (${effectiveCooldownH} || ' hours')::interval,
        updated_at = now()
      WHERE id = ${recId}::uuid AND dismissed_at IS NULL
      RETURNING dismissed_until::text
    `);

    const dismissedUntil = updateRows[0]?.dismissed_until ?? new Date().toISOString();

    return {
      success: true as const,
      alreadyDismissed: false,
      dismissed_until: dismissedUntil,
      scope_type: scopeType,
      scope_id: scopeId,
    };
  });

  return result;
}
