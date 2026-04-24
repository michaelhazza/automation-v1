// Phase 6 / W3.5 — Pure precedence-aware memory block retrieval.
// Spec: docs/universal-brief-dev-spec.md §5.3, §6.3.6
// No I/O — deterministic output for given input.

export type RuleDerivedStatus = 'active' | 'paused' | 'deprecated';

export interface MemoryBlockRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  ownerAgentId: string | null;
  content: string;
  isAuthoritative: boolean;
  priority: 'low' | 'medium' | 'high' | null;
  pausedAt: Date | null;
  deprecatedAt: Date | null;
  createdAt: Date;
}

export interface MemoryBlockRetrievalInput {
  organisationId: string;
  subaccountId?: string;
  agentId?: string;
  candidates: MemoryBlockRow[];
}

export function deriveRuleStatus(row: Pick<MemoryBlockRow, 'pausedAt' | 'deprecatedAt'>): RuleDerivedStatus {
  if (row.deprecatedAt) return 'deprecated';
  if (row.pausedAt) return 'paused';
  return 'active';
}

const PRIORITY_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function scopeSpecificity(
  row: MemoryBlockRow,
  context: { subaccountId?: string; agentId?: string },
): number {
  // Higher = more specific
  if (row.ownerAgentId && row.ownerAgentId === context.agentId) return 3;
  if (row.subaccountId && row.subaccountId === context.subaccountId) return 2;
  if (!row.subaccountId && !row.ownerAgentId) return 1; // org-scoped
  return 0; // out-of-scope (should have been filtered by caller's DB query)
}

/**
 * Ranks memory_block candidates by the §5.3 precedence algorithm:
 *   1. Exclude paused (pausedAt IS NOT NULL)
 *   2. Exclude deprecated (deprecatedAt IS NOT NULL)
 *   3. Authoritative tier > non-authoritative
 *   4. Within tier: scope specificity (subaccount > agent > org)
 *   5. Within scope: priority (high > medium > low)
 *   6. Within priority: recency (createdAt DESC)
 */
export function rankByPrecedencePure(input: MemoryBlockRetrievalInput): MemoryBlockRow[] {
  const context = { subaccountId: input.subaccountId, agentId: input.agentId };

  // Defence-in-depth: pure function should not trust the caller to have
  // pre-filtered to the correct org. A mis-wired caller passing mixed-org
  // candidates would otherwise rank cross-org rules into the same list.
  const active = input.candidates.filter(
    (r) => r.organisationId === input.organisationId && !r.pausedAt && !r.deprecatedAt,
  );

  return active.sort((a, b) => {
    // 1. Authoritative wins
    if (a.isAuthoritative !== b.isAuthoritative) {
      return a.isAuthoritative ? -1 : 1;
    }
    // 2. Scope specificity (higher = first)
    const specA = scopeSpecificity(a, context);
    const specB = scopeSpecificity(b, context);
    if (specA !== specB) return specB - specA;

    // 3. Priority
    const prioA = PRIORITY_RANK[a.priority ?? 'medium'] ?? 2;
    const prioB = PRIORITY_RANK[b.priority ?? 'medium'] ?? 2;
    if (prioA !== prioB) return prioB - prioA;

    // 4. Recency (newest first)
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
