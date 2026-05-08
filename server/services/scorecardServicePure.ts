// server/services/scorecardServicePure.ts
// Pure helpers for scorecard visibility, source-pill labelling, authority
// resolution, regression risk classification, and bench composite selection.
// Trust & Verification Layer spec §6.4, §6.6, §6.8, §12.1.
//
// All exports are pure: no DB, no network, no filesystem.

import type { Scorecard } from '../db/schema/scorecards.js';

// ── compressSourcePill ────────────────────────────────────────────────────────

/**
 * Maps a scorecard's scope + viewer scope to a compact source-pill label.
 *
 * Spec §6.8 mapping:
 *   system  × org_admin   → 'system'
 *   system  × subaccount  → 'platform'
 *   org     × org_admin   → 'organisation'
 *   org     × subaccount  → 'custom'
 *   sub     × *           → 'this_subaccount'
 */
export function compressSourcePill(
  scope: 'system' | 'org' | 'subaccount',
  viewerScope: 'org_admin' | 'subaccount',
): 'system' | 'organisation' | 'this_subaccount' | 'platform' | 'custom' {
  if (scope === 'subaccount') return 'this_subaccount';
  if (scope === 'system') return viewerScope === 'org_admin' ? 'system' : 'platform';
  // scope === 'org'
  return viewerScope === 'org_admin' ? 'organisation' : 'custom';
}

// ── resolveAttachAuthority ────────────────────────────────────────────────────

/**
 * Resolves the authority level for attaching a scorecard to an agent.
 * Priority cascade per spec §6.4:
 *   1. system_mandatory — scorecard is in system agent's default_system_scorecard_slugs
 *   2. org_mandatory    — scorecard slug is in org's mandatory list
 *   3. suggested        — all other cases (template default or operator-checked)
 */
export function resolveAttachAuthority(args: {
  scorecardSlug: string;
  systemAgentDefaults: { default_system_scorecard_slugs: string[]; default_org_scorecard_slugs: string[] } | null;
  orgMandatorySlugs: string[];
  agentTemplateDefaults: string[] | null;
  operatorChecked: boolean;
}): 'system_mandatory' | 'org_mandatory' | 'suggested' {
  const { scorecardSlug, systemAgentDefaults, orgMandatorySlugs } = args;

  if (systemAgentDefaults?.default_system_scorecard_slugs.includes(scorecardSlug)) {
    return 'system_mandatory';
  }

  if (orgMandatorySlugs.includes(scorecardSlug)) {
    return 'org_mandatory';
  }

  return 'suggested';
}

// ── computeRegressionRisk ─────────────────────────────────────────────────────

/**
 * Classifies regression risk from variance and sample count.
 * Spec §6.6 thresholds:
 *   low    — variance < 0.05 AND sampleCount >= 5
 *   medium — 0.05 <= variance < 0.15  OR  (variance < 0.05 AND sampleCount < 5)
 *   high   — variance >= 0.15  OR  invalid input (fail-closed)
 */
export function computeRegressionRisk(
  variance: number,
  sampleCount: number,
): 'low' | 'medium' | 'high' {
  if (!Number.isFinite(variance) || !Number.isFinite(sampleCount) || variance < 0 || sampleCount < 0) {
    return 'high';
  }

  if (variance >= 0.15) return 'high';

  if (variance < 0.05) {
    return sampleCount >= 5 ? 'low' : 'medium';
  }

  // 0.05 <= variance < 0.15
  return 'medium';
}

// ── computeBenchComposite ─────────────────────────────────────────────────────

/**
 * Selects the recommended model from bench results.
 * Criteria: qualifies if passesAllPassMarks=true AND regressionRisk !== 'high'.
 * Winner: cheapest qualifying candidate by totalCostCents.
 * Returns null recommendedModelId when no candidate qualifies.
 */
export function computeBenchComposite(
  results: Array<{
    candidateModelId: string;
    passesAllPassMarks: boolean;
    regressionRisk: 'low' | 'medium' | 'high';
    totalCostCents: number;
  }>,
): { recommendedModelId: string | null; reason: string } {
  const qualifying = results.filter(
    (r) => r.passesAllPassMarks && r.regressionRisk !== 'high',
  );

  if (qualifying.length === 0) {
    return {
      recommendedModelId: null,
      reason: 'No candidate meets all pass marks with acceptable regression risk.',
    };
  }

  const winner = qualifying.reduce((best, r) =>
    r.totalCostCents < best.totalCostCents ? r : best,
  );

  return {
    recommendedModelId: winner.candidateModelId,
    reason: `Selected as cheapest qualifying candidate at ${winner.totalCostCents} cost-cents with ${winner.regressionRisk} regression risk.`,
  };
}

// ── applyVisibilityRules ──────────────────────────────────────────────────────

/**
 * Filters scorecards based on viewer scope per spec §12.1.
 *
 * system_admin: all rows (no filter).
 * org_admin:    system rows + org's own rows + any subaccount rows within the org.
 * subaccount:   system rows with share_with_subaccounts=true
 *               + org rows with share_with_subaccounts=true
 *               + subaccount's own rows (scopeId === viewerSubaccountId).
 */
export function applyVisibilityRules(args: {
  scorecards: Scorecard[];
  viewerScope: 'system_admin' | 'org_admin' | 'subaccount';
  viewerOrgId: string | null;
  viewerSubaccountId: string | null;
}): Scorecard[] {
  const { scorecards, viewerScope, viewerOrgId, viewerSubaccountId } = args;

  if (viewerScope === 'system_admin') {
    return scorecards;
  }

  return scorecards.filter((sc) => {
    if (sc.deletedAt !== null) return false;

    if (sc.scopeType === 'system') {
      if (viewerScope === 'org_admin') return true;
      // subaccount: only shared ones
      return sc.shareWithSubaccounts;
    }

    if (sc.scopeType === 'org') {
      // Must belong to the viewer's org
      if (sc.organisationId !== viewerOrgId) return false;
      if (viewerScope === 'org_admin') return true;
      // subaccount: only shared ones
      return sc.shareWithSubaccounts;
    }

    if (sc.scopeType === 'subaccount') {
      // org_admin sees all subaccount scorecards within the org
      if (viewerScope === 'org_admin') {
        return sc.organisationId === viewerOrgId;
      }
      // subaccount sees only its own
      return sc.scopeId === viewerSubaccountId;
    }

    return false;
  });
}
