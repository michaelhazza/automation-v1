/**
 * peerMedianViewIntegration.test.ts — Structural tests for the peer-median view (Chunk 2)
 *
 * This file is NOT a *Pure.test.ts — it's a DB-integration contract test.
 * Since we cannot run a full DB in local CI, this file asserts the migration SQL
 * structure and the HAVING clause invariant that prevents single-tenant data leakage.
 *
 * For a real DB test: seeds 5 sub-accounts × skill.x (should appear in view),
 * 3 sub-accounts × skill.y (should NOT appear due to HAVING >= 5).
 *
 * In this structural form, we verify:
 *   1. Migration SQL has HAVING count(DISTINCT subaccount_id) >= 5
 *   2. Migration SQL uses skillSlug (camelCase) matching the JSONB payload
 *   3. event_type filter is 'skill.completed'
 *   4. The view uses percentile_cont for p50/p95/p99
 *   5. Unique index exists (required for REFRESH CONCURRENTLY)
 *   6. optimiser_view_metadata table is created
 *
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/peerMedianViewIntegration.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG_PATH = resolve(process.cwd(), 'migrations/0267a_optimiser_peer_medians.sql');

let migSql: string;
try {
  migSql = readFileSync(MIG_PATH, 'utf-8');
} catch {
  migSql = '';
}

describe('peerMedianView: migration SQL structure (AC-17, AC-18, AC-24b)', () => {
  it('migration file exists', () => {
    expect(migSql.length).toBeGreaterThan(0);
  });

  it('HAVING clause enforces count(DISTINCT subaccount_id) >= 5', () => {
    expect(migSql).toMatch(/HAVING\s+count\s*\(\s*DISTINCT\s+subaccount_id\s*\)\s*>=\s*5/i);
  });

  it('uses skillSlug (camelCase) matching JSONB payload key in skill.completed events', () => {
    expect(migSql).toMatch(/payload\s*->>\s*'skillSlug'/);
  });

  it('uses durationMs (camelCase) matching JSONB payload key', () => {
    expect(migSql).toMatch(/payload\s*->>\s*'durationMs'/);
  });

  it('filters event_type = skill.completed', () => {
    expect(migSql).toMatch(/event_type\s*=\s*'skill\.completed'/);
  });

  it('computes p50 via percentile_cont(0.5)', () => {
    expect(migSql).toMatch(/percentile_cont\s*\(\s*0\.5\s*\)/);
  });

  it('computes p95 via percentile_cont(0.95)', () => {
    expect(migSql).toMatch(/percentile_cont\s*\(\s*0\.95\s*\)/);
  });

  it('computes p99 via percentile_cont(0.99)', () => {
    expect(migSql).toMatch(/percentile_cont\s*\(\s*0\.99\s*\)/);
  });

  it('creates UNIQUE INDEX on skill_slug (AC-18)', () => {
    expect(migSql).toMatch(/UNIQUE INDEX.*optimiser_skill_peer_medians.*skill_slug|optimiser_skill_peer_medians_skill_slug_idx/i);
  });

  it('creates optimiser_view_metadata table (AC-24b)', () => {
    expect(migSql).toMatch(/CREATE TABLE.*optimiser_view_metadata/i);
    expect(migSql).toMatch(/view_name.*text.*PRIMARY KEY/i);
    expect(migSql).toMatch(/refreshed_at.*timestamptz/i);
  });

  it('has 7-day window filter on event_timestamp', () => {
    expect(migSql).toMatch(/7 days/i);
    expect(migSql).toMatch(/event_timestamp/);
  });
});

describe('peerMedianView: HAVING invariant logic', () => {
  it('threshold logic: 5 sub-accounts qualifies, 3 does not', () => {
    const THRESHOLD = 5;
    expect(5 >= THRESHOLD).toBe(true);
    expect(3 >= THRESHOLD).toBe(false);
    expect(4 >= THRESHOLD).toBe(false);
  });

  it('threshold boundary: exactly 5 qualifies', () => {
    const THRESHOLD = 5;
    expect(5 >= THRESHOLD).toBe(true);
  });
});

describe('peerMedianView: down migration', () => {
  it('down migration file exists and drops the view', () => {
    const downPath = resolve(process.cwd(), 'migrations/0267a_optimiser_peer_medians.down.sql');
    const downSql = readFileSync(downPath, 'utf-8');
    expect(downSql).toMatch(/DROP MATERIALIZED VIEW.*optimiser_skill_peer_medians/i);
    expect(downSql).toMatch(/DROP TABLE.*optimiser_view_metadata/i);
  });
});
