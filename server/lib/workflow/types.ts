/**
 * Workflow type definitions — single source of truth for the in-memory shape
 * of a playbook definition. The Drizzle column types in
 * server/db/schema/playbookRuns.ts mirror the literal-union types defined
 * here so a definition can round-trip through the database without losing
 * its type discrimination.
 *
 * Spec: tasks/workflows-spec.md §3.
 *
 * Authoring lives in server/workflows/<slug>.workflow.ts files using the
 * defineWorkflow() helper from ./defineWorkflow.ts. The seeder
 * (server/scripts/seedWorkflows.ts) loads and validates each file via
 * playbookTemplateService.upsertSystemTemplate().
 */

import type { ZodSchema } from 'zod';

export type StepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional'
  | 'agent_decision'
  | 'action_call'
  | 'invoke_automation'
  // V1 user-facing ("four A's") names — used in Studio-authored templates.
  | 'agent'
  | 'action'
  | 'ask';

export type SideEffectType =
  | 'none'
  | 'idempotent'
  | 'reversible'
  | 'irreversible';

export type FailurePolicy = 'fail_run' | 'continue';

export type BackoffStrategy = 'exponential' | 'linear';

export interface AgentRef {
  kind: 'system' | 'org';
  /** Slug of the agent — resolved to a concrete agentId at run start (§3.4). */
  slug: string;
}

/**
 * A single selectable branch for an `agent_decision` step. The agent must
 * choose exactly one branch by its `id`.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §4.
 */
export interface AgentDecisionBranch {
  /** Stable identifier — used as `chosenBranchId` in the agent output. Max 64 chars, [a-z0-9_-]. */
  id: string;
  /** Human-readable label shown in the decision envelope. Max 80 chars. */
  label: string;
  /** Explanation of when this branch should be chosen. Max 500 chars. */
  description: string;
  /** IDs of the head steps of this branch (the first steps that belong to it). */
  entrySteps: string[];
}

export interface StepRetryPolicy {
  maxAttempts?: number;
  backoffStrategy?: BackoffStrategy;
  /** Closed list of failure reasons that should trigger retry. */
  retryOn?: string[];
}

/** Retry policy extension for invoke_automation steps. §5.4a rule 3. */
export interface AutomationStepRetryPolicy extends StepRetryPolicy {
  /**
   * When true, the engine retries this step even when the Automation declares
   * `idempotent: false`. Author-asserted escape hatch — logged and warned in UI.
   * Hard ceiling of maxAttempts ≤ 3 still applies. §5.4a rule 3.
   */
  overrideNonIdempotentGuard?: boolean;
}

/**
 * Closed vocabulary of `AutomationStepError.status` values. Treated as stable
 * namespaced identifiers, NOT free-form text. Any caller that constructs an
 * `AutomationStepError` with a `status` value MUST pick from this list — bare
 * strings are a regression class. New entries are added here AND to the JSDoc
 * on the `status` field so the source of truth stays single.
 *
 * Tightening the field to a literal-union type on `AutomationStepError.status`
 * is deferred to the first follow-up that consolidates consumer handling; for
 * now the discipline is enforced by convention + a pure test that asserts
 * every production status value is included in this tuple. Spec
 * `2026-04-28-pre-test-integration-harness-spec.md` §1.6.
 */
export const KNOWN_AUTOMATION_STEP_ERROR_STATUSES = ['missing_connection'] as const;
export type KnownAutomationStepErrorStatus =
  (typeof KNOWN_AUTOMATION_STEP_ERROR_STATUSES)[number];

/** Standardised error shape for every invoke_automation failure. §5.7. */
export interface AutomationStepError {
  /** §5.7 error_code vocabulary. */
  code: string;
  /**
   * Error class — drives retryability and error-handler routing.
   *
   * `'configuration'` covers errors caused by missing/incomplete setup
   * (missing connection, missing scope binding) — surfaced to operators so
   * they fix configuration rather than retry.
   */
  type: 'validation' | 'execution' | 'timeout' | 'external' | 'unknown' | 'configuration';
  message: string;
  /** True only when retryable AND the non-idempotent guard allows it. */
  retryable: boolean;
  /**
   * Namespaced stable identifier for sub-classifying errors of a given `type`.
   * Closed vocabulary — pick from `KNOWN_AUTOMATION_STEP_ERROR_STATUSES`. Never
   * free text. The `context` shape per status is documented alongside the
   * vocabulary tuple. Consumers MUST narrow on `status` before reading
   * `context`.
   *
   * Current vocabulary: `'missing_connection'` ⇒
   *   `context: { automationId: string; missingKeys: string[] }`.
   */
  status?: KnownAutomationStepErrorStatus;
  /**
   * Structured error context. Shape is determined by `status`. See
   * `status` JSDoc for the per-status mapping.
   */
  context?: Record<string, unknown>;
}

/**
 * A single step in a playbook DAG. Every step type uses the same shape;
 * only the type-specific fields are populated. Validator (§4) enforces
 * that the right fields are present for each `type`.
 */
export interface WorkflowStep {
  /** kebab_case identifier, unique within the definition. Regex enforced by validator. */
  id: string;
  name: string;
  description?: string;
  type: StepType;

  /** Step ids whose `completed` status this step depends on. */
  dependsOn: string[];

  /** When true, engine pauses after step completion until a human approves the output. */
  humanReviewRequired?: boolean;

  /**
   * REQUIRED. Drives mid-run editing safety:
   *   - none / idempotent → safe to re-run automatically
   *   - reversible       → re-run requires user confirmation
   *   - irreversible     → never auto-re-run; never retry on failure
   *
   * Validator rule 12 also rejects `irreversible` steps with
   * `retryPolicy.maxAttempts > 1`.
   */
  sideEffectType: SideEffectType;

  /**
   * Default 'fail_run'. When 'continue', a failure of this step does not
   * fail the whole run if downstream paths can still complete; the run
   * terminates `completed_with_errors` instead.
   */
  failurePolicy?: FailurePolicy;

  /** Optional override for this step's timeout (seconds). */
  timeoutSeconds?: number;

  retryPolicy?: StepRetryPolicy;

  // ── type: prompt ──────────────────────────────────────────────────────────
  /** Templated prompt string with `{{ ... }}` expressions. */
  prompt?: string;
  /** Optional model override (e.g. 'claude-haiku-4-5-20251001'). */
  model?: string;

  // ── type: agent_call ──────────────────────────────────────────────────────
  agentRef?: AgentRef;
  /** Map of paramName → template expression resolved against run context. */
  agentInputs?: Record<string, string>;

  // ── type: user_input ──────────────────────────────────────────────────────
  formSchema?: ZodSchema;
  formDescription?: string;

  // ── type: approval ────────────────────────────────────────────────────────
  approvalPrompt?: string;
  approvalSchema?: ZodSchema;

  // ── type: conditional ─────────────────────────────────────────────────────
  /** JSONLogic expression evaluated against run context. */
  condition?: unknown;
  trueOutput?: unknown;
  falseOutput?: unknown;

  // ── type: agent_decision ──────────────────────────────────────────────────
  /**
   * The question the agent must answer in order to choose a branch.
   * Appended to the agent system prompt via the decision envelope.
   */
  decisionPrompt?: string;
  /** Two to MAX_DECISION_BRANCHES_PER_STEP selectable branches. */
  branches?: AgentDecisionBranch[];
  /**
   * Branch id chosen if the agent run fails after exhausting retries.
   * When absent, failure causes the step (and run) to fail instead.
   */
  defaultBranchId?: string;
  /**
   * Minimum acceptable confidence value (0–1). When the agent returns a
   * confidence value below this threshold, the decision is escalated to HITL
   * instead of applied automatically.
   */
  minConfidence?: number;

  // ── type: action_call ─────────────────────────────────────────────────────
  /**
   * Slug of the skill/action invoked directly. Must be on the
   * ACTION_CALL_ALLOWED_SLUGS allowlist (`server/lib/workflow/actionCallAllowlist.ts`).
   * Validator rejects any other slug. Spec §4.
   */
  actionSlug?: string;
  /**
   * Templated inputs resolved against run context and passed as the skill
   * handler's `input` argument. Same templating surface as `agentInputs`:
   *   { cron: '{{ steps.schedule.output.cron }}', subaccountId: '{{ run.subaccount.id }}' }
   */
  actionInputs?: Record<string, string>;
  /**
   * Idempotency scope for an action_call step. Defaults to 'run' (keyed on
   * `playbook:${runId}:${stepId}:${attempt}`). Set to 'entity' when the call
   * creates a singleton business resource (e.g. `config_create_scheduled_task`)
   * and cross-run replay must deduplicate against the same entity. Spec §4.5.
   */
  idempotencyScope?: 'run' | 'entity';
  /**
   * Entity-scoped idempotency key used when `idempotencyScope === 'entity'`.
   * Format: `task:${subaccountId}:${taskSlug}` or similar stable identifier.
   */
  entityKey?: string;
  /**
   * When true and `type === 'action_call'`, the action is skipped on runs
   * other than the first successful run for the subaccount + playbook slug.
   * Used by onboarding-only side effects. Spec §11.4 (setup_schedule pattern).
   */
  firstRunOnly?: boolean;

  /**
   * Terminal-step marker. When `true`, the step's output is eligible to be
   * the canonical output consumed by downstream systems (portal card, email
   * digest). If multiple `final: true` steps succeed, the last in topological
   * order wins. Spec §4.12.
   */
  final?: boolean;

  /**
   * V1 publish-time metadata bag. Read by workflowValidatorPure (Rules 6–8):
   * approverGroup, is_critical, allowMultipleSubmissions. Not consumed by the
   * engine directly — engine uses the typed fields above.
   */
  params?: Record<string, unknown>;

  // ── type: invoke_automation ───────────────────────────────────────────────
  /**
   * References `automations.id`. Resolved at dispatch time against the run's
   * scope (§5.8). Validator rejects a missing automationId at authoring time.
   */
  automationId?: string;
  /**
   * Template expressions resolved against run context and sent as the webhook
   * body. Same `{{ steps.X.output.Y }}` syntax as all other Workflow step inputs.
   * Validator rejects a missing/non-object inputMapping at authoring time.
   */
  inputMapping?: Record<string, string>;
  /**
   * Optional projection: maps keys from the webhook response to Workflow variable
   * space (`{{ steps.{stepId}.output.{mappedKey} }}`). When absent, full response
   * is available as `{{ steps.{stepId}.output.response }}`. §5.5.
   */
  outputMapping?: Record<string, string>;
  /**
   * Gate level override for this step. When omitted, resolved from the
   * Automation's `side_effects` column: read_only → 'auto'; mutating|unknown → 'review'.
   * 'block' is rejected by the validator. §5.4a rule 1, §5.6.
   */
  gateLevel?: 'auto' | 'review';
  /**
   * Retry policy for invoke_automation steps. Hard ceiling: maxAttempts ≤ 3
   * engine-enforced regardless of authoring. §5.4a rule 3.
   */
  automationRetryPolicy?: AutomationStepRetryPolicy;

  // ── type: user_input (reference binding) ──────────────────────────────────
  /**
   * When set on a `user_input` step, the engine writes the named form field's
   * value to a Workspace Memory Entry (Reference note) on step completion.
   * Spec §G8 / §7.4. Validator rejects on any non-user_input step type.
   */
  referenceBinding?: {
    target: 'reference_note';
    /** The Reference note title. 1–200 chars. */
    name: string;
    /** Auto-attach the created Reference to the subaccount knowledge tab. */
    autoAttach: boolean;
    /** The form field whose value we write. Must exist in formSchema. */
    field: string;
  };

  /**
   * REQUIRED for every step type. Validator-validated. Engine parses agent /
   * prompt outputs through this schema; failures retry up to N times then
   * fail the step.
   */
  outputSchema: ZodSchema;
}

/**
 * Narrowed view of a WorkflowStep for `agent_decision` steps.
 * Use this when you need the compiler to enforce that the required fields
 * (`branches`, `decisionPrompt`, `agentRef`) are present.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §4.
 */
export type AgentDecisionStep = WorkflowStep & {
  type: 'agent_decision';
  branches: AgentDecisionBranch[];
  decisionPrompt: string;
  agentRef: AgentRef;
};

/**
 * Narrowed view of a WorkflowStep for `action_call` steps.
 * Spec: docs/onboarding-workflows-spec.md §4.2.
 */
export type ActionCallStep = WorkflowStep & {
  type: 'action_call';
  actionSlug: string;
  /** `{}` is allowed; `undefined` is not after validation. */
  actionInputs: Record<string, string>;
};

/**
 * Narrowed view of a WorkflowStep for `invoke_automation` steps. §5.3.
 * Required fields are enforced by the authoring-time validator.
 */
export type InvokeAutomationStep = WorkflowStep & {
  type: 'invoke_automation';
  automationId: string;
  inputMapping: Record<string, string>;
  outputMapping?: Record<string, string>;
  gateLevel?: 'auto' | 'review';
  automationRetryPolicy?: AutomationStepRetryPolicy;
};

/**
 * Workflow-level declarative binding from a step's output to a Memory Block.
 * Spec: docs/onboarding-workflows-spec.md §8.2.
 */
export interface WorkflowKnowledgeBinding {
  /** The step id whose output we read from. Must exist in steps[]. */
  stepId: string;
  /** JSON path within the step output (dot notation, array indices allowed). */
  outputPath: string;
  /** The Memory Block label to upsert. 1–80 chars, [a-zA-Z0-9 _-]. */
  blockLabel: string;
  /**
   * How to combine this output with existing block content:
   *   - 'replace' — overwrite (default)
   *   - 'append'  — newline-separated append; truncated to 2000 chars from the end
   *   - 'merge'   — JSON-aware merge; falls back to 'replace' on non-object inputs
   */
  mergeStrategy?: 'replace' | 'append' | 'merge';
  /**
   * When true, the binding only fires on the first successful run for this
   * sub-account + playbook slug. Subsequent runs skip the upsert. Used for
   * baseline facts captured once during onboarding.
   */
  firstRunOnly?: boolean;
}

/**
 * Portal card declaration — spec §9.4 / §11.5.
 */
export interface WorkflowPortalPresentation {
  /** Card title shown to sub-account users. */
  cardTitle: string;
  /** Step id whose output drives the card preview. */
  headlineStepId: string;
  /** JSON path within that step's output for the headline content. */
  headlineOutputPath: string;
  /** Deep link within the portal; falls back to the run modal when omitted. */
  detailRoute?: string;
}

export interface WorkflowDefinition {
  /** Matches filename: server/workflows/<slug>.workflow.ts */
  slug: string;
  name: string;
  description: string;

  /** Bumped on every published edit. Validator enforces strict monotonicity. */
  version: number;

  /** What the user provides at run start. Null for org templates stored without a live Zod schema. */
  initialInputSchema: ZodSchema | null;

  /** Phase 1.5 — declared but unused in Phase 1. */
  paramsSchema?: ZodSchema;

  steps: WorkflowStep[];

  /** Optional per-template parallelism cap; bounded by system MAX_PARALLEL_STEPS. */
  maxParallelSteps?: number;

  /**
   * Workflow-level declarative bindings from step outputs to Memory Blocks.
   * Fire on run completion inside `finaliseRun()`. Spec §8.
   */
  knowledgeBindings?: WorkflowKnowledgeBinding[];

  /** Portal card declaration. Spec §9.4 / §11.5. */
  portalPresentation?: WorkflowPortalPresentation;

  /**
   * When true, a run of this playbook is auto-started on sub-account creation
   * (or when a module contributing this slug is enabled) in `runMode: 'supervised'`.
   * Default false. Spec §10.5.
   */
  autoStartOnOnboarding?: boolean;
}

// ─── Validation result types (used by validator + UI surfacing) ──────────────

export type ValidationRule =
  | 'unique_id'
  | 'kebab_case'
  | 'unresolved_dep'
  | 'cycle'
  | 'orphan'
  | 'missing_entry'
  | 'unresolved_template_ref'
  | 'transitive_dep'
  | 'missing_field'
  | 'missing_output_schema'
  | 'agent_not_found'
  | 'missing_side_effect_type'
  | 'version_not_monotonic'
  | 'irreversible_with_retries'
  | 'max_dag_depth_exceeded'
  | 'reserved_template_namespace'
  // agent_decision step rules (spec §6)
  | 'decision_branches_too_few'
  | 'decision_branches_too_many'
  | 'decision_branch_duplicate_id'
  | 'decision_branch_no_entry_steps'
  | 'decision_entry_step_not_found'
  | 'decision_entry_step_missing_dep'
  | 'decision_branch_entry_collision'
  | 'decision_side_effect_not_none'
  | 'decision_default_branch_invalid'
  | 'decision_min_confidence_out_of_range'
  // action_call step rules (onboarding-workflows-spec §4)
  | 'action_slug_not_allowed'
  | 'action_side_effect_mismatch'
  | 'entity_idempotency_required'
  // knowledgeBindings rules (onboarding-workflows-spec §8)
  | 'knowledge_binding_step_not_found'
  | 'knowledge_binding_duplicate_label'
  | 'knowledge_binding_invalid_label'
  | 'knowledge_binding_invalid_output_path'
  | 'knowledge_binding_merge_requires_object'
  // referenceBinding rules (onboarding-workflows-spec §G8)
  | 'reference_binding_wrong_step_type'
  | 'reference_binding_field_not_in_schema'
  // portalPresentation rules (onboarding-workflows-spec §9.4)
  | 'portal_presentation_step_not_found'
  // invoke_automation step rules (§5.3 / §5.4a / §5.10a)
  | 'invalid_field'
  | 'retry_ceiling_exceeded'
  | 'unknown_step_type';

export interface ValidationError {
  rule: ValidationRule;
  stepId?: string;
  /** For cycle rule: comma-joined cycle path. */
  path?: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

// ─── Run context shape (in-memory representation; persisted as jsonb) ────────

/**
 * Run context — the single growing JSON blob keyed by step id. Reserved
 * `_meta` namespace is engine-managed and unwritable by steps.
 *
 * Spec §5.1.1: deterministic merge rules. No deep merge. Step outputs
 * replace the entire `steps[id]` value. Invalidated outputs are deleted.
 */
export interface RunContext {
  input: Record<string, unknown>;
  subaccount?: { id: string; name: string; timezone?: string; slug?: string };
  org?: { id: string; name: string };
  steps: Record<string, { output: unknown }>;
  _meta: {
    runId: string;
    templateVersionId: string;
    startedAt: string;
    resolvedAgents?: Record<string, string>;
    /**
     * Per-run cache of agents resolved for action_call dispatch. The engine
     * looks up the org's Configuration Assistant agent row once at run start
     * and re-reads from this cache on every dispatch. Spec §4.8.
     */
    resolvedActionAgents?: {
      configuration_assistant?: string;
    };
    isReplay?: boolean;
    replaySourceRunId?: string;
  };
}

/**
 * The shape returned by `playbookTemplatingService.extractReferences()` —
 * one entry per `{{ ... }}` expression in a step's templatable strings.
 */
export interface TemplateReference {
  raw: string;
  /** Top-level namespace: 'run.input' | 'run.subaccount' | 'run.org' | 'steps' */
  namespace: 'run.input' | 'run.subaccount' | 'run.org' | 'steps';
  /** Step id, populated when namespace === 'steps'. */
  stepId?: string;
  /** Path within the step's output (or initial input shape). */
  path: string[];
}
