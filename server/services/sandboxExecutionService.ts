/**
 * sandboxExecutionService.ts — Thin orchestrator for the sandbox execution primitive.
 *
 * Spec B §8.1, §22, §24.1. Implements:
 *   - runTask(input)     — the start-claim lease state machine (7 cases from §8.1).
 *   - getExecution(id)  — read-side helper for reconciliation paths.
 *
 * Provider invocation: deferred to C9 (e2bSandbox) and C10 (localDockerSandbox),
 * wired via resolveSandboxProvider from C4.
 *
 * Harvest seam: deferred to C7 (sandboxHarvestService.runHarvest).
 * Ceiling-monitor enqueue: deferred to C11a.
 */

import { eq, and, sql } from 'drizzle-orm';
import { sandboxExecutions } from '../db/schema/sandboxExecutions.js';
import type { SandboxExecution, NewSandboxExecution } from '../db/schema/sandboxExecutions.js';
import { sandboxTelemetryEvents } from '../db/schema/sandboxTelemetryEvents.js';
import type { SandboxTelemetryEventType, SandboxTelemetryCriticality } from '../db/schema/sandboxTelemetryEvents.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { resolveSandboxProvider } from './sandbox/sandboxProviderResolver.js';
import type { SandboxExecutionService as ISandboxExecutionService } from './sandbox/sandboxProviderResolver.js';
// Side-effect imports — trigger `registerSandboxProvider('e2b' | 'local_docker', ...)`
// at module-init time so the resolver's in-memory registry is populated before
// `getProvider()` (and therefore `resolveSandboxProvider()`) is first called.
// Without these imports the resolver throws `sandbox provider X not registered`
// for any non-inline provider, which would brick every production sandbox call.
// The `inline` provider is wired directly by the resolver and does not need
// a bootstrap import. See plan.md C4 § "registration-seam pattern" and
// sandboxProviderResolver.ts:14-16 for the fail-fast semantics this avoids.
import './sandbox/e2bSandbox.js';
import './sandbox/localDockerSandbox.js';
import { FailureError } from '../../shared/iee/failure.js';
import { failure } from '../../shared/iee/failure.js';
import { assertValidTransition } from '../../shared/stateMachineGuards.js';
import type { SandboxRunTaskInput, SandboxRunTaskOutput } from '../../shared/types/sandbox.js';
import { resolveSandboxCeilings } from './sandboxExecutionServicePure.js';
import { runHarvest } from './sandboxHarvestService.js';

// ---------------------------------------------------------------------------
// Module-level singleton provider (boot-time resolution; fails fast on
// misconfiguration so a mis-deployed service never starts).
// ---------------------------------------------------------------------------

let _provider: ISandboxExecutionService | null = null;

function getProvider(): ISandboxExecutionService {
  if (!_provider) {
    _provider = resolveSandboxProvider();
  }
  return _provider;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of start attempts before the row is moved to provider_unavailable. */
const MAX_START_ATTEMPTS = 3;

/**
 * Lease window multiplier: 2× the provider start timeout.
 * Allows a slow provider start to complete without premature reclaim.
 */
const LEASE_WINDOW_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Telemetry helpers — mirrors the pattern in sandboxHarvestService.ts.
// Used for lifecycle events owned by the execution service (sandbox_start,
// sandbox_start_failed) rather than by the harvest pipeline.
// ---------------------------------------------------------------------------

async function _allocateTelemetrySequence(
  db: ReturnType<typeof getOrgScopedDb>,
  sandboxExecutionId: string,
): Promise<number> {
  type SeqRow = { next_seq: number };
  const rows = (await db.execute(sql`
    SELECT COALESCE(MAX(sequence) + 1, 1) AS next_seq
    FROM sandbox_telemetry_events
    WHERE sandbox_execution_id = ${sandboxExecutionId}
  `)) as unknown as SeqRow[];
  return (rows[0]?.next_seq as number) ?? 1;
}

async function _writeTelemetryEvent(
  row: SandboxExecution,
  eventType: SandboxTelemetryEventType,
  criticality: SandboxTelemetryCriticality,
  payloadJson: Record<string, unknown>,
): Promise<void> {
  const db = getOrgScopedDb('sandboxExecutionService._writeTelemetryEvent');
  const sequence = await _allocateTelemetrySequence(db, row.id);
  try {
    await db.insert(sandboxTelemetryEvents).values({
      sandboxExecutionId: row.id,
      organisationId: row.organisationId,
      subaccountId: row.subaccountId,
      runId: row.runId,
      agentId: row.agentId,
      taskId: row.taskId,
      provider: row.provider,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      eventType,
      criticality,
      sequence,
      payloadJson,
    });
  } catch (err: unknown) {
    // 23505 = unique_violation on (sandbox_execution_id, sequence) — race between
    // two concurrent writes. Non-fatal: log and continue (matches harvest service).
    if ((err as { code?: string }).code === '23505') return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getExecution — read-side helper for reconciliation paths (spec §8.1).
// Returns the canonical sandbox_executions row for the given ID.
// Throws FailureError('sandbox_provider_unavailable') when the row is absent
// (unexpected: callers should only invoke getExecution on rows they know exist).
// ---------------------------------------------------------------------------

export async function getExecution(sandboxExecutionId: string): Promise<SandboxExecution> {
  const db = getOrgScopedDb('sandboxExecutionService.getExecution');
  const rows = await db
    .select()
    .from(sandboxExecutions)
    .where(eq(sandboxExecutions.id, sandboxExecutionId))
    .limit(1);

  if (rows.length === 0) {
    throw new FailureError(
      failure(
        'sandbox_provider_unavailable',
        `sandbox_executions row not found: ${sandboxExecutionId}`,
        { sandboxExecutionId },
      ),
    );
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// runTask — the primary entry point (spec §8.1, §22).
//
// Start-claim lease state machine — 7 cases from spec §8.1:
//
//  Case 1: No existing row → INSERT (status=pending, lease set, attempt_count=1)
//          then proceed to provider start.
//  Case 2: Row exists with provider_sandbox_id set AND status in
//          ('running', 'harvesting') → join the in-flight attempt (wait path).
//  Case 3: Row exists in a terminal state → return canonical row output.
//  Case 4: Row exists with status='pending', provider_sandbox_id IS NULL,
//          start_claim_expires_at < now() → reclaim the stale lease
//          (if attempt_count < MAX_START_ATTEMPTS), then re-attempt provider start.
//  Case 5: Row exists with status='pending', provider_sandbox_id IS NULL,
//          start_claim_expires_at >= now() → another worker is mid-start; wait.
//  Case 6: Provider start succeeds → UPDATE to running, set provider_sandbox_id.
//  Case 7: start_attempt_count >= MAX_START_ATTEMPTS → transition to
//          provider_unavailable.
// ---------------------------------------------------------------------------

export async function runTask(input: SandboxRunTaskInput): Promise<SandboxRunTaskOutput> {
  const db = getOrgScopedDb('sandboxExecutionService.runTask');
  const resolvedCeilings = resolveSandboxCeilings(input.policy);
  const leaseWindowMs = resolvedCeilings.wallClockMs * LEASE_WINDOW_MULTIPLIER;

  // Compute lease expiry timestamp.
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() + leaseWindowMs);

  // ── Case 1: attempt the initial INSERT ─────────────────────────────────────
  // `startedAt` is set at lease-claim time so the reconciliation sweep
  // (§20.3) can identify orphaned rows via its `started_at IS NOT NULL AND
  // started_at < cutoff` predicate. Without setting it here, a crash between
  // INSERT and provider start (the most common orphan case) would leave the
  // row permanently invisible to reconciliation.
  const newRow: NewSandboxExecution = {
    id: input.sandboxExecutionId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    // Provider name is read from env and stored on the row for audit purposes.
    provider: _getProviderName(),
    templateName: input.templateName,
    templateVersion: input.templateVersion,
    status: 'pending',
    policyJson: input.policy,
    inputSummaryJson: {
      inputBytes: input.inputBytes,
      fileCount: input.inputFiles.length,
      mimes: input.inputFiles.map((f) => f.mime),
    },
    startedAt: now,
    startClaimedAt: now,
    startClaimExpiresAt: leaseExpiry,
    startAttemptCount: 1,
  };

  let existing: SandboxExecution | undefined;

  try {
    const inserted = await db
      .insert(sandboxExecutions)
      .values(newRow)
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      // INSERT succeeded — we hold the lease.
      return await _attemptProviderStart(input, inserted[0], resolvedCeilings.wallClockMs);
    }

    // INSERT was a no-op (conflict on PK) — row already exists.
    const existingRows = await db
      .select()
      .from(sandboxExecutions)
      .where(eq(sandboxExecutions.id, input.sandboxExecutionId))
      .limit(1);

    existing = existingRows[0];
  } catch (err) {
    // Re-throw FailureErrors; reclassify unexpected errors.
    if (err instanceof FailureError) throw err;
    throw new FailureError(
      failure('sandbox_provider_unavailable', `runTask INSERT failed unexpectedly: ${String(err)}`),
    );
  }

  if (!existing) {
    throw new FailureError(
      failure('sandbox_provider_unavailable', 'runTask: row vanished after conflict insert'),
    );
  }

  return await _handleExistingRow(input, existing, resolvedCeilings.wallClockMs);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set([
  'completed',
  'timed_out',
  'cost_ceiling_hit',
  'crashed',
  'output_validation_failed',
  'harvest_failed',
  'artefact_upload_failed',
  'provider_unavailable',
] as const);

function _isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status as Parameters<typeof TERMINAL_STATUSES['has']>[0]);
}

function _getProviderName(): 'e2b' | 'local_docker' | 'inline' {
  const raw = process.env['SANDBOX_PROVIDER'];
  if (raw === 'e2b' || raw === 'local_docker' || raw === 'inline') return raw;
  return 'e2b'; // fallback; resolveSandboxProvider() will throw on misconfiguration
}

async function _handleExistingRow(
  input: SandboxRunTaskInput,
  row: SandboxExecution,
  wallClockMs: number,
): Promise<SandboxRunTaskOutput> {
  const db = getOrgScopedDb('sandboxExecutionService._handleExistingRow');

  // ── Case 3: row is already in a terminal state ────────────────────────────
  if (_isTerminal(row.status)) {
    return _buildOutputFromRow(row);
  }

  // ── Case 2: row is running or harvesting — join in-flight ─────────────────
  if (row.status === 'running' || row.status === 'harvesting') {
    return _buildOutputFromRow(row);
  }

  // ── Cases 4 / 5 / 7: row is pending ───────────────────────────────────────
  if (row.status === 'pending') {
    const leaseStillActive =
      row.startClaimExpiresAt !== null && row.startClaimExpiresAt > new Date();

    // ── Case 5: fresh lease held by another worker ─────────────────────────
    if (leaseStillActive && row.providerSandboxId === null) {
      // The lease is still live and the provider hasn't been called yet.
      // Return an in-progress view so the caller can retry externally.
      return _buildOutputFromRow(row);
    }

    // ── Case 7: attempt cap reached ────────────────────────────────────────
    if ((row.startAttemptCount ?? 0) >= MAX_START_ATTEMPTS) {
      assertValidTransition({
        kind: 'sandbox_execution',
        recordId: row.id,
        from: 'pending',
        to: 'provider_unavailable',
      });

      await db
        .update(sandboxExecutions)
        .set({
          status: 'provider_unavailable',
          errorReason: 'sandbox_provider_unavailable',
          errorDetail: `start_attempt_count reached MAX_START_ATTEMPTS (${MAX_START_ATTEMPTS})`,
          terminatedAt: new Date(),
        })
        .where(
          and(
            eq(sandboxExecutions.id, row.id),
            eq(sandboxExecutions.status, 'pending'),
          ),
        );

      // Spec §14.5: pre-start failure path MUST emit sandbox_start_failed.
      await _writeTelemetryEvent(row, 'sandbox_start_failed', 'error', {
        reason: 'provider_unavailable',
        providerErrorCode: `start_attempt_count_cap_${MAX_START_ATTEMPTS}`,
      });

      throw new FailureError(
        failure(
          'sandbox_provider_unavailable',
          `sandbox start attempt cap (${MAX_START_ATTEMPTS}) reached for ${row.id}`,
          { sandboxExecutionId: row.id },
        ),
      );
    }

    // ── Case 4: stale lease — reclaim it ───────────────────────────────────
    const now = new Date();
    const leaseWindowMs = wallClockMs * LEASE_WINDOW_MULTIPLIER;
    const newExpiry = new Date(now.getTime() + leaseWindowMs);

    const reclaimed = await db
      .update(sandboxExecutions)
      .set({
        // Refresh `startedAt` so the reconciliation sweep's wall-clock+buffer
        // deadline is measured from the reclaimed attempt, not the original
        // (crashed) attempt. Without this, a freshly-reclaimed execution would
        // be marked orphaned immediately by the next sweep tick because its
        // started_at would still point at the original lease-claim timestamp
        // from up to wall-clock+buffer minutes ago.
        startedAt: now,
        startClaimedAt: now,
        startClaimExpiresAt: newExpiry,
        startAttemptCount: sql`${sandboxExecutions.startAttemptCount} + 1`,
      })
      .where(
        and(
          eq(sandboxExecutions.id, row.id),
          eq(sandboxExecutions.status, 'pending'),
          // Optimistic concurrency on the prior expiry value.
          row.startClaimExpiresAt !== null
            ? sql`${sandboxExecutions.startClaimExpiresAt} = ${row.startClaimExpiresAt.toISOString()}`
            : sql`${sandboxExecutions.startClaimExpiresAt} IS NULL`,
        ),
      )
      .returning();

    if (reclaimed.length === 0) {
      // Lost the reclaim race — re-read and handle.
      const fresh = await db
        .select()
        .from(sandboxExecutions)
        .where(eq(sandboxExecutions.id, input.sandboxExecutionId))
        .limit(1);
      if (fresh.length === 0) {
        throw new FailureError(
          failure('sandbox_provider_unavailable', `runTask: row vanished during lease reclaim`),
        );
      }
      return _handleExistingRow(input, fresh[0], wallClockMs);
    }

    return await _attemptProviderStart(input, reclaimed[0], wallClockMs);
  }

  // Should not reach here — unknown status.
  throw new FailureError(
    failure(
      'sandbox_provider_unavailable',
      `runTask: unexpected status '${row.status}' on row ${row.id}`,
    ),
  );
}

async function _attemptProviderStart(
  input: SandboxRunTaskInput,
  row: SandboxExecution,
  _wallClockMs: number,
): Promise<SandboxRunTaskOutput> {
  const db = getOrgScopedDb('sandboxExecutionService._attemptProviderStart');

  // ── Case 6 setup: invoke the provider ─────────────────────────────────────
  const provider = getProvider();

  // TODO(C11a): enqueue sandboxCeilingMonitorJob via sandboxJobNames before
  // invoking the provider so the monitor starts ticking from sandbox-start time.

  let providerOutput: SandboxRunTaskOutput;
  try {
    providerOutput = await provider.runTask(input);
  } catch (err) {
    // Provider start or execution failed. Transition the row to provider_unavailable.
    assertValidTransition({
      kind: 'sandbox_execution',
      recordId: row.id,
      from: row.status,
      to: 'provider_unavailable',
    });

    await db
      .update(sandboxExecutions)
      .set({
        status: 'provider_unavailable',
        errorReason: 'sandbox_provider_unavailable',
        errorDetail: err instanceof FailureError ? err.failure.failureDetail : String(err),
        terminatedAt: new Date(),
      })
      .where(
        and(
          eq(sandboxExecutions.id, row.id),
          eq(sandboxExecutions.status, 'pending'),
        ),
      );

    // Spec §14.5: pre-start failure path MUST emit sandbox_start_failed.
    await _writeTelemetryEvent(row, 'sandbox_start_failed', 'error', {
      reason: 'provider_unavailable',
      providerErrorCode: err instanceof FailureError ? err.failure.failureReason : undefined,
    });

    if (err instanceof FailureError) throw err;
    throw new FailureError(
      failure('sandbox_provider_unavailable', `provider.runTask failed: ${String(err)}`),
    );
  }

  // ── Case 6 success: provider returned a terminal output ───────────────────
  // The provider (C9 / C10) handles the running → terminal lifecycle internally.
  // Spec §14.5: post-start path MUST emit sandbox_start at the pending → running
  // transition. Emitted here, immediately after the provider confirms successful
  // start (the provider's runTask encapsulates the full start→run→terminal cycle).
  await _writeTelemetryEvent(row, 'sandbox_start', 'info', {
    ceilings: input.policy.ceilings,
    network_policy: input.policy.network.mode,
    alias_count: input.credentialIssuanceContext.aliases.length,
  });

  // Transition to harvesting so the harvest pipeline sees the expected status.
  // Spec §13.1: running → harvesting is the gateway to all terminal writes.
  // The provider's runTask encapsulates the full start→run lifecycle; we write
  // harvesting immediately after the successful provider return.
  assertValidTransition({
    kind: 'sandbox_execution',
    recordId: row.id,
    from: row.status,
    to: 'harvesting',
  });
  // `startedAt` was set at the initial lease-claim INSERT (see Case 1) so the
  // reconciliation sweep can identify orphans — no re-write needed here.
  await db
    .update(sandboxExecutions)
    .set({
      status: 'harvesting',
      outputJson: providerOutput.output,
      metricsJson: providerOutput.metrics,
      costCents: providerOutput.costCents,
    })
    .where(
      and(
        eq(sandboxExecutions.id, row.id),
        eq(sandboxExecutions.status, 'pending'),
      ),
    );

  // Wire the harvest pipeline (spec §8.4, §22). The harvest service handles
  // all 12 ordered steps (output read, validate, redact, artefact upload,
  // log persistence, cost row, telemetry terminal event, row terminal UPDATE).
  return runHarvest(input.sandboxExecutionId, {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    provider: providerOutput.provider,
    templateName: providerOutput.templateName,
    templateVersion: providerOutput.templateVersion,
    outputSchemaRef: input.outputSchemaRef,
    credentialAliases: input.credentialIssuanceContext.aliases,
    policyArtefactLimits: input.policy.artefactLimits,
  });
}

/**
 * Build a SandboxRunTaskOutput from a canonical sandbox_executions row.
 * Used for idempotent re-reads when the row is already terminal or in-flight.
 */
function _buildOutputFromRow(row: SandboxExecution): SandboxRunTaskOutput {
  const terminalState = _isTerminal(row.status)
    ? (row.status as SandboxRunTaskOutput['terminalState'])
    : ('provider_unavailable' as const);

  return {
    sandboxExecutionId: row.id,
    terminalState,
    output: row.outputJson ?? null,
    artefactRefs: [],
    logRefs: {
      stdout: `log:${row.id}:stdout`,
      stderr: `log:${row.id}:stderr`,
    },
    metrics: (row.metricsJson as SandboxRunTaskOutput['metrics']) ?? {
      wallClockMs: 0,
      vcpuSeconds: 0,
      peakMemoryMb: 0,
      egressBytes: 0,
    },
    costCents: row.costCents ?? 0,
    templateName: row.templateName,
    templateVersion: row.templateVersion,
    provider: row.provider as SandboxRunTaskOutput['provider'],
  };
}
