/**
 * orgScopedDb — Sprint 2 P1.1 Layer 1 service-layer DB helper.
 *
 * Every service-layer DB access MUST go through `getOrgScopedDb()` so that:
 *
 *   1. The query runs inside the org-scoped transaction opened by the
 *      `orgScoping` HTTP middleware or the `createWorker` pg-boss wrapper,
 *      which has already issued `SELECT set_config('app.organisation_id', …)`.
 *   2. A service called outside any `withOrgTx(...)` block fails loudly with
 *      `failure('missing_org_context')` (Layer A of the three-layer fail-closed
 *      data isolation contract). This is the first line of defence; RLS policies
 *      are the silent backup defence-in-depth if a code path bypasses the
 *      service layer entirely.
 *
 * Non-org-scoped access paths (migrations, cron, admin tooling, boot-time
 * system reads) MUST use `server/lib/adminDbConnection.ts::withAdminConnection`
 * instead. That helper acquires a connection bound to the `admin_role`
 * Postgres role which has BYPASSRLS and explicitly logs every invocation to
 * `audit_events`.
 *
 * See `docs/improvements-roadmap-spec.md` §P1.1 Layer 1 for the full contract.
 */

import { getOrgTxContext } from '../instrumentation.js';
import type { OrgScopedTx } from '../db/index.js';
import { throwFailure } from '../../shared/iee/failure.js';

/**
 * Return the drizzle transaction handle bound to the current org context.
 * Throws `failure('missing_org_context')` when the caller is outside any
 * `withOrgTx(...)` block.
 *
 * Use this inside services whenever you need to run a query. The returned
 * handle has the same API as the top-level `db` object, so existing
 * `db.select(...)`-style calls drop in by swapping the reference.
 */
export function getOrgScopedDb(source: string): OrgScopedTx {
  const ctx = getOrgTxContext();
  if (!ctx) {
    throwFailure(
      'missing_org_context',
      `${source}: service-layer DB access reached without an active org-scoped transaction`,
      { source },
    );
  }
  return ctx.tx as OrgScopedTx;
}

/**
 * Return the current organisation id the ALS tx is bound to, or throw
 * `failure('missing_org_context')` if none is set. Use this when a service
 * needs to read the tenant id for audit logging or cross-checks without
 * trusting the input arguments.
 */
export function getOrgScopedOrgId(source: string): string {
  const ctx = getOrgTxContext();
  if (!ctx) {
    throwFailure(
      'missing_org_context',
      `${source}: organisationId requested outside an org-scoped transaction`,
      { source },
    );
  }
  return ctx.organisationId;
}

/**
 * Non-throwing peek at the active org context. Used by telemetry / tracing
 * callers that want to enrich spans without affecting control flow when the
 * context is absent (e.g. startup-time reads, test harnesses).
 */
export function peekOrgTxContext(): ReturnType<typeof getOrgTxContext> {
  return getOrgTxContext();
}

/**
 * Assert that the caller is inside an active `withOrgTx(...)` transaction.
 *
 * Unlike `getOrgScopedOrgId(source)` (which only proves an org context exists),
 * this assertion additionally verifies the `tx` handle is present on the
 * context. The two are equivalent in this codebase by construction —
 * `withOrgTx` is the only setter of the AsyncLocalStorage and it always
 * supplies a `tx` — but stating both invariants explicitly makes the
 * transaction-liveness contract visible in caller code, and provides a
 * named anchor for reviewers / grep-gates that want to confirm the
 * transaction-required call sites without tracing the call chain.
 *
 * Throws `failure('missing_org_context')` with a transaction-specific message
 * if either check fails.
 *
 * Use this at the entry of helpers that depend on transaction-scoped Postgres
 * features (e.g. `pg_advisory_xact_lock`, savepoints, SELECT ... FOR UPDATE
 * in a multi-statement read-then-write sequence).
 */
export function assertOrgScopedTransactionActive(source: string): void {
  const ctx = getOrgTxContext();
  if (!ctx) {
    throwFailure(
      'missing_org_context',
      `${source}: requires an active withOrgTx transaction context — caller is outside any withOrgTx block`,
      { source },
    );
  }
  if (!ctx.tx) {
    // Defence-in-depth: the AsyncLocalStorage has a context but no tx handle.
    // This is impossible by construction (withOrgTx always sets tx) — but
    // explicit failure is better than silent degradation if the contract
    // is ever violated by a future refactor.
    throwFailure(
      'missing_org_context',
      `${source}: org context present but tx handle missing — withOrgTx contract violated`,
      { source },
    );
  }
}
