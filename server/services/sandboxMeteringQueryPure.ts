/**
 * sandboxMeteringQueryPure.ts — Pure helpers for sandbox metering queries.
 *
 * Spec §6.5 (REQ #20). Builds SQL fragments for org- and subaccount-scoped
 * sandbox compute-minute queries and rolls up raw DB rows into the public
 * SandboxMinutesQueryResult shape.
 *
 * Pure: zero transitive DB imports. Only the drizzle-orm `sql` tag and
 * primitive types are imported. Tables are referenced by raw SQL name
 * (`llm_requests`) per the pure-helper convention enforced by
 * verify-pure-helper-convention.sh.
 *
 * Runnable test:
 *   npx vitest run server/services/__tests__/sandboxMeteringQueryPure.test.ts
 */

import { sql, type SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SandboxMinutesQueryInput {
  organisationId: string;
  subaccountId?: string;
  fromIso: string; // inclusive lower bound (ISO 8601)
  toIso: string;   // exclusive upper bound (ISO 8601)
}

export interface SandboxMinutesQueryResult {
  scope: 'org' | 'subaccount';
  totalMinutes: number;
  byTemplate: Array<{ templateName: string; minutes: number }>;
}

export interface SandboxMeteringRow {
  templateName: string;
  // The SQL builders cast `SUM(...)::bigint` (rather than `::int`) so the
  // aggregate cannot overflow int4 (~24.8 days of summed wall-clock ms across
  // a query window). The pg driver returns bigint values as strings to avoid
  // JS number-precision loss; rollupSandboxMinutes coerces with Number()
  // before doing arithmetic. Sums above Number.MAX_SAFE_INTEGER (~285k years
  // of ms) are not a concern.
  wallClockMs: number | string;
}

// ---------------------------------------------------------------------------
// Internal: ISO window validation
// ---------------------------------------------------------------------------

function assertValidIsoWindow(fromIso: string, toIso: string): void {
  if (isNaN(new Date(fromIso).getTime()) || isNaN(new Date(toIso).getTime())) {
    throw new Error('invalid_iso_window');
  }
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/**
 * Builds a Drizzle SQL fragment that returns per-template sandbox compute
 * totals for the given organisation within the ISO time window.
 *
 * Source table is `llm_requests` filtered by `source_type = 'sandbox_compute'`
 * per spec §12 metering contract.
 */
export function buildOrgSandboxMinutesQuery(
  input: SandboxMinutesQueryInput,
): SQL<unknown> {
  assertValidIsoWindow(input.fromIso, input.toIso);

  return sql`
    SELECT
      lr.sandbox_template_version AS template_name,
      SUM(lr.sandbox_wall_clock_ms)::bigint AS wall_clock_ms
    FROM llm_requests lr
    WHERE lr.source_type = 'sandbox_compute'
      AND lr.organisation_id = ${input.organisationId}
      AND lr.created_at >= ${input.fromIso}::timestamptz
      AND lr.created_at < ${input.toIso}::timestamptz
    GROUP BY lr.sandbox_template_version
  `;
}

/**
 * Builds a Drizzle SQL fragment scoped to a specific subaccount within an
 * organisation. Adds `AND lr.subaccount_id = ?` on top of the org-level filter.
 */
export function buildSubaccountSandboxMinutesQuery(
  input: SandboxMinutesQueryInput & { subaccountId: string },
): SQL<unknown> {
  assertValidIsoWindow(input.fromIso, input.toIso);

  return sql`
    SELECT
      lr.sandbox_template_version AS template_name,
      SUM(lr.sandbox_wall_clock_ms)::bigint AS wall_clock_ms
    FROM llm_requests lr
    WHERE lr.source_type = 'sandbox_compute'
      AND lr.organisation_id = ${input.organisationId}
      AND lr.subaccount_id = ${input.subaccountId}
      AND lr.created_at >= ${input.fromIso}::timestamptz
      AND lr.created_at < ${input.toIso}::timestamptz
    GROUP BY lr.sandbox_template_version
  `;
}

// ---------------------------------------------------------------------------
// Row rollup
// ---------------------------------------------------------------------------

/**
 * Rolls up raw metering rows (from executing the query built above) into
 * the SandboxMinutesQueryResult shape.
 *
 * wallClockMs values are summed per template and converted to minutes
 * (floored to avoid fractional minutes in billing display). The total is
 * the sum of all per-template minutes — NOT a separate floor of the grand
 * total wall-clock-ms — so per-template and total figures are consistent.
 */
export function rollupSandboxMinutes(
  scope: 'org' | 'subaccount',
  rows: SandboxMeteringRow[],
): SandboxMinutesQueryResult {
  if (rows.length === 0) {
    return { scope, totalMinutes: 0, byTemplate: [] };
  }

  // Group wallClockMs by templateName (rows should already be grouped by the
  // SQL query, but this handles any duplicates defensively). Coerce bigint-as-
  // string values from the pg driver before summing.
  const byTemplate = new Map<string, number>();
  for (const row of rows) {
    const ms = typeof row.wallClockMs === 'string' ? Number(row.wallClockMs) : row.wallClockMs;
    byTemplate.set(
      row.templateName,
      (byTemplate.get(row.templateName) ?? 0) + ms,
    );
  }

  const templateEntries = Array.from(byTemplate.entries()).map(
    ([templateName, totalMs]) => ({
      templateName,
      minutes: Math.floor(totalMs / 60000),
    }),
  );

  const totalMinutes = templateEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );

  return { scope, totalMinutes, byTemplate: templateEntries };
}
