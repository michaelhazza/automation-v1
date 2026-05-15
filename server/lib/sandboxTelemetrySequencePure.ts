/**
 * sandboxTelemetrySequencePure.ts — Advisory-lock-serialised sequence allocator
 * for sandbox_telemetry_events.
 *
 * Spec B §6.2 (SANDBOX-ADV-3.1). Eliminates the SELECT-then-INSERT race that
 * existed in sandboxExecutionService and sandboxHarvestService by taking a
 * per-execution advisory lock before computing the next sequence number.
 *
 * The "Pure" suffix indicates this file has zero direct DB imports — callers
 * pass in the in-transaction db handle, keeping this module testable without
 * a real Postgres connection.
 */

import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../db/index.js';
import { sandboxTelemetryEvents } from '../db/schema/sandboxTelemetryEvents.js';
import type { NewSandboxTelemetryEvent } from '../db/schema/sandboxTelemetryEvents.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import { logger } from './logger.js';
import { assertOrgScopedTransactionActive } from './orgScopedDb.js';

export type SandboxTelemetryEventInsert = NewSandboxTelemetryEvent;

export interface AllocateAndInsertResult {
  sequence: number;
  inserted: boolean;
}

const DEFAULT_MAX_RETRIES = 3;

/**
 * Allocate the next sequence number for a sandbox execution's telemetry stream
 * and INSERT the event row, serialised via a Postgres transactional advisory lock.
 *
 * The lock key is derived from the first 64 bits of `sandboxExecutionId`
 * (split into two int4 values for the two-argument
 * `pg_advisory_xact_lock(int4, int4)` form) so all writers for the same
 * execution serialise against each other within any given transaction.
 * The lock is released automatically at transaction end. (Prior versions
 * used `hashtext(sandboxExecutionId)::bigint` which only gave 32-bit
 * effective entropy via sign-extension — see KNOWLEDGE.md 2026-05-15.)
 *
 * On 23505 unique-violation (defensive; should not occur under the advisory lock):
 *   - `info`/`warn` criticality: log warn, return `{ inserted: false }`.
 *   - `error` criticality: throw `FailureError('sandbox_telemetry_drop')`.
 *
 * MUST be called inside an existing transaction (withOrgTx or equivalent) so
 * `pg_advisory_xact_lock` has a transaction to bind to. The contract is
 * enforced at three layers:
 *   1. The `db` parameter is typed `OrgScopedTx` — the type system rejects
 *      callers that try to pass the raw `db` import.
 *   2. The only construction path is `getOrgScopedDb(...)`, which throws
 *      `failure('missing_org_context')` if no `withOrgTx` is active.
 *   3. `assertOrgScopedTransactionActive(source)` at helper entry re-reads
 *      the AsyncLocalStorage context AND verifies the `tx` handle is
 *      present, throwing if either check fails. This is the explicit
 *      transaction-liveness assertion — not just an org-context check.
 *
 * `pg_advisory_xact_lock` is transaction-scoped (released at COMMIT or
 * ROLLBACK) — it persists across the subsequent SELECT MAX(sequence) and
 * INSERT statements within the same transaction.
 */
export async function allocateAndInsertTelemetryEvent(
  db: OrgScopedTx,
  rowToInsert: Omit<SandboxTelemetryEventInsert, 'sequence'>,
  opts?: { maxRetries?: number },
): Promise<AllocateAndInsertResult> {
  // Runtime contract enforcement (defence-in-depth layer 3): assert active
  // withOrgTx transaction. The assertion checks both AsyncLocalStorage
  // presence AND the tx handle on the context — proving transaction
  // liveness, not just org-context existence. Without this, the type
  // system trusts the caller; with it, a stale `db` handle passed from a
  // closed tx still fails fast rather than silently running each statement
  // in auto-commit.
  assertOrgScopedTransactionActive('allocateAndInsertTelemetryEvent');

  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const { sandboxExecutionId, criticality, eventType } = rowToInsert;

  // Acquire a per-execution advisory lock using the first 64 bits of the UUID.
  // The two-argument form of pg_advisory_xact_lock takes two int4 values — this
  // uses the first 32 bits as lockid_hi and the next 32 bits as lockid_lo,
  // giving full 64-bit entropy from the UUID. The single-argument form with
  // hashtext()::bigint only provides 32 bits of effective entropy (sign-extended
  // int4), making collisions likely at ~65K concurrent executions.
  // pg_advisory_xact_lock is held until tx end.
  await db.execute(sql`
    SELECT pg_advisory_xact_lock(
      ('x' || substr(replace(${sandboxExecutionId}, '-', ''), 1, 8))::bit(32)::int,
      ('x' || substr(replace(${sandboxExecutionId}, '-', ''), 9, 8))::bit(32)::int
    )
  `);

  let lastAttemptedSequence = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Compute next sequence inside the lock — no concurrent writer can race here.
    type SeqRow = { next_seq: number };
    const seqRows = (await db.execute(sql`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq
      FROM sandbox_telemetry_events
      WHERE sandbox_execution_id = ${sandboxExecutionId}
    `)) as unknown as SeqRow[];
    const sequence = (seqRows[0]?.next_seq as number) ?? 1;

    try {
      const inserted = await db
        .insert(sandboxTelemetryEvents)
        .values({ ...rowToInsert, sequence })
        .returning({ sequence: sandboxTelemetryEvents.sequence });
      return { sequence: inserted[0]?.sequence ?? sequence, inserted: true };
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== '23505') {
        throw err;
      }
      // 23505 — unique violation (defensive path; should not happen under advisory lock).
      lastAttemptedSequence = sequence;
    }
  }

  // All retries exhausted.
  if (criticality === 'error') {
    throw new FailureError(
      failure('sandbox_telemetry_drop', `sequence retries exhausted`, {
        sandboxExecutionId,
        eventType,
        criticality,
      }),
    );
  }

  logger.warn('sandbox.telemetry.dropped_after_retries', {
    sandboxExecutionId,
    eventType,
    criticality,
  });
  return { sequence: lastAttemptedSequence, inserted: false };
}
