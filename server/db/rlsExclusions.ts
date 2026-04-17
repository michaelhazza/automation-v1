/**
 * Tables explicitly excluded from RLS enforcement.
 *
 * Every table in the application database should either:
 *   1. Appear in `RLS_PROTECTED_TABLES` (server/config/rlsProtectedTables.ts)
 *      with a matching `CREATE POLICY` in a migration, or
 *   2. Appear here with a documented rationale explaining why RLS is not
 *      applicable (platform-level data, cross-org data, etc.).
 *
 * The CI gate `scripts/gates/verify-rls-coverage.sh` checks that every
 * table is accounted for in one of these two lists.
 */

export interface RlsExclusion {
  tableName: string;
  rationale: string;
}

export const RLS_EXCLUSIONS: ReadonlyArray<RlsExclusion> = [
  { tableName: 'organisations', rationale: 'Platform-level — no tenant column' },
  { tableName: 'users', rationale: 'Cross-org — users can belong to multiple orgs' },
  { tableName: 'system_agents', rationale: 'Platform templates — identical for all orgs' },
  { tableName: 'skill_definitions', rationale: 'System-managed skill catalogue' },
];

export const RLS_EXCLUDED_TABLE_NAMES: ReadonlySet<string> = new Set(
  RLS_EXCLUSIONS.map((t) => t.tableName),
);
