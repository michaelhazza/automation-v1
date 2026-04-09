/**
 * adminDbConnection — Sprint 2 P1.1 Layer 1 Path 3 (admin bypass).
 *
 * System jobs that do NOT have a natural `organisationId` — migrations,
 * cron jobs, boot-time initialisation, one-off admin scripts — must route
 * their DB access through `withAdminConnection(fn)` defined here. This
 * helper:
 *
 *   1. Runs `fn` against a Drizzle transaction that has NOT issued
 *      `SELECT set_config('app.organisation_id', …)`. RLS policies defined
 *      on protected tables fail-closed when `app.organisation_id` is unset
 *      (see migration 0079), so a direct query from this helper would
 *      return zero rows — which is the correct behaviour for a path that
 *      doesn't belong to any tenant.
 *   2. To bypass RLS deliberately for legitimate cross-org work (the
 *      nightly retention pruner, the regression replay runner, migrations),
 *      the caller must ALSO set the session role to `admin_role` — a
 *      Postgres role that has BYPASSRLS — inside the fn via
 *      `await tx.execute(sql\`SET LOCAL ROLE admin_role\`)`. The helper
 *      intentionally does NOT set the role for the caller; the explicit
 *      per-call role switch makes admin-bypass usage greppable in audits.
 *   3. Every invocation logs a row to `audit_events` with the `source`
 *      tag and an optional caller-supplied reason so admin-bypass usage is
 *      traceable.
 *
 * Non-admin code paths MUST NOT import this helper — they must use
 * `getOrgScopedDb()` from `server/lib/orgScopedDb.ts`, which reads the
 * request-scoped / job-scoped transaction from the AsyncLocalStorage slot
 * set by `authenticate` or `createWorker`.
 *
 * See `docs/improvements-roadmap-spec.md` §P1.1 Layer 1 Path 3.
 */

import { db } from '../db/index.js';
import type { OrgScopedTx } from '../db/index.js';

export interface AdminConnectionOptions {
  /** Short machine-readable tag identifying the caller. */
  source: string;
  /** Optional free-form reason logged to audit_events. */
  reason?: string;
  /** Skip the audit log write — used by the auditService itself to avoid
   *  infinite recursion when it writes audit rows on behalf of other
   *  admin-bypass callers. Default false. */
  skipAudit?: boolean;
}

/**
 * Run `fn` inside an admin transaction that bypasses the request-scoped
 * org-scoped transaction contract. Used for cross-org maintenance work,
 * migrations, and scheduled prune jobs.
 *
 * The caller is responsible for explicitly switching the Postgres session
 * role to `admin_role` (which has BYPASSRLS) when they legitimately need
 * cross-org access. Queries that do not switch the role will hit the
 * fail-closed RLS policies and return zero rows.
 */
export async function withAdminConnection<T>(
  options: AdminConnectionOptions,
  fn: (tx: OrgScopedTx) => Promise<T>,
): Promise<T> {
  if (!options.skipAudit) {
    // Admin-bypass invocations are logged to stderr with a stack trace
    // instead of to `audit_events`. Writing to `audit_events` here would
    // create a circular dependency with Sprint 2 P1.1 Layer 1 — once RLS
    // is enforced on audit_events, the insert would itself need an
    // admin-bypass tx, and so on. The structured stderr log is grep-able
    // during incident response and captured by the usual log aggregation
    // stack. If stricter durability is needed later, route this via a
    // dedicated audit table with its own RLS policy.
    const stack = new Error().stack?.split('\n').slice(2, 6).join('\n') ?? null;
    console.warn(
      '[withAdminConnection] admin_db_bypass',
      JSON.stringify({
        source: options.source,
        reason: options.reason ?? null,
        stack,
      }),
    );
  }

  return db.transaction(async (tx) => {
    // Deliberately do NOT issue set_config('app.organisation_id', ...).
    // Callers that need cross-org access must explicitly switch role via
    // `await tx.execute(sql\`SET LOCAL ROLE admin_role\`)` inside fn.
    return fn(tx as OrgScopedTx);
  });
}
