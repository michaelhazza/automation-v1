// ---------------------------------------------------------------------------
// cachedContextWriteScope — observability surface for cached-context writes
// ---------------------------------------------------------------------------
//
// F2b (write-side) of the cached-context isolation review. Read-side
// enforcement (F2a) is deferred per `tasks/todo.md`; this helper is the
// minimal write-side deliverable: every cached-context table write is
// logged with its `(organisationId, subaccountId)` scope tuple so a future
// scope leak surfaces in observability before it surfaces as a customer
// incident.
//
// Why this exists separately from F2a:
//   - Read leakage = exposure (one tenant sees another's data).
//   - Write leakage = corruption (data lands on the wrong tenant — much
//     larger blast radius). Splitting the two lets us add early signal
//     for the higher-risk path without committing to the full
//     architectural shape that F2a needs.
//
// This is intentionally a logger, not a thrower. ChatGPT PR review round 2
// recommended log/assert — we log now and promote to assert when the F2
// follow-up spec defines what "explicitly declared org-scoped" means in
// the type system.
// ---------------------------------------------------------------------------

import { logger } from './logger.js';

export type CachedContextOperation = 'insert' | 'update' | 'delete' | 'archive' | 'restore' | 'deprecate';

export interface CachedContextWriteScope {
  /** Org the write belongs to. Always required. */
  organisationId: string;
  /** Subaccount the write belongs to. `null` for legitimately org-scoped writes. */
  subaccountId: string | null;
  /** Canonical table name this write targets (e.g. `'reference_documents'`). */
  table: string;
  /**
   * Logical operation kind. `'insert'` for create paths, `'update'` for
   * mutating paths (rename, deprecate, restore), etc. Distinguishing kinds
   * keeps log queries usefully filterable (e.g. "every insert in the last
   * hour where subaccountId was null").
   */
  operation: CachedContextOperation;
}

/**
 * Log a cached-context table write with its full scope tuple. Callers
 * SHOULD invoke this once per logical write boundary (create / update /
 * delete entry points), not once per UPDATE statement — repeated calls
 * inside a transaction add noise without adding signal.
 *
 * Logged fields are explicit (not nested under metadata) so log-query
 * tools can index and filter on them directly:
 *   - `site` — call-site identifier (e.g. `referenceDocumentService.create`)
 *   - `table` — canonical table name
 *   - `operation` — `insert` / `update` / `delete` / `archive` / ...
 *   - `organisationId` / `subaccountId` — scope tuple
 *   - `hasSubaccountId` — boolean shortcut for the most-queried filter
 *   - `isOrgScopedWrite` — alias of `!hasSubaccountId`, kept for clarity
 */
export function logCachedContextWrite(
  site: string,
  scope: CachedContextWriteScope,
  metadata?: Record<string, unknown>,
): void {
  const hasSubaccountId = scope.subaccountId !== null && scope.subaccountId !== undefined;
  logger.info('cached_context.write', {
    event: 'cached_context.write',
    site,
    table: scope.table,
    operation: scope.operation,
    organisationId: scope.organisationId,
    subaccountId: scope.subaccountId,
    hasSubaccountId,
    isOrgScopedWrite: !hasSubaccountId,
    ...(metadata ?? {}),
  });

  // Defence-in-depth signal: a write with no subaccount AND no explicit
  // marker is the exact shape that would indicate a forgotten-filter bug.
  // Today every caller passes `subaccountId: string | null` and may
  // legitimately mean either, so we only log at warn level when the value
  // is missing entirely (undefined). Once the F2 follow-up spec
  // introduces an explicit `{ orgScoped: true }` discriminator we can
  // promote this to assert.
  if (scope.subaccountId === undefined) {
    logger.warn('cached_context.write_missing_scope', {
      event: 'cached_context.write_missing_scope',
      site,
      table: scope.table,
      operation: scope.operation,
      organisationId: scope.organisationId,
    });
  }
}
