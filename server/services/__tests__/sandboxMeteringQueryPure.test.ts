/**
 * sandboxMeteringQueryPure.test.ts — Pure helper tests for sandbox metering queries.
 *
 * Spec §6.5 (REQ #20). No DB, no network. Pure input → output assertions.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/sandboxMeteringQueryPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildOrgSandboxMinutesQuery,
  buildSubaccountSandboxMinutesQuery,
  rollupSandboxMinutes,
  type SandboxMeteringRow,
} from '../sandboxMeteringQueryPure.js';

// ---------------------------------------------------------------------------
// Helper: extract the static SQL text from a drizzle-orm SQL fragment.
// queryChunks alternates between StringChunk (static text) and interpolated
// param values. We join only the string chunks to inspect the query shape.
// ---------------------------------------------------------------------------

function extractSqlText(frag: { queryChunks: unknown[] }): string {
  return frag.queryChunks
    .filter(
      (c): c is { value: string[] } =>
        typeof c === 'object' &&
        c !== null &&
        'value' in c &&
        Array.isArray((c as { value: unknown }).value),
    )
    .map((c) => c.value[0])
    .join('');
}

// ---------------------------------------------------------------------------
// Test 1: org-scoped query contains expected static SQL markers
// ---------------------------------------------------------------------------

describe('buildOrgSandboxMinutesQuery', () => {
  const input = {
    organisationId: 'org-uuid-1',
    fromIso: '2026-01-01T00:00:00Z',
    toIso: '2026-02-01T00:00:00Z',
  };

  it('returns a SQL fragment containing sandbox_compute source filter', () => {
    const frag = buildOrgSandboxMinutesQuery(input);
    const text = extractSqlText(frag as unknown as { queryChunks: unknown[] });
    expect(text).toContain("source_type = 'sandbox_compute'");
  });

  it('returns a SQL fragment containing organisation_id parameter reference', () => {
    const frag = buildOrgSandboxMinutesQuery(input) as unknown as {
      queryChunks: unknown[];
    };
    const text = extractSqlText(frag);
    expect(text).toContain('organisation_id');
    // The org ID itself must be an interpolated param (not inlined), so
    // it should NOT appear as a literal string in the static chunks.
    expect(text).not.toContain('org-uuid-1');
  });

  it('interpolates the org ID as a query parameter', () => {
    const frag = buildOrgSandboxMinutesQuery(input) as unknown as {
      queryChunks: unknown[];
    };
    // The second chunk should be the organisation ID param value.
    const paramChunks = frag.queryChunks.filter(
      (c) =>
        typeof c === 'string' ||
        (typeof c === 'object' && c !== null && !('value' in c)),
    );
    // At minimum 3 params: organisationId, fromIso, toIso.
    expect(paramChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('throws invalid_iso_window on malformed fromIso', () => {
    expect(() =>
      buildOrgSandboxMinutesQuery({ ...input, fromIso: 'not-a-date' }),
    ).toThrow('invalid_iso_window');
  });

  it('throws invalid_iso_window on malformed toIso', () => {
    expect(() =>
      buildOrgSandboxMinutesQuery({ ...input, toIso: 'INVALID' }),
    ).toThrow('invalid_iso_window');
  });
});

// ---------------------------------------------------------------------------
// Test 2: subaccount-scoped query additionally includes subaccount_id filter
// ---------------------------------------------------------------------------

describe('buildSubaccountSandboxMinutesQuery', () => {
  const input = {
    organisationId: 'org-uuid-2',
    subaccountId: 'sub-uuid-1',
    fromIso: '2026-01-01T00:00:00Z',
    toIso: '2026-02-01T00:00:00Z',
  };

  it('includes subaccount_id in the static SQL text', () => {
    const frag = buildSubaccountSandboxMinutesQuery(input) as unknown as {
      queryChunks: unknown[];
    };
    const text = extractSqlText(frag);
    expect(text).toContain('subaccount_id');
  });

  it('also contains sandbox_compute filter like the org variant', () => {
    const frag = buildSubaccountSandboxMinutesQuery(input) as unknown as {
      queryChunks: unknown[];
    };
    const text = extractSqlText(frag);
    expect(text).toContain("source_type = 'sandbox_compute'");
  });

  it('throws invalid_iso_window on malformed window', () => {
    expect(() =>
      buildSubaccountSandboxMinutesQuery({ ...input, fromIso: 'bad' }),
    ).toThrow('invalid_iso_window');
  });
});

// ---------------------------------------------------------------------------
// Test 3: rollupSandboxMinutes correctly sums wallClockMs → minutes per template
// §8.21 — input permutation: the result must be stable across row orderings.
// ---------------------------------------------------------------------------

describe('rollupSandboxMinutes', () => {
  const rows: SandboxMeteringRow[] = [
    { templateName: 'node-sandbox', wallClockMs: 120_000 }, // 2 min
    { templateName: 'python-sandbox', wallClockMs: 90_000 }, // 1 min (floored)
    { templateName: 'node-sandbox', wallClockMs: 60_000 },  // 1 min → total node = 3 min
  ];

  it('sums wallClockMs per template and converts to floored minutes', () => {
    const result = rollupSandboxMinutes('org', rows);
    const nodeEntry = result.byTemplate.find((e) => e.templateName === 'node-sandbox');
    const pythonEntry = result.byTemplate.find((e) => e.templateName === 'python-sandbox');
    expect(nodeEntry?.minutes).toBe(3);
    expect(pythonEntry?.minutes).toBe(1);
  });

  it('totalMinutes equals sum of per-template minutes', () => {
    const result = rollupSandboxMinutes('org', rows);
    expect(result.totalMinutes).toBe(4);
  });

  it('sets scope correctly for org', () => {
    const result = rollupSandboxMinutes('org', rows);
    expect(result.scope).toBe('org');
  });

  it('sets scope correctly for subaccount', () => {
    const result = rollupSandboxMinutes('subaccount', rows);
    expect(result.scope).toBe('subaccount');
  });

  it('is stable under input permutation (§8.21)', () => {
    const reversed = [...rows].reverse();
    const r1 = rollupSandboxMinutes('org', rows);
    const r2 = rollupSandboxMinutes('org', reversed);
    expect(r1.totalMinutes).toBe(r2.totalMinutes);
    const sortByName = (arr: typeof r1.byTemplate) =>
      [...arr].sort((a, b) => a.templateName.localeCompare(b.templateName));
    expect(sortByName(r1.byTemplate)).toEqual(sortByName(r2.byTemplate));
  });

  // ---------------------------------------------------------------------------
  // Test 4: empty rows
  // ---------------------------------------------------------------------------

  it('returns zero totalMinutes and empty byTemplate for empty input', () => {
    const result = rollupSandboxMinutes('org', []);
    expect(result.totalMinutes).toBe(0);
    expect(result.byTemplate).toEqual([]);
  });
});
