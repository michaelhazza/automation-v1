// @principal-context-import-only — reason: registry references canonicalDataService only in handler-classification documentation; future handlers that invoke it must pass fromOrgId(organisationId, subaccountId).
import { z } from 'zod';
import type { RuntimeCheckKind, RuntimeCheckBlastRadius } from '../../../shared/types/runtimeCheck.js';
import type { RiskTier } from '../../../shared/types/riskTier.js';
// ---------------------------------------------------------------------------
// Action Type Registry — central definition of all action types
// Phase 1: TypeScript config object. Phase 2: promotes to DB table.
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxRetries: number;
  strategy: 'exponential_backoff' | 'fixed' | 'none';
  retryOn: string[];
  doNotRetryOn: string[];
}

/** MCP ToolAnnotations — maps to the MCP specification's ToolAnnotations type */
export interface McpAnnotations {
  readOnlyHint: boolean;    // true = does not modify external state
  destructiveHint: boolean; // true = may be irreversible
  idempotentHint: boolean;  // true = same args = same effect
  openWorldHint: boolean;   // true = reaches external systems
}

/** JSON Schema describing the tool's input parameters */
export interface ParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    properties?: Record<string, unknown>;
    items?: Record<string, unknown>;
  }>;
  required: string[];
  additionalProperties?: boolean;
}

/**
 * Execution-model contract for an action handler — declares how the handler
 * stays safe under retry given the at-least-once execution guarantee. See
 * docs/improvements-roadmap-spec.md → "Execution model — at-least-once,
 * idempotent handlers" for the full rationale.
 *
 *   - 'read_only'   — no side effects; safe to re-run without any coordination.
 *   - 'keyed_write' — writes are deduplicated by the caller-supplied
 *                     idempotencyKey at the DB or external provider layer
 *                     (INSERT ... ON CONFLICT DO NOTHING, Idempotency-Key
 *                     header, etc.).
 *   - 'locked'      — handler takes a pg advisory lock keyed on the
 *                     idempotencyKey before the call and releases on exit.
 *                     Used for irreversible side effects to third parties
 *                     that have no native dedupe story.
 */
export type IdempotencyStrategy = 'read_only' | 'keyed_write' | 'locked' | 'state_based';

// Closed list of valid OAuth provider slugs for `requiredIntegration` on actions.
// Single source of truth — both the type below and `VALID_INTEGRATION_PROVIDERS`
// in integrationBlockService derive from this constant.
export const REQUIRED_INTEGRATION_SLUGS = ['google_drive', 'gmail', 'google_calendar', 'slack', 'notion', 'ghl', 'stripe_agent'] as const;

export type RequiredIntegrationSlug = typeof REQUIRED_INTEGRATION_SLUGS[number];

export interface IdempotencyContract {
  /** Ordered ActionContext field names that together form the idempotency key. See v7.1 spec §588. */
  keyShape: string[];
  /** Dedup boundary. See v7.1 spec §588. */
  scope: 'subaccount' | 'org';
  /** Retention class before expiry. See v7.1 spec §588. */
  ttlClass: 'permanent' | 'long' | 'short';
  /** Whether the lock record may be reclaimed after TTL. See v7.1 spec §588. */
  reclaimEligibility: 'eligible' | 'disabled';
}

export interface ActionDefinition {
  actionType: string;
  description: string;
  actionCategory: 'api' | 'worker' | 'browser' | 'devops' | 'mcp';
  isExternal: boolean;
  defaultGateLevel: 'auto' | 'review' | 'block';
  /** Risk tier classification (spec §4.2.3). Required on every entry; enforced by verify-risk-tier-assigned.sh CI gate. */
  riskTier: RiskTier;
  createsBoardTask: boolean;
  /** @deprecated Use parameterSchema instead. Kept for backward compat. */
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy: RetryPolicy;
  mcp?: { annotations: McpAnnotations };

  /**
   * P0.2 Slice B — required on every entry from Sprint 1 landing onward.
   * Enforced by verify-idempotency-strategy-declared.sh.
   */
  idempotencyStrategy: IdempotencyStrategy;

  // Manager-role guard — spec §9.4
  managerAllowlistMember?: boolean;
  directExternalSideEffect?: boolean;
  sideEffectClass?: 'read' | 'write' | 'none';

  /**
   * P1.1 Layer 3 — declarative scope metadata consumed by the before-tool
   * authorisation hook. See P1.1 Layer 3 validateScope() for the check
   * implementation. Optional — only actions that operate on tenant-scoped
   * resources need to declare scope requirements.
   */
  scopeRequirements?: {
    /** Names of arg fields that must be subaccount IDs the current tenant owns. */
    validateSubaccountFields?: string[];
    /** Names of arg fields that must be GHL location IDs the current tenant owns. */
    validateGhlLocationFields?: string[];
    /** If true, run requires `userId` in execution context (no system runs). */
    requiresUserContext?: boolean;
  };

  /** P4.1 — topic tags for intent-based filtering. */
  topics?: string[];

  /** P4.4 — opt-in to the semantic critique gate when run via economy tier. */
  requiresCritiqueGate?: boolean;

  /**
   * P0.2 Slice C — extended retry behaviour. Overrides retryPolicy's
   * default fail-the-run semantics:
   *   - 'retry'    — use withBackoff per retryPolicy (default, matches
   *                  existing behaviour).
   *   - 'skip'     — log the failure, return
   *                  { success: false, skipped: true, reason } to the LLM,
   *                  and let the agent loop continue.
   *   - 'fail_run' — terminate the entire agent run via failure() from
   *                  shared/iee/failure.ts.
   *   - 'fallback' — return fallbackValue as the result instead of failing.
   */
  onFailure?: 'retry' | 'skip' | 'fail_run' | 'fallback';
  fallbackValue?: unknown;

  /**
   * P2A — data read-path classification. Every action declares where it
   * reads data from so that the canonical-data migration can be tracked:
   *   - 'canonical'  — reads normalised data via canonicalDataService.
   *   - 'liveFetch'  — hits a provider API directly (not yet migrated).
   *   - 'none'       — does not read external data (pure tool / creation).
   * Enforced by verify-skill-read-paths.sh — every entry must have this.
   */
  readPath: 'canonical' | 'liveFetch' | 'none';

  /**
   * Required when readPath is 'liveFetch'. Documents why this action still
   * hits the provider API instead of reading from canonical tables.
   */
  liveFetchRationale?: string;

  /**
   * P1.1 Layer 3 — flag to mark methodology skills (pure prompt scaffolds,
   * no side effects). When true, the preTool middleware bypasses
   * actionService.proposeAction and writes a single audit row with
   * reason='methodology_skill'. Distinct from read-only skills because
   * methodology skills do not even read from external systems.
   */
  isMethodology?: boolean;

  /**
   * P4.1 — universal skills are always merged into every agent's effective
   * allowlist and always preserved through the topic filter. See the
   * universal-skill contract in docs/improvements-roadmap-spec.md P4.1.
   */
  isUniversal?: boolean;

  /**
   * OAuth provider this action requires. When set, agentExecutionService calls
   * integrationBlockService.checkRequiredIntegration before dispatching the tool,
   * blocking the run if no active connection exists.
   * Slugs: 'google_drive' | 'gmail' | 'slack' | 'notion' | 'ghl' | 'stripe_agent'
   * Leave unset for first-party / internal-only actions.
   */
  requiredIntegration?: RequiredIntegrationSlug;

  /**
   * E-D4 — marks tools that cannot safely pause mid-execution to wait for an
   * OAuth connection. When true and the required integration is missing,
   * checkRequiredIntegration returns { allowed: false, code: 'TOOL_NOT_RESUMABLE' }
   * instead of a block-state payload, causing the run to be cancelled rather than paused.
   * Use for tools with irreversible or time-sensitive external side effects.
   */
  integrationNotResumable?: true;

  /**
   * Agentic Commerce — marks skills that move real money through chargeRouterService.
   * When true, policyEngineService evaluates a spendDecision in addition to the
   * standard gate decision. Reviewed by verify-idempotency-strategy-declared.sh (CI).
   * Spec: tasks/builds/agentic-commerce/spec.md §7.1, plan §Chunk 6.
   */
  spendsMoney?: boolean;

  /**
   * Agentic Commerce — declares how the charge is executed after policy approval.
   * Required when spendsMoney is true; undefined for non-spend skills.
   *   'main_app_stripe'    — main app calls the payment provider API directly.
   *   'worker_hosted_form' — main app authorises and hands a charge token to the
   *                          IEE worker, which fills a merchant-hosted payment form.
   * Spec: tasks/builds/agentic-commerce/spec.md §7.1, §6.1.
   */
  executionPath?: 'main_app_stripe' | 'worker_hosted_form';

  // Trust & Verification Layer (spec §6.1)
  // Declares the runtime check to run after this action executes.
  // null means no deterministic check is possible; verifyNullJustification
  // must then be set (enforced by verify-runtime-check-coverage.sh CI gate).
  verify?: RuntimeCheckKind | null;
  verifyNullJustification?: string;
  reversible?: boolean;
  blastRadius?: RuntimeCheckBlastRadius;
}
