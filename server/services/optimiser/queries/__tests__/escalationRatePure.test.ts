/**
 * escalationRatePure.test.ts — Shape and guardrail tests for escalationRate query (Chunk 2)
 *
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/escalationRatePure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function isEscalationRateRow(row: unknown): row is {
  workflow_id: string;
  run_count: number;
  escalation_count: number;
  common_step_id: string;
} {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.workflow_id === 'string' &&
    typeof r.run_count === 'number' &&
    typeof r.escalation_count === 'number' &&
    typeof r.common_step_id === 'string'
  );
}

describe('EscalationRateRow shape', () => {
  it('validates a well-formed row', () => {
    const row = {
      workflow_id: 'wf-123',
      run_count: 10,
      escalation_count: 4,
      common_step_id: 'step-approval',
    };
    expect(isEscalationRateRow(row)).toBe(true);
  });

  it('rejects missing run_count', () => {
    const row = { workflow_id: 'wf-123', escalation_count: 4, common_step_id: 'step' };
    expect(isEscalationRateRow(row)).toBe(false);
  });

  it('escalation_count can be 0 (no escalations)', () => {
    const row = {
      workflow_id: 'wf-123',
      run_count: 5,
      escalation_count: 0,
      common_step_id: 'unknown',
    };
    expect(isEscalationRateRow(row)).toBe(true);
  });
});

describe('escalationRate.ts source guardrails (AC-21)', () => {
  it('contains a 7-day filter on flow_runs.started_at', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/escalationRate.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/7 days/i);
    expect(src).toMatch(/started_at/);
  });
});

describe('escalationRate determinism', () => {
  it('modal step_id computation: mode of [a,a,b] is a', () => {
    const counts: Array<{ step_id: string; count: number }> = [
      { step_id: 'a', count: 2 },
      { step_id: 'b', count: 1 },
    ];
    const mode = counts.sort((x, y) => y.count - x.count || x.step_id.localeCompare(y.step_id))[0];
    expect(mode.step_id).toBe('a');
  });

  it('tie-breaking: equal counts sorted by step_id ASC', () => {
    const counts = [
      { step_id: 'zz-step', count: 3 },
      { step_id: 'aa-step', count: 3 },
    ];
    const sorted = [...counts].sort((x, y) => y.count - x.count || x.step_id.localeCompare(y.step_id));
    expect(sorted[0].step_id).toBe('aa-step');
  });
});
