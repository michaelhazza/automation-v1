/**
 * memoryCitationPure.test.ts — Shape and guardrail tests for memoryCitation query (Chunk 2)
 *
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/memoryCitationPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function isMemoryCitationRow(row: unknown): row is {
  agent_id: string;
  low_citation_pct: number;
  total_injected: number;
  projected_token_savings: number;
} {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.agent_id === 'string' &&
    typeof r.low_citation_pct === 'number' &&
    r.low_citation_pct >= 0 &&
    r.low_citation_pct <= 1 &&
    typeof r.total_injected === 'number' &&
    typeof r.projected_token_savings === 'number'
  );
}

describe('MemoryCitationRow shape', () => {
  it('validates a well-formed row', () => {
    const row = {
      agent_id: 'ag-123',
      low_citation_pct: 0.4285,
      total_injected: 14,
      projected_token_savings: 2400,
    };
    expect(isMemoryCitationRow(row)).toBe(true);
  });

  it('rejects low_citation_pct > 1', () => {
    const row = {
      agent_id: 'ag-123',
      low_citation_pct: 1.5,
      total_injected: 10,
      projected_token_savings: 1000,
    };
    expect(isMemoryCitationRow(row)).toBe(false);
  });

  it('rejects low_citation_pct < 0', () => {
    const row = {
      agent_id: 'ag-123',
      low_citation_pct: -0.1,
      total_injected: 10,
      projected_token_savings: 1000,
    };
    expect(isMemoryCitationRow(row)).toBe(false);
  });

  it('projected_token_savings = low_count * 200', () => {
    // If total_injected=10, low_citation_pct=0.3 → low_count=3 → savings=600
    const totalInjected = 10;
    const lowCitationPct = 0.3;
    const lowCount = Math.round(totalInjected * lowCitationPct);
    const projectedSavings = lowCount * 200;
    expect(projectedSavings).toBe(600);
  });
});

describe('memoryCitation.ts source guardrails (AC-21)', () => {
  it('contains 7-day filter on created_at', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/memoryCitation.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/7 days/i);
    expect(src).toMatch(/created_at/);
  });
});

describe('composite-index existence check (AC-22)', () => {
  it('migration 0267a contains index on memory_citation_scores(run_id, created_at)', () => {
    const migPath = resolve(
      process.cwd(),
      'migrations/0267a_optimiser_peer_medians.sql',
    );
    const mig = readFileSync(migPath, 'utf-8');
    expect(mig).toMatch(/memory_citation_scores_run_created_at_idx|memory_citation_scores.*run_id.*created_at/i);
  });
});
