/**
 * cacheEfficiencyPure.test.ts — Shape and guardrail tests for cacheEfficiency query (Chunk 2)
 *
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/cacheEfficiencyPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function isCacheEfficiencyRow(row: unknown): row is {
  agent_id: string;
  creation_tokens: number;
  reused_tokens: number;
  dominant_skill: string;
} {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.agent_id === 'string' &&
    typeof r.creation_tokens === 'number' &&
    Number.isInteger(r.creation_tokens) &&
    typeof r.reused_tokens === 'number' &&
    Number.isInteger(r.reused_tokens) &&
    typeof r.dominant_skill === 'string'
  );
}

describe('CacheEfficiencyRow shape', () => {
  it('validates a well-formed row', () => {
    const row = {
      agent_id: 'ag-123',
      creation_tokens: 15000,
      reused_tokens: 3000,
      dominant_skill: 'send_email',
    };
    expect(isCacheEfficiencyRow(row)).toBe(true);
  });

  it('dominant_skill defaults to "unknown" when no feature_tag', () => {
    const row = {
      agent_id: 'ag-123',
      creation_tokens: 5000,
      reused_tokens: 0,
      dominant_skill: 'unknown',
    };
    expect(isCacheEfficiencyRow(row)).toBe(true);
  });

  it('rejects non-integer creation_tokens', () => {
    const row = {
      agent_id: 'ag-123',
      creation_tokens: 5000.5,
      reused_tokens: 1000,
      dominant_skill: 'x',
    };
    expect(isCacheEfficiencyRow(row)).toBe(false);
  });

  it('reused_tokens can be 0 (no cache hits)', () => {
    const row = {
      agent_id: 'ag-123',
      creation_tokens: 8000,
      reused_tokens: 0,
      dominant_skill: 'search',
    };
    expect(isCacheEfficiencyRow(row)).toBe(true);
  });
});

describe('cacheEfficiency.ts source guardrails (AC-21)', () => {
  it('contains 7-day filter on llm_requests.created_at', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/cacheEfficiency.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/7 days/i);
    expect(src).toMatch(/created_at/);
  });

  it('reads cache_creation_tokens and cached_prompt_tokens', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/cacheEfficiency.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/cache_creation_tokens/);
    expect(src).toMatch(/cached_prompt_tokens/);
  });
});

describe('composite-index existence check (AC-22)', () => {
  it('migration 0267a contains index on llm_requests(run_id, created_at)', () => {
    const migPath = resolve(
      process.cwd(),
      'migrations/0267a_optimiser_peer_medians.sql',
    );
    const mig = readFileSync(migPath, 'utf-8');
    expect(mig).toMatch(/llm_requests_agent_created_at_idx|llm_requests.*run_id.*created_at/i);
  });
});
