/**
 * clientPulseInterventionProposerPure — scenario-detector matcher.
 *
 * Given the output of `compute_churn_risk` for a subaccount plus the org's
 * intervention-template catalogue + cooldown + quota state, returns the
 * proposals that should be emitted as `actions` rows (review-gated).
 *
 * Pure: no DB, no env. All inputs are injected.
 *
 * Enforcement order (per plan §10.B.6):
 *   1. Account override (suppressAlerts blocks all)
 *   2. Template band targeting filter
 *   3. Template-level cooldown (callers inject cooldownState)
 *   4. Template priority sort (higher first)
 *   5. Per-subaccount daily quota slice
 *   6. Per-org daily quota slice
 *
 * Anything filtered emits a `suppressed: { templateSlug, reason }` entry
 * alongside `proposals` for observability.
 */

import type { InterventionType } from './orgConfigService.js';

export type ChurnBand = 'healthy' | 'watch' | 'atRisk' | 'critical';

export interface ProposerSnapshot {
  healthScore: number;
  band: ChurnBand;
  configVersion: string | null;
}

export interface ProposerCooldownState {
  /** templateSlug -> { allowed, reason } from interventionService.checkCooldown(). */
  perTemplate: Record<string, { allowed: boolean; reason?: string }>;
}

export interface ProposerQuotaState {
  dayCountPerSubaccount: number;
  dayCountPerOrg: number;
  maxPerSubaccount: number;
  maxPerOrg: number;
}

export interface ProposerAccountOverride {
  suppressAlerts: boolean;
}

export interface ProposerInputs {
  templates: InterventionType[];
  snapshot: ProposerSnapshot;
  cooldownState: ProposerCooldownState;
  quotaState: ProposerQuotaState;
  accountOverride?: ProposerAccountOverride;
}

export interface Proposal {
  templateSlug: string;
  actionType: string;
  payload: Record<string, unknown>;
  reason: string;
  priority: number;
}

export interface Suppressed {
  templateSlug: string;
  reason: string;
  priority?: number;
}

export interface ProposerResult {
  proposals: Proposal[];
  suppressed: Suppressed[];
}

export function proposeClientPulseInterventionsPure(
  inputs: ProposerInputs,
): ProposerResult {
  const proposals: Proposal[] = [];
  const suppressed: Suppressed[] = [];

  // 1. Account override blocks everything.
  if (inputs.accountOverride?.suppressAlerts) {
    for (const template of inputs.templates) {
      suppressed.push({
        templateSlug: template.slug,
        reason: 'account_override:suppress_alerts',
        priority: template.priority ?? 0,
      });
    }
    return { proposals, suppressed };
  }

  // 2 + 3. Filter by band targeting + cooldown; collect eligible templates.
  const eligible: InterventionType[] = [];
  for (const template of inputs.templates) {
    const targets = template.targets;
    if (targets && targets.length > 0 && !targets.includes(inputs.snapshot.band)) {
      suppressed.push({
        templateSlug: template.slug,
        reason: `band_mismatch:${inputs.snapshot.band}`,
        priority: template.priority ?? 0,
      });
      continue;
    }
    const cooldown = inputs.cooldownState.perTemplate[template.slug];
    if (cooldown && !cooldown.allowed) {
      suppressed.push({
        templateSlug: template.slug,
        reason: cooldown.reason ?? 'cooldown:blocked',
        priority: template.priority ?? 0,
      });
      continue;
    }
    if (!template.actionType) {
      suppressed.push({
        templateSlug: template.slug,
        reason: 'template_missing_action_type',
        priority: template.priority ?? 0,
      });
      continue;
    }
    eligible.push(template);
  }

  // 4. Sort by priority (higher first), then by slug for deterministic tie-break.
  eligible.sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.slug.localeCompare(b.slug);
  });

  // 5 + 6. Apply quota slicing.
  let subaccountSlotsLeft = Math.max(
    0,
    inputs.quotaState.maxPerSubaccount - inputs.quotaState.dayCountPerSubaccount,
  );
  let orgSlotsLeft = Math.max(
    0,
    inputs.quotaState.maxPerOrg - inputs.quotaState.dayCountPerOrg,
  );

  for (const template of eligible) {
    if (subaccountSlotsLeft <= 0) {
      suppressed.push({
        templateSlug: template.slug,
        reason: 'quota_exceeded:subaccount_day',
        priority: template.priority ?? 0,
      });
      continue;
    }
    if (orgSlotsLeft <= 0) {
      suppressed.push({
        templateSlug: template.slug,
        reason: 'quota_exceeded:org_day',
        priority: template.priority ?? 0,
      });
      continue;
    }

    proposals.push({
      templateSlug: template.slug,
      actionType: template.actionType!,
      payload: template.payloadDefaults ?? {},
      reason: template.defaultReason ?? `scenario_detector:band=${inputs.snapshot.band}`,
      priority: template.priority ?? 0,
    });

    subaccountSlotsLeft -= 1;
    orgSlotsLeft -= 1;
  }

  return { proposals, suppressed };
}
