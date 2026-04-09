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
