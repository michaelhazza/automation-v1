/**
 * Playbook type definitions — single source of truth for the in-memory shape
 * of a playbook definition. The Drizzle column types in
 * server/db/schema/playbookRuns.ts mirror the literal-union types defined
 * here so a definition can round-trip through the database without losing
 * its type discrimination.
 *
 * Spec: tasks/playbooks-spec.md §3.
 *
 * Authoring lives in server/playbooks/<slug>.playbook.ts files using the
 * definePlaybook() helper from ./definePlaybook.ts. The seeder
 * (server/scripts/seedPlaybooks.ts) loads and validates each file via
 * playbookTemplateService.upsertSystemTemplate().
 */

import type { ZodSchema } from 'zod';

export type StepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional';

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

export interface StepRetryPolicy {
  maxAttempts?: number;
  backoffStrategy?: BackoffStrategy;
  /** Closed list of failure reasons that should trigger retry. */
  retryOn?: string[];
}

/**
 * A single step in a playbook DAG. Every step type uses the same shape;
 * only the type-specific fields are populated. Validator (§4) enforces
 * that the right fields are present for each `type`.
 */
export interface PlaybookStep {
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

  /**
   * REQUIRED for every step type. Validator-validated. Engine parses agent /
   * prompt outputs through this schema; failures retry up to N times then
   * fail the step.
   */
  outputSchema: ZodSchema;
}

export interface PlaybookDefinition {
  /** Matches filename: server/playbooks/<slug>.playbook.ts */
  slug: string;
  name: string;
  description: string;

  /** Bumped on every published edit. Validator enforces strict monotonicity. */
  version: number;

  /** What the user provides at run start. */
  initialInputSchema: ZodSchema;

  /** Phase 1.5 — declared but unused in Phase 1. */
  paramsSchema?: ZodSchema;

  steps: PlaybookStep[];

  /** Optional per-template parallelism cap; bounded by system MAX_PARALLEL_STEPS. */
  maxParallelSteps?: number;
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
  | 'reserved_template_namespace';

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
