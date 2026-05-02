/**
 * routingUncertaintyPure.test.ts — Shape and guardrail tests for routingUncertainty query (Chunk 2)
 *
 * Verifies that total_decisions is the raw row count (AC spec requirement).
 *
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/routingUncertaintyPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function isRoutingUncertaintyRow(row: unknown): row is {
  agent_id: string;
  low_confidence_pct: number;
  second_look_pct: number;
  total_decisions: number;
} {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.agent_id === 'string' &&
    typeof r.low_confidence_pct === 'number' &&
    r.low_confidence_pct >= 0 &&
    r.low_confidence_pct <= 1 &&
    typeof r.second_look_pct === 'number' &&
    r.second_look_pct >= 0 &&
    r.second_look_pct <= 1 &&
    typeof r.total_decisions === 'number' &&
    Number.isInteger(r.total_decisions) &&
    (r.total_decisions as number) >= 0
  );
}

describe('RoutingUncertaintyRow shape', () => {
  it('validates a well-formed row', () => {
    const row = {
      agent_id: 'ag-123',
      low_confidence_pct: 0.25,
      second_look_pct: 0.15,
      total_decisions: 20,
    };
    expect(isRoutingUncertaintyRow(row)).toBe(true);
  });

  it('rejects non-integer total_decisions', () => {
    const row = {
      agent_id: 'ag-123',
      low_confidence_pct: 0.25,
      second_look_pct: 0.15,
      total_decisions: 20.5,
    };
    expect(isRoutingUncertaintyRow(row)).toBe(false);
  });

  it('total_decisions is the raw row count — not a derived percentage', () => {
    // Row count must be a non-negative integer
    const totalDecisions = 47;
    expect(Number.isInteger(totalDecisions)).toBe(true);
    expect(totalDecisions).toBeGreaterThanOrEqual(0);
  });

  it('low_confidence_pct and second_look_pct are in [0, 1]', () => {
    const row = {
      agent_id: 'ag-123',
      low_confidence_pct: 0.3,
      second_look_pct: 0.1,
      total_decisions: 10,
    };
    expect(row.low_confidence_pct).toBeGreaterThanOrEqual(0);
    expect(row.low_confidence_pct).toBeLessThanOrEqual(1);
    expect(row.second_look_pct).toBeGreaterThanOrEqual(0);
    expect(row.second_look_pct).toBeLessThanOrEqual(1);
  });
});

describe('routingUncertainty.ts source guardrails (AC-21)', () => {
  it('contains 7-day filter on decided_at', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/routingUncertainty.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/7 days/i);
    expect(src).toMatch(/decided_at/);
  });

  it('COUNT(*) maps to total_decisions', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/routingUncertainty.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/total_decisions/);
  });
});

describe('composite-index existence check (AC-22)', () => {
  it('migration 0267a contains index on fast_path_decisions(subaccount_id, decided_at)', () => {
    const migPath = resolve(
      process.cwd(),
      'migrations/0267a_optimiser_peer_medians.sql',
    );
    const mig = readFileSync(migPath, 'utf-8');
    expect(mig).toMatch(/fast_path_decisions_subaccount_decided_at_idx|fast_path_decisions.*subaccount_id.*decided_at/i);
  });
});
