// ---------------------------------------------------------------------------
// hierarchyRouteResolverServicePure.ts
//
// Pure decision logic for resolving the root subaccount-agent for a given
// brief scope. Called by hierarchyRouteResolverService (impure wrapper) after
// DB queries have been resolved.
//
// Spec §6.6 — root-resolution decision tree.
// ---------------------------------------------------------------------------

export interface SubaccountRootRow {
  subaccountAgentId: string;
  agentId: string;
  subaccountId: string;
  createdAt: Date;
}

export interface OrgLevelLink {
  subaccountAgentId: string;
  agentId: string;
  subaccountId: string;
}

export interface ResolveRootResult {
  subaccountAgentId: string;
  agentId: string;
  /** The subaccount the resolved agent link belongs to. */
  subaccountId: string;
  /**
   * Routing semantics of the result:
   *   'none'     — direct match for the requested scope (no fallback).
   *   'expected' — fell back to the org-level link because the caller did
   *                not scope a subaccount (`subaccountId: null`). This is
   *                intentional caller-side behaviour, not misconfiguration.
   *   'degraded' — fell back to the org-level link because the requested
   *                subaccount exists but has zero active root agents. This
   *                is a misconfiguration signal; the `subaccountNoRoot`
   *                workspace-health detector should already be firing.
   *
   * Callers should treat `'expected'` as informational and `'degraded'` as
   * actionable (log + metric), even though both route identically.
   */
  fallback: 'none' | 'expected' | 'degraded';
}

/**
 * Spec §6.6 decision tree — pure.
 *
 * | scope       | subaccountId | subaccountRoots | orgLevelLink | result                         |
 * |-------------|--------------|-----------------|--------------|-------------------------------|
 * | system      | any          | any             | any          | null                           |
 * | org         | any          | any             | present      | orgLevelLink, fallback:'none'   |
 * | org         | any          | any             | null         | null                           |
 * | subaccount  | null         | any             | present      | orgLevelLink, fallback:'expected' |
 * | subaccount  | null         | any             | null         | null                           |
 * | subaccount  | present      | 1 row           | any          | that row, fallback:'none'       |
 * | subaccount  | present      | 0 rows          | present      | orgLevelLink, fallback:'degraded' |
 * | subaccount  | present      | 0 rows          | null         | null                           |
 * | subaccount  | present      | N rows (>1)     | any          | oldest by createdAt, fallback:'none' |
 */
export function resolveRootForScopePure(input: {
  scope: 'subaccount' | 'org' | 'system';
  subaccountId: string | null;
  subaccountRoots: SubaccountRootRow[];
  orgLevelLink: OrgLevelLink | null;
}): ResolveRootResult | null {
  const { scope, subaccountId, subaccountRoots, orgLevelLink } = input;

  // ── System scope ────────────────────────────────────────────────────────
  if (scope === 'system') {
    return null;
  }

  // ── Org scope ───────────────────────────────────────────────────────────
  if (scope === 'org') {
    if (!orgLevelLink) return null;
    return { subaccountAgentId: orgLevelLink.subaccountAgentId, agentId: orgLevelLink.agentId, subaccountId: orgLevelLink.subaccountId, fallback: 'none' };
  }

  // ── Subaccount scope ────────────────────────────────────────────────────
  // subaccountId null — caller didn't scope a subaccount; org-level is the expected fallback
  if (subaccountId === null) {
    if (!orgLevelLink) return null;
    return { subaccountAgentId: orgLevelLink.subaccountAgentId, agentId: orgLevelLink.agentId, subaccountId: orgLevelLink.subaccountId, fallback: 'expected' };
  }

  // subaccountId present — evaluate the roster
  if (subaccountRoots.length === 0) {
    // Subaccount exists but has no root — degraded, not expected.
    if (!orgLevelLink) return null;
    return { subaccountAgentId: orgLevelLink.subaccountAgentId, agentId: orgLevelLink.agentId, subaccountId: orgLevelLink.subaccountId, fallback: 'degraded' };
  }

  if (subaccountRoots.length === 1) {
    const root = subaccountRoots[0]!;
    return { subaccountAgentId: root.subaccountAgentId, agentId: root.agentId, subaccountId: root.subaccountId, fallback: 'none' };
  }

  // Multiple roots — defensive: post-migration invariant enforces exactly one,
  // but if somehow multiple are present pick the oldest for deterministic routing.
  const oldest = subaccountRoots.slice().sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0]!;
  return { subaccountAgentId: oldest.subaccountAgentId, agentId: oldest.agentId, subaccountId: oldest.subaccountId, fallback: 'none' };
}
