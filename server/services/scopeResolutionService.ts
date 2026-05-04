import { ilike, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations, subaccounts } from '../db/schema/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { shouldSearchEntityHint } from './scopeResolutionPure.js';
export { shouldSearchEntityHint } from './scopeResolutionPure.js';

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
  if (!shouldSearchEntityHint(hint)) return [];
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

// Org wins over subaccount on equal score — matches user expectation for ambiguous input.
// Exported so auto-resolve can use the same primitive as ranking.
export function typeWeight(c: ScopeCandidate): number {
  return c.type === 'org' ? 1 : 0;
}

export function rankCandidates(candidates: ScopeCandidate[], hint: string): ScopeCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      scoreCandidate(b, hint) - scoreCandidate(a, hint) ||
      typeWeight(b) - typeWeight(a) ||
      a.name.localeCompare(b.name),
  );
}

// True iff the top-ranked candidate decisively beats the second after rankCandidates
// has sorted the list — i.e. strictly higher score, or tied score with a different
// type (ranking already preferred org). Name-only tiebreaks are not decisive — those
// are coin-flips and the caller should fall back to the disambiguation UI rather than
// auto-resolving on lexicographic order. Single-candidate lists are decisive by
// definition; empty lists are not.
export function isTopCandidateDecisive(candidates: ScopeCandidate[], hint: string): boolean {
  if (candidates.length === 0) return false;
  if (candidates.length === 1) return true;
  const top = candidates[0]!;
  const second = candidates[1]!;
  const topScore = scoreCandidate(top, hint);
  const secondScore = scoreCandidate(second, hint);
  if (topScore !== secondScore) return topScore > secondScore;
  return typeWeight(top) !== typeWeight(second);
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

/**
 * Resolve a candidate id submitted from the disambiguation UI back to its
 * organisation/subaccount tuple — with authorisation enforced.
 *
 * Non-admin org candidates: must equal the user's own org. Cross-tenant ids
 * are rejected silently (returns null) to avoid leaking org existence.
 *
 * Non-admin subaccount candidates: looked up via getOrgScopedDb so RLS
 * filters cross-tenant ids to zero rows.
 *
 * Admin candidates: looked up against raw db, matching the cross-tenant
 * convention used by findEntitiesMatching above.
 *
 * Returns null when the candidate is not authorised for this user. Callers
 * map null to a generic 'invalid selection' error.
 */
export async function resolveCandidateScope(input: {
  candidateId: string;
  candidateType: 'org' | 'subaccount';
  userRole: string;
  userOrganisationId: string | null;
}): Promise<{
  resolvedOrgId: string;
  resolvedSubaccountId: string | null;
  // Parent org name — returned for subaccount candidates so the client can
  // update both activeOrgId AND activeOrgName atomically when the user picks
  // a subaccount in another org. Without it the client would skip the org
  // update (guard requires both id + name) and the next request would still
  // send the OLD X-Organisation-Id header alongside the NEW subaccount.
  resolvedOrgName: string | null;
} | null> {
  const { candidateId, candidateType, userRole, userOrganisationId } = input;
  const isSystemAdmin = userRole === 'system_admin';

  if (candidateType === 'org') {
    if (!isSystemAdmin) {
      if (!userOrganisationId || candidateId !== userOrganisationId) return null;
      // Non-admin org candidate is the user's own org; the route already has
      // the active org name available, so returning null here keeps the
      // contract identical to pre-change behaviour for that branch.
      return { resolvedOrgId: candidateId, resolvedSubaccountId: null, resolvedOrgName: null };
    }
    const [org] = await db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, candidateId))
      .limit(1);
    return org
      ? { resolvedOrgId: org.id, resolvedSubaccountId: null, resolvedOrgName: org.name }
      : null;
  }

  const tx = isSystemAdmin ? db : getOrgScopedDb('session.resolve_candidate');
  const [sub] = await tx
    .select({ organisationId: subaccounts.organisationId, orgName: organisations.name })
    .from(subaccounts)
    .innerJoin(organisations, eq(subaccounts.organisationId, organisations.id))
    .where(eq(subaccounts.id, candidateId)) // guard-ignore: org-scoped-writes reason="non-admin path uses getOrgScopedDb which enforces RLS org isolation; system_admin path intentionally queries across orgs to resolve any subaccount"
    .limit(1);
  return sub?.organisationId
    ? {
        resolvedOrgId: sub.organisationId,
        resolvedSubaccountId: candidateId,
        resolvedOrgName: sub.orgName ?? null,
      }
    : null;
}

export function disambiguationQuestion(candidates: ScopeCandidate[]): string {
  const hasOrg = candidates.some((c) => c.type === 'org');
  const hasSub = candidates.some((c) => c.type === 'subaccount');
  if (hasOrg && hasSub) return 'Which organisation or subaccount did you mean?';
  if (hasOrg) return 'Which organisation did you mean?';
  return 'Which subaccount did you mean?';
}
