import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { policyRules } from '../db/schema/index.js';
import { getActionDefinition } from '../config/actionRegistry.js';
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

  const rules = await db
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

export const policyEngineService = {
  /**
   * Evaluate the effective gate level for a tool call.
   *
   * Evaluation order:
   *   1. Org policy rules, sorted by priority ASC — first match wins
   *   2. Registry default (ActionDefinition.defaultGateLevel) if no rule matched
   *   3. 'review' if the action type is not in the registry at all
   *
   * This means existing orgs with no custom rules behave exactly as before.
   * Org admins can customise gates by adding rows to policy_rules.
   */
  async evaluatePolicy(ctx: PolicyContext): Promise<PolicyDecision> {
    const rules = await getRulesForOrg(ctx.organisationId);

    for (const rule of rules) {
      if (matchesRule(rule, ctx)) {
        return {
          decision: rule.decision as 'auto' | 'review' | 'block',
          matchedRule: rule,
          timeoutSeconds: rule.timeoutSeconds ?? undefined,
          timeoutPolicy: (rule.timeoutPolicy as PolicyDecision['timeoutPolicy']) ?? undefined,
          interruptConfig: rule.interruptConfig,
          allowedDecisions: rule.allowedDecisions,
          description: renderDescription(rule.descriptionTemplate, ctx),
        };
      }
    }

    // No rule matched — fall back to registry default
    const definition = getActionDefinition(ctx.toolSlug);
    return {
      decision: definition?.defaultGateLevel ?? 'review',
      matchedRule: null,
    };
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
    await db
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
