// Policy Engine is one component of the Policy Envelope (policyEnvelopeSnapshot). See docs/synthetos-nomenclature.md

import { eq, and, asc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { policyRules } from '../db/schema/index.js';
import { spendingBudgets } from '../db/schema/spendingBudgets.js';
import { spendingPolicies } from '../db/schema/spendingPolicies.js';
import { subaccountAgents } from '../db/schema/subaccountAgents.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { CONFIDENCE_GATE_THRESHOLD } from '../config/limits.js';
import {
  applyConfidenceUpgrade,
  selectGuidanceTexts,
  evaluateSpendPolicy,
  applySubaccountConstraintsPure,
  type SpendDecision,
} from './policyEngineServicePure.js';
import { deriveGateLevel } from '../../shared/types/riskTier.js';
import type { RiskTier, GateLevel } from '../../shared/types/riskTier.js';
import type { PolicyRule } from '../db/schema/policyRules.js';

// ---------------------------------------------------------------------------
// Policy Engine — first-match, priority-ordered gate level evaluation
//
// Rules are loaded once per org and cached for 60 seconds.
// Evaluation: rules sorted by priority ASC, first match wins.
// Fallback: if no rule matches, falls through to ActionDefinition.defaultGateLevel
//           so existing behaviour is preserved for orgs with no custom rules.
// ---------------------------------------------------------------------------

export interface PolicyContext {
  toolSlug: string;
  subaccountId: string;
  organisationId: string;
  /** Raw tool input — used for condition matching (e.g. amount_usd checks) */
  input?: unknown;
  /**
   * Sprint 3 P2.3 — agent's self-reported tool_intent confidence (0..1).
   * When present and below the effective confidence threshold, an
   * `auto` decision is upgraded to `review`. Missing / null is treated
   * as "below threshold" (fail closed).
   */
  toolIntentConfidence?: number | null;
  /**
   * Chunk 4 (synthetos-foundation-refactor) — subaccount-agent link ID.
   * When present, the policy engine fetches the governance row to apply
   * subaccount-constraint rules (max_risk_tier block, require_approval_at_tier
   * upgrade) per spec §4.2.8.
   */
  subaccountAgentId?: string | null;
}

export interface PolicyDecision {
  decision: 'auto' | 'review' | 'block';
  /** null if no rule matched and registry default was used */
  matchedRule: PolicyRule | null;
  timeoutSeconds?: number;
  timeoutPolicy?: 'auto_reject' | 'auto_approve' | 'escalate';
  interruptConfig?: unknown;
  allowedDecisions?: unknown;
  /** Rendered description_template (for reviewer UI) */
  description?: string;
  /**
   * Sprint 3 P2.3 — true when the decision was upgraded from `auto` to
   * `review` by the confidence gate. Used by downstream audit/metrics
   * to attribute the upgrade correctly.
   */
  upgradedByConfidence?: boolean;
  /**
   * Chunk 7 — spend-policy gate result. Present when the action is
   * registered as `spendsMoney: true`. `evaluated: false` when the action
   * does not spend money or no spending policy is found for the subaccount.
   */
  spendDecision?: SpendDecision;
  /**
   * Chunk 4 (synthetos-foundation-refactor) — risk tier from the action
   * definition. Present when the action is registered in ACTION_REGISTRY
   * with a riskTier field. Used by the tool_security_decision Run Trace
   * event payload (chunk 7) and the approval UX (chunk 10).
   */
  riskTier?: RiskTier;
  /**
   * Chunk 4 — four-source union explaining how the gate level was derived.
   * Precedence (per spec §4.2.8):
   *   subaccount_constraint > policy_override > preserved_existing > tier_default
   */
  gateLevelSource?: 'subaccount_constraint' | 'policy_override' | 'preserved_existing' | 'tier_default';
}

// ---------------------------------------------------------------------------
// In-memory rule cache — per org, 60-second TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  rules: PolicyRule[];
  cachedAt: number;
}

const ruleCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function getRulesForOrg(organisationId: string): Promise<PolicyRule[]> {
  const cached = ruleCache.get(organisationId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.rules;
  }

  const rules = await getOrgScopedDb('policyEngineService.getRulesForOrg')
    .select()
    .from(policyRules)
    .where(
      and(
        eq(policyRules.organisationId, organisationId),
        eq(policyRules.isActive, true),
      ),
    )
    .orderBy(asc(policyRules.priority));

  ruleCache.set(organisationId, { rules, cachedAt: Date.now() });
  return rules;
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/**
 * Pure rule matcher. Exported for unit tests; the public API
 * (`policyEngineService.evaluatePolicy`) remains the intended runtime
 * entry point. Sprint 2 P1.1 guards against cross-subaccount rule leak.
 */
export function matchesRule(rule: PolicyRule, ctx: PolicyContext): boolean {
  // tool_slug: exact match or wildcard
  if (rule.toolSlug !== '*' && rule.toolSlug !== ctx.toolSlug) return false;

  // subaccount scoping: if rule is scoped, must match exactly
  if (rule.subaccountId && rule.subaccountId !== ctx.subaccountId) return false;

  // conditions: simple equality matching on input fields
  const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
  const hasConditions = Object.keys(conditions).length > 0;
  if (!hasConditions) return true;

  if (!ctx.input || typeof ctx.input !== 'object') return false;
  const inputObj = ctx.input as Record<string, unknown>;

  for (const [key, expected] of Object.entries(conditions)) {
    if (inputObj[key] !== expected) return false;
  }

  return true;
}

function renderDescription(
  template: string | null | undefined,
  ctx: PolicyContext,
): string | undefined {
  if (!template) return undefined;
  return template
    .replace(/\{\{tool_slug\}\}/g, ctx.toolSlug)
    .replace(/\{\{subaccount_id\}\}/g, ctx.subaccountId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Subaccount-constraint governance fetch (Chunk 4)
// ---------------------------------------------------------------------------

interface SubaccountGovernance {
  maxRiskTier: number;
  requireApprovalAtTier: number;
}

async function getSubaccountGovernance(
  subaccountAgentId: string,
): Promise<SubaccountGovernance | null> {
  const [row] = await getOrgScopedDb('policyEngineService.getSubaccountGovernance')
    .select({
      maxRiskTier: subaccountAgents.maxRiskTier,
      requireApprovalAtTier: subaccountAgents.requireApprovalAtTier,
    })
    .from(subaccountAgents)
    .where(eq(subaccountAgents.id, subaccountAgentId))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Spend-policy evaluation helpers (Chunk 7)
// ---------------------------------------------------------------------------

/**
 * Fetch the spending policy for the agent's budget (agent-scoped first,
 * then subaccount-scoped). Returns null when no budget exists for the
 * subaccount/org combination — `spendDecision.evaluated` will be false.
 */
async function getSpendPolicyForContext(
  organisationId: string,
  subaccountId: string,
): Promise<{
  policy: typeof spendingPolicies.$inferSelect;
  budgetDisabledAt: Date | null;
  killSwitchActive: boolean;
} | null> {
  // Look up by subaccountId — one budget per (subaccount, currency).
  // We take the first active budget found; multi-currency budgets are
  // a future concern (spec §20 deferred).
  const [row] = await getOrgScopedDb('policyEngineService.getSpendPolicyForContext')
    .select({
      policy: spendingPolicies,
      budgetDisabledAt: spendingBudgets.disabledAt,
    })
    .from(spendingBudgets)
    .innerJoin(spendingPolicies, eq(spendingPolicies.spendingBudgetId, spendingBudgets.id))
    .where(
      and(
        eq(spendingBudgets.organisationId, organisationId),
        eq(spendingBudgets.subaccountId, subaccountId),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    policy: row.policy,
    budgetDisabledAt: row.budgetDisabledAt ?? null,
    killSwitchActive: false, // org-level kill switch evaluated separately in chargeRouter
  };
}

/**
 * Resolve `spendDecision` for a spend-enabled action. Extracts amount/merchant
 * from `ctx.input`, fetches the active spending policy, then calls
 * `evaluateSpendPolicy`. Returns `{ evaluated: false }` when no policy is found.
 * Catches `evaluateSpendPolicy` throw and maps to `block/spend_decision_error`.
 */
async function resolveSpendDecision(
  ctx: PolicyContext,
  _definition: ReturnType<typeof getActionDefinition>,
): Promise<SpendDecision> {
  if (!ctx.input || typeof ctx.input !== 'object' || Array.isArray(ctx.input)) {
    return { evaluated: false, outcome: 'auto', reason: null };
  }

  const input = ctx.input as Record<string, unknown>;
  const amountMinor = typeof input['amount_minor'] === 'number' ? input['amount_minor'] : null;
  const currency = typeof input['currency'] === 'string' ? input['currency'] : null;
  const merchantRaw = input['merchant'];
  const mode = typeof input['mode'] === 'string' ? input['mode'] as 'shadow' | 'live' : 'live';

  if (amountMinor === null || currency === null || !merchantRaw || typeof merchantRaw !== 'object') {
    // Missing spend-specific fields — cannot evaluate; treat as not evaluated
    return { evaluated: false, outcome: 'auto', reason: null };
  }

  const merchant = merchantRaw as { id?: string | null; descriptor?: string };
  if (typeof merchant.descriptor !== 'string') {
    return { evaluated: false, outcome: 'auto', reason: null };
  }

  const spendCtx = await getSpendPolicyForContext(ctx.organisationId, ctx.subaccountId);
  if (!spendCtx) {
    // No spending policy found — cannot enforce; treat as not evaluated
    return { evaluated: false, outcome: 'auto', reason: null };
  }

  try {
    return evaluateSpendPolicy(
      {
        mode: spendCtx.policy.mode as 'shadow' | 'live',
        perTxnLimitMinor: spendCtx.policy.perTxnLimitMinor,
        dailyLimitMinor: spendCtx.policy.dailyLimitMinor,
        monthlyLimitMinor: spendCtx.policy.monthlyLimitMinor,
        approvalThresholdMinor: spendCtx.policy.approvalThresholdMinor,
        merchantAllowlist: spendCtx.policy.merchantAllowlist as Array<{
          id: string | null;
          descriptor: string;
          source: 'stripe_id' | 'descriptor';
        }>,
      },
      {
        amountMinor,
        currency,
        merchant: { id: merchant.id ?? null, descriptor: merchant.descriptor },
        mode,
        killSwitchActive: spendCtx.killSwitchActive,
        budgetDisabledAt: spendCtx.budgetDisabledAt,
      },
    );
  } catch {
    return { evaluated: true, outcome: 'block', reason: 'spend_decision_error' };
  }
}

export const policyEngineService = {
  /**
   * Evaluate the effective gate level for a tool call.
   *
   * Evaluation order (spec §4.2.8):
   *   1. Org policy rules, sorted by priority ASC — first match wins (policy_override)
   *   2. Registry default (ActionDefinition.defaultGateLevel) if no rule matched (preserved_existing)
   *   3. Risk-tier default via deriveGateLevel when no defaultGateLevel is set (tier_default)
   *   4. Subaccount constraints applied on top (subaccount_constraint takes highest precedence):
   *      - riskTier > maxRiskTier → force block
   *      - riskTier >= requireApprovalAtTier AND decision is 'auto' → upgrade to review
   *
   * When the action is registered as `spendsMoney: true`, also evaluates
   * `spendDecision` from the active spending policy (Chunk 7).
   *
   * This means existing orgs with no custom rules behave exactly as before.
   * Org admins can customise gates by adding rows to policy_rules.
   */
  async evaluatePolicy(ctx: PolicyContext): Promise<PolicyDecision> {
    const rules = await getRulesForOrg(ctx.organisationId);

    // Chunk 7: evaluate spend decision for spend-enabled actions
    const definition = getActionDefinition(ctx.toolSlug);
    let spendDecision: SpendDecision | undefined;
    if (definition?.spendsMoney === true) {
      spendDecision = await resolveSpendDecision(ctx, definition);
    }

    // Chunk 4: resolve subaccount governance constraints (max_risk_tier,
    // require_approval_at_tier). Fetched once per evaluation; null when
    // no subaccountAgentId is present or the row is not found.
    let subaccountGov: SubaccountGovernance | null = null;
    if (ctx.subaccountAgentId) {
      subaccountGov = await getSubaccountGovernance(ctx.subaccountAgentId);
    }

    // Chunk 4: extract riskTier from the action definition for surfacing
    // in the decision result and for subaccount-constraint evaluation.
    const riskTier: RiskTier | undefined =
      definition !== undefined && 'riskTier' in definition
        ? (definition.riskTier as RiskTier)
        : undefined;

    for (const rule of rules) {
      if (matchesRule(rule, ctx)) {
        const baseDecision = rule.decision as GateLevel;
        const upgraded = applyConfidenceUpgrade(
          baseDecision,
          { toolIntentConfidence: ctx.toolIntentConfidence },
          CONFIDENCE_GATE_THRESHOLD,
          rule.confidenceThreshold,
        );
        const constrained = applySubaccountConstraintsPure(upgraded.decision, 'policy_override', riskTier, subaccountGov);
        logger.info('foundation.risk_tier.gate_derived', {
          actionSlug: ctx.toolSlug,
          riskTier,
          gateLevel: constrained.decision,
          source: constrained.gateLevelSource,
        });
        return {
          decision: constrained.decision,
          matchedRule: rule,
          timeoutSeconds: rule.timeoutSeconds ?? undefined,
          timeoutPolicy: (rule.timeoutPolicy as PolicyDecision['timeoutPolicy']) ?? undefined,
          interruptConfig: rule.interruptConfig,
          allowedDecisions: rule.allowedDecisions,
          description: renderDescription(rule.descriptionTemplate, ctx),
          upgradedByConfidence: upgraded.upgradedByConfidence,
          spendDecision,
          riskTier,
          gateLevelSource: constrained.gateLevelSource,
        };
      }
    }

    // No rule matched — derive from riskTier, preserving existing defaultGateLevel
    // per INV-8 (existing gate level preserved when set).
    const derived = riskTier !== undefined
      ? deriveGateLevel(riskTier, definition?.defaultGateLevel as GateLevel | undefined)
      : { gateLevel: (definition?.defaultGateLevel ?? 'review') as GateLevel, source: 'preserved_existing' as const };

    const upgraded = applyConfidenceUpgrade(
      derived.gateLevel,
      { toolIntentConfidence: ctx.toolIntentConfidence },
      CONFIDENCE_GATE_THRESHOLD,
    );
    const constrained = applySubaccountConstraintsPure(
      upgraded.decision,
      derived.source as 'policy_override' | 'preserved_existing' | 'tier_default',
      riskTier,
      subaccountGov,
    );
    console.log('foundation.risk_tier.gate_derived', {
      actionSlug: ctx.toolSlug,
      riskTier,
      gateLevel: constrained.decision,
      source: constrained.gateLevelSource,
    });
    return {
      decision: constrained.decision,
      matchedRule: null,
      upgradedByConfidence: upgraded.upgradedByConfidence,
      spendDecision,
      riskTier,
      gateLevelSource: constrained.gateLevelSource,
    };
  },

  /**
   * Sprint 3 P2.3 — returns every non-empty `guidance_text` whose rule
   * matches the given context. The decision-time guidance middleware
   * calls this once per tool call and injects the returned strings as
   * `<system-reminder>` blocks just before the tool runs.
   *
   * Uses the same rule cache as `evaluatePolicy`, so there is no
   * additional DB hit per tool call.
   */
  async getDecisionTimeGuidance(ctx: PolicyContext): Promise<string[]> {
    const rules = await getRulesForOrg(ctx.organisationId);
    return selectGuidanceTexts(rules, ctx, (rule, c) => matchesRule(rule, c));
  },

  /**
   * Invalidate the cached rules for an org.
   * Must be called when rules are created, updated, or deleted via the API.
   */
  invalidateCache(organisationId: string): void {
    ruleCache.delete(organisationId);
  },

  /**
   * Seed the wildcard fallback rule for a new organisation.
   * This ensures the policy engine always has a catch-all even before
   * org admins add specific rules.
   */
  async seedFallbackRule(organisationId: string): Promise<void> {
    await getOrgScopedDb('policyEngineService.seedFallbackRule')
      .insert(policyRules)
      .values({
        organisationId,
        toolSlug: '*',
        priority: 9999,
        conditions: {},
        decision: 'review',
        evaluationMode: 'first_match',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  },
};
