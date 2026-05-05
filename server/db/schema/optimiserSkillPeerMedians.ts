// BYPASSES RLS — cross-tenant aggregate; admin_role only via REVOKE/GRANT.
// See migrations/0277_optimiser_peer_medians.sql for rationale.
import { pgMaterializedView, numeric, text, integer, timestamp, bigint } from 'drizzle-orm/pg-core';

// Declare the view columns so TypeScript callers get full type inference.
// The view is created and managed by migration 0268; Drizzle does not own its DDL.
export const optimiserSkillPeerMedians = pgMaterializedView('optimiser_skill_peer_medians', {
  skillSlug: text('skill_slug'),
  p50Ms: numeric('p50_ms'),
  p95Ms: numeric('p95_ms'),
  p99Ms: numeric('p99_ms'),
  nTenants: bigint('n_tenants', { mode: 'number' }),
  medianVersion: integer('median_version'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
}).existing();

export type OptimiserSkillPeerMedian = typeof optimiserSkillPeerMedians.$inferSelect;
