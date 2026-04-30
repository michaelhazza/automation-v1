import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { SYSTEM_AGENT_BY_SLUG } from '../config/c.js';

// ---------------------------------------------------------------------------
// System Agent Registry Validator — soft drift detection
// ---------------------------------------------------------------------------
// Compares the compile-time SYSTEM_AGENT_BY_SLUG registry (server/config/c.ts)
// against the active rows in system_agents. Logs a warning on drift but does
// NOT throw — boot must remain non-blocking until Phase B promotes this to a
// hard fail-fast invariant.
//
// Two failure modes:
//   - codeOnly: registry references a slug that has no active DB row →
//     UI/skill bindings will fail to resolve at runtime.
//   - dbOnly:   DB has an active slug not present in the registry →
//     compile-time references won't include the row; manifests drift.
//
// Boot wiring: server/index.ts calls this after the DB is reachable, in the
// same block as validateSystemSkillHandlers. Failures here are surfaced via
// console.warn only.
// ---------------------------------------------------------------------------

export interface RegistryDrift {
  codeOnly: string[];
  dbOnly: string[];
}

export function diffRegistry(dbSlugs: string[], codeSlugs: string[]): RegistryDrift {
  const dbSet = new Set(dbSlugs);
  const codeSet = new Set(codeSlugs);
  return {
    codeOnly: codeSlugs.filter((s) => !dbSet.has(s)).sort(),
    dbOnly: dbSlugs.filter((s) => !codeSet.has(s)).sort(),
  };
}

export async function validateSystemAgentRegistry(): Promise<void> {
  const rows = await db.execute<{ slug: string }>(sql`
    SELECT slug
    FROM   system_agents
    WHERE  deleted_at IS NULL
      AND  status     = 'active'
  `);
  const dbSlugs = rows.rows.map((r) => r.slug);
  const codeSlugs = Array.from(SYSTEM_AGENT_BY_SLUG.keys());

  const drift = diffRegistry(dbSlugs, codeSlugs);
  if (drift.codeOnly.length === 0 && drift.dbOnly.length === 0) return;

  // Warn-only — see header. Phase B promotes this to throw.
  console.warn(
    '[boot] system-agent registry drift detected:',
    JSON.stringify(drift),
  );
}
