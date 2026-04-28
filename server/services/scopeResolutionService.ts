import { ilike, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations, subaccounts } from '../db/schema/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

export interface ScopeCandidate {
  id: string;
  name: string;
  type: 'org' | 'subaccount';
  orgName?: string; // parent org name for subaccounts — shown in disambiguation UI
}

export interface EntitySearchInput {
  hint: string;
  entityType: 'org' | 'subaccount' | null; // null = search both
  userRole: string;
  organisationId: string | null;
}

/**
 * ILIKE search for orgs/subaccounts matching `hint`, scoped to what the user
 * can see. system_admin sees all; others see only their own org and its subaccounts.
 *
 * NOTE: uses ILIKE %hint% for flexibility. At scale, switch to trigram index
 * (pg_trgm) or prefix-only search for index-backed performance.
 */
export async function findEntitiesMatching(input: EntitySearchInput): Promise<ScopeCandidate[]> {
  const { hint, entityType, userRole, organisationId } = input;
  // Escape ILIKE special chars to prevent pattern injection
  const pattern = `%${hint.trim().replace(/[%_\\]/g, '\\$&')}%`;
  const results: ScopeCandidate[] = [];
  const isSystemAdmin = userRole === 'system_admin';

  const searchOrgs = entityType === 'org' || entityType === null;
  const searchSubaccounts = entityType === 'subaccount' || entityType === null;

  if (searchOrgs) {
    const rows = isSystemAdmin
      ? await db
          .select({ id: organisations.id, name: organisations.name })
          .from(organisations)
          .where(ilike(organisations.name, pattern))
          .limit(10)
      : organisationId
      ? await db
          .select({ id: organisations.id, name: organisations.name })
          .from(organisations)
          .where(and(eq(organisations.id, organisationId), ilike(organisations.name, pattern)))
          .limit(1)
      : [];
    results.push(...rows.map((r) => ({ id: r.id, name: r.name, type: 'org' as const })));
  }

  if (searchSubaccounts) {
    // Join organisations to get parent org name for disambiguation display.
    // RLS via getOrgScopedDb restricts non-system-admin to their org's subaccounts.
    const subQuery = isSystemAdmin
      ? db
          .select({ id: subaccounts.id, name: subaccounts.name, orgName: organisations.name })
          .from(subaccounts)
          .innerJoin(organisations, eq(subaccounts.organisationId, organisations.id))
          .where(ilike(subaccounts.name, pattern))
          .limit(10)
      : getOrgScopedDb('scope_resolution')
          .select({ id: subaccounts.id, name: subaccounts.name, orgName: organisations.name })
          .from(subaccounts)
          .innerJoin(organisations, eq(subaccounts.organisationId, organisations.id))
          .where(ilike(subaccounts.name, pattern))
          .limit(10);
    const rows = await subQuery;
    results.push(...rows.map((r) => ({ id: r.id, name: r.name, type: 'subaccount' as const, orgName: r.orgName })));
  }

  return rankCandidates(deduplicateCandidates(results), hint);
}

// ── Pure helpers (exported for tests) ──────────────────────────────────────

// Single source of truth for candidate scoring — used by both rankCandidates and the route's
// auto-resolve logic. Exporting prevents the two from drifting independently.
export function scoreCandidate(c: ScopeCandidate, hint: string): number {
  const h = hint.toLowerCase();
  const n = c.name.toLowerCase();
  if (n === h) return 3;
  if (n.startsWith(h)) return 2;
  if (n.includes(h)) return 1;
  return 0;
}

export function rankCandidates(candidates: ScopeCandidate[], hint: string): ScopeCandidate[] {
  // Org wins over subaccount on equal score — matches user expectation for ambiguous input
  const typeWeight = (c: ScopeCandidate) => (c.type === 'org' ? 1 : 0);
  return [...candidates].sort(
    (a, b) =>
      scoreCandidate(b, hint) - scoreCandidate(a, hint) ||
      typeWeight(b) - typeWeight(a) ||
      a.name.localeCompare(b.name),
  );
}

export function deduplicateCandidates(candidates: ScopeCandidate[]): ScopeCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function disambiguationQuestion(candidates: ScopeCandidate[]): string {
  const hasOrg = candidates.some((c) => c.type === 'org');
  const hasSub = candidates.some((c) => c.type === 'subaccount');
  if (hasOrg && hasSub) return 'Which organisation or subaccount did you mean?';
  if (hasOrg) return 'Which organisation did you mean?';
  return 'Which subaccount did you mean?';
}
