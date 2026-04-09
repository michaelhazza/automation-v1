/**
 * Scope assertion helper — P1.1 Layer 2 of the three-layer fail-closed data
 * isolation contract. See docs/improvements-roadmap-spec.md §P1.1 Layer 2.
 *
 * Purpose: every retrieval boundary that loads data into an LLM context
 * window (system prompt assembly, workspace memory, document retrieval,
 * attachments) must wrap its return value with `assertScope()`. The helper
 * checks that every item's `organisationId` (and optionally `subaccountId`)
 * matches the expected tenant. A mismatch throws a `FailureError` tagged
 * with `scope_violation` — the run is killed and an alert is raised.
 *
 * This is pure defensive code. The intent is that Layer 1 (Postgres RLS)
 * and the service-layer filters always return the right rows, and this
 * helper never fires. When it does fire, it means a bug would otherwise
 * have leaked data across tenants — catching the leak at the boundary
 * before it enters the LLM window is materially better than discovering
 * it in a transcript afterwards.
 *
 * Layer 2 is intentionally synchronous and side-effect-free. It is not
 * the layer that checks RLS propagation (Layer A / 1B of RLS handle that)
 * and it does not write audit rows — it just refuses bad data.
 */

import { FailureError, failure } from '../../shared/iee/failure.js';

/**
 * Shape that every item passed to `assertScope()` must satisfy. Most
 * Drizzle-returned rows already match this shape without any mapping.
 */
export interface ScopedRecord {
  organisationId: string;
  subaccountId?: string | null;
}

export interface ScopeExpectation {
  organisationId: string;
  /**
   * When provided, every item must also match `subaccountId`.
   * When omitted, subaccount mismatches are ignored — use this for
   * org-level retrievals where subaccount is irrelevant.
   * When explicitly `null`, every item must have a null subaccount
   * (i.e. an org-level record).
   */
  subaccountId?: string | null;
}

/**
 * Validate that every item in `items` is scoped to the expected
 * `organisationId` (and optionally `subaccountId`). Returns the same
 * array reference on success for caller convenience:
 *
 *   const rows = assertScope(
 *     await db.select().from(workspaceMemories).where(...),
 *     { organisationId, subaccountId },
 *     'workspaceMemoryService.listMemories',
 *   );
 *
 * On the first mismatch, throws a `FailureError` whose `failureReason`
 * is `scope_violation`. `source` is embedded in the error detail so the
 * stack trace points to the exact retrieval boundary that produced the
 * bad row.
 */
export function assertScope<T extends ScopedRecord>(
  items: T[],
  expected: ScopeExpectation,
  source: string,
): T[] {
  if (!Array.isArray(items)) {
    // Defensive: a caller accidentally passes a single row instead of an
    // array. Treat as a programmer bug — loudly fail before it leaks.
    throw new FailureError(
      failure('internal_error', `assertScope: ${source} was not passed an array`),
    );
  }

  if (!expected.organisationId) {
    throw new FailureError(
      failure('missing_org_context', `assertScope: ${source} called with empty organisationId`),
    );
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new FailureError(
        failure('internal_error', `assertScope: ${source} encountered a non-object item`),
      );
    }
    if (item.organisationId !== expected.organisationId) {
      throw new FailureError(
        failure(
          'scope_violation',
          `${source}: organisationId mismatch`,
          {
            expected: expected.organisationId,
            actual: item.organisationId,
            source,
          },
        ),
      );
    }
    // subaccountId is only checked when the caller specifies an expectation.
    // `undefined` means "caller does not care about subaccount"; `null`
    // means "every item must be org-level".
    if (expected.subaccountId !== undefined) {
      const itemSub = item.subaccountId ?? null;
      const expectedSub = expected.subaccountId;
      if (itemSub !== expectedSub) {
        throw new FailureError(
          failure(
            'scope_violation',
            `${source}: subaccountId mismatch`,
            {
              expected: expectedSub,
              actual: itemSub,
              source,
            },
          ),
        );
      }
    }
  }

  return items;
}

/**
 * Single-item convenience wrapper. Useful for retrievals that return
 * one row (e.g. `resolveSystemPrompt` returning a single merged
 * additionalPrompt record). Returns the item on success.
 */
export function assertScopeSingle<T extends ScopedRecord>(
  item: T | null | undefined,
  expected: ScopeExpectation,
  source: string,
): T | null {
  if (item === null || item === undefined) return null;
  const [validated] = assertScope([item], expected, source);
  return validated;
}
