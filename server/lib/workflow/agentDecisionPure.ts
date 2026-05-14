/**
 * Pure helper functions for `agent_decision` step execution.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §12, §24.
 *
 * Every function in this module is:
 *   - Synchronous
 *   - Deterministic (same input → same output)
 *   - Side-effect-free (no DB, no network, no filesystem)
 *   - Importable from tests without spinning up the wider app
 *
 * This is the single source of truth for decision logic. The engine
 * delegates; it never re-implements.
 */

import type {
  WorkflowDefinition,
  WorkflowStep,
  AgentDecisionBranch,
} from './types.js';
import type { AgentDecisionStep } from './types.js';
import type { ValidationResult, ValidationError } from './types.js';
import { agentDecisionOutputBaseSchema } from './agentDecisionSchemas.js';
import type { AgentDecisionOutput } from './agentDecisionSchemas.js';

// ---------------------------------------------------------------------------
// Supporting types (local to this module)
// ---------------------------------------------------------------------------

export type StepReadiness = 'ready' | 'waiting' | 'skipped';

/**
 * Mirrors WorkflowStepRunStatus from the DB schema. Duplicated here to keep
 * this module free of imports from server/db/.
 *
 * NOTE: `awaiting_hitl` and `cancelled` are not yet in the DB schema
 * (as of the current migrations) but are declared here for forward-compat:
 * `awaiting_hitl` will be added when the HITL confidence-escalation path is
 * fully wired through the UI; `cancelled` if per-step cancellation lands.
 * Both are treated as non-terminal by `computeStepReadiness`, which is the
 * correct behaviour regardless of schema timing.
 */
export type StepRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'awaiting_hitl'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'invalidated';

export type DecisionParseErrorCode =
  | 'invalid_json'
  | 'schema_violation'
  | 'unknown_branch'
  | 'extra_schema_violation';

export interface DecisionParseError {
  code: DecisionParseErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export type DecisionParseResult =
  | { ok: true; output: AgentDecisionOutput }
  | { ok: false; error: DecisionParseError };

// ---------------------------------------------------------------------------
// 24.1 computeSkipSet
// ---------------------------------------------------------------------------

/**
 * Compute the set of step ids that should be transitioned to `skipped`
 * given a chosen branch on a decision step.
 *
 * Algorithm:
 *   1. Collect the entry steps of every non-chosen branch (the "skip seeds").
 *   2. BFS forward from the skip seeds, adding each visited step to the
 *      skip set IF and only IF every one of its branch-descended ancestors
 *      is already in the skip set. This is the "live ancestor short-circuit"
 *      that keeps convergence steps alive.
 *   3. Return the frozen set.
 *
 * Complexity: O(V + E) in the number of steps and dependency edges.
 * Purity: no DB, no async, no side effects. Same input → same output.
 *
 * Invariants:
 *   - The decision step itself is NEVER in the returned set.
 *   - A step reachable via the chosen branch is NEVER in the set,
 *     even if it is also reachable via a non-chosen branch (convergence).
 *   - Steps whose ancestors are entirely non-branch (outside the decision's
 *     subgraph) are NEVER in the set.
 */
export function computeSkipSet(
  definition: WorkflowDefinition,
  decisionStepId: string,
  chosenBranchId: string,
): ReadonlySet<string> {
  const decisionStep = definition.steps.find(
    (s): s is AgentDecisionStep =>
      s.id === decisionStepId && s.type === 'agent_decision',
  );
  if (!decisionStep) {
    throw new Error(
      `computeSkipSet: decision step '${decisionStepId}' not found or wrong type`,
    );
  }

  const chosenBranch = decisionStep.branches.find(
    (b) => b.id === chosenBranchId,
  );
  if (!chosenBranch) {
    throw new Error(
      `computeSkipSet: branch '${chosenBranchId}' not found on decision step '${decisionStepId}'`,
    );
  }

  // Build adjacency indices and the all-branch-descended set once (O(V+E) each).
  // These are passed into hasLiveBranchAncestor to avoid rebuilding them O(V) times
  // inside the BFS loop (which would make the overall algorithm O(V*(V+E))).
  const downstream = buildDownstreamIndex(definition);
  const upstream = buildUpstreamIndex(definition);
  const allBranchDescended = computeAllBranchDescendedSteps(definition, decisionStep);

  // Build the set of steps reachable from the chosen branch.
  const liveBranchSet = computeBranchLiveSet(definition, decisionStep, chosenBranchId);

  // Entry steps of the NON-chosen branches form the initial skip candidates.
  const skipCandidates: string[] = [];
  for (const branch of decisionStep.branches) {
    if (branch.id === chosenBranchId) continue;
    for (const entryStepId of branch.entrySteps) {
      skipCandidates.push(entryStepId);
    }
  }

  // BFS forward from the skip candidates, using live-ancestor short-circuit.
  // Overall complexity: O(V+E) — the pre-computed indices are shared across
  // all hasLiveBranchAncestor calls rather than rebuilt each time.
  const skipSet = new Set<string>();
  const queue: string[] = [...skipCandidates];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const stepId = queue.shift()!;
    if (visited.has(stepId)) continue;
    visited.add(stepId);

    // A step is skipped only if it is NOT reachable from the chosen branch.
    // If a step is in the live branch set, it is a convergence step — keep alive.
    if (liveBranchSet.has(stepId)) {
      continue;
    }

    // Additionally, check if any branch-descended ancestor is in the live set.
    if (hasLiveBranchAncestor(stepId, upstream, allBranchDescended, liveBranchSet)) {
      continue;
    }

    skipSet.add(stepId);

    // Enqueue descendants for the same check.
    const children = downstream.get(stepId) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }

  return skipSet;
}

/**
 * Returns true if any branch-descended ancestor of `stepId` is in the
 * live branch set (i.e. is reachable from the chosen branch).
 *
 * Accepts pre-computed `upstream` and `allBranchDescended` to avoid
 * rebuilding them on every call (caller computes once, passes here).
 */
function hasLiveBranchAncestor(
  stepId: string,
  upstream: ReadonlyMap<string, readonly string[]>,
  allBranchDescended: ReadonlySet<string>,
  liveBranchSet: ReadonlySet<string>,
): boolean {
  // BFS backwards from stepId collecting branch-descended ancestors.
  const q: string[] = [stepId];
  const seen = new Set<string>();
  while (q.length > 0) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const parents = upstream.get(id) ?? [];
    for (const p of parents) {
      if (allBranchDescended.has(p)) {
        if (liveBranchSet.has(p)) return true;
        if (!seen.has(p)) q.push(p);
      }
    }
  }
  return false;
}

/** Build the set of step ids reachable from the chosen branch's entry steps. */
function computeBranchLiveSet(
  definition: WorkflowDefinition,
  decisionStep: AgentDecisionStep,
  chosenBranchId: string,
): ReadonlySet<string> {
  const chosen = decisionStep.branches.find((b) => b.id === chosenBranchId);
  if (!chosen) return new Set();

  const downstream = buildDownstreamIndex(definition);
  const live = new Set<string>();
  const queue: string[] = [...chosen.entrySteps];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (live.has(id)) continue;
    live.add(id);
    const kids = downstream.get(id) ?? [];
    for (const k of kids) {
      if (!live.has(k)) queue.push(k);
    }
  }
  return live;
}

/** Compute all steps reachable from ANY branch entry step (across all branches). */
function computeAllBranchDescendedSteps(
  definition: WorkflowDefinition,
  decisionStep: AgentDecisionStep,
): ReadonlySet<string> {
  const downstream = buildDownstreamIndex(definition);
  const all = new Set<string>();
  for (const branch of decisionStep.branches) {
    for (const entryId of branch.entrySteps) {
      all.add(entryId);
    }
  }
  const queue = Array.from(all);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const kids = downstream.get(id) ?? [];
    for (const k of kids) {
      if (!all.has(k)) {
        all.add(k);
        queue.push(k);
      }
    }
  }
  return all;
}

/** stepId -> direct descendants (steps that depend on this step) */
function buildDownstreamIndex(
  definition: WorkflowDefinition,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const step of definition.steps) {
    for (const dep of step.dependsOn) {
      const list = index.get(dep) ?? [];
      list.push(step.id);
      index.set(dep, list);
    }
  }
  return index;
}

/** stepId -> direct ancestors (its dependsOn list) */
function buildUpstreamIndex(
  definition: WorkflowDefinition,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const step of definition.steps) {
    index.set(step.id, [...step.dependsOn]);
  }
  return index;
}

// ---------------------------------------------------------------------------
// 24.2 computeStepReadiness
// ---------------------------------------------------------------------------

/**
 * Determine whether a step is ready to dispatch, waiting, or permanently
 * skipped, given the current status of its direct ancestors.
 *
 * Rules:
 *   - Root step (no dependsOn) → 'ready'
 *   - Any ancestor has no row yet (undefined) → 'waiting'
 *   - Any ancestor is pending / running / awaiting_* → 'waiting'
 *   - Every ancestor is 'skipped' → 'skipped'
 *   - Every ancestor is terminal AND at least one is 'completed' → 'ready'
 *   - Every ancestor is terminal but none is 'completed' (all failed/cancelled)
 *     → 'waiting' (failure propagation handled by the engine's main loop)
 *
 * This generalises the existing "all dependsOn completed" readiness rule.
 * Non-decision DAGs behave identically because they never produce 'skipped'.
 */
export function computeStepReadiness(
  step: WorkflowStep,
  stepRunStatusesByStepId: ReadonlyMap<string, StepRunStatus>,
): StepReadiness {
  if (step.dependsOn.length === 0) {
    // Root step — always ready at dispatch time.
    return 'ready';
  }

  let allSkipped = true;
  let anyCompleted = false;
  let allTerminal = true;

  for (const ancId of step.dependsOn) {
    const status = stepRunStatusesByStepId.get(ancId);
    if (status === undefined) {
      // Ancestor step run not yet created → still pending.
      allTerminal = false;
      allSkipped = false;
      continue;
    }
    if (
      status === 'pending' ||
      status === 'running' ||
      status === 'awaiting_input' ||
      status === 'awaiting_approval' ||
      status === 'awaiting_hitl'
    ) {
      allTerminal = false;
      allSkipped = false;
    }
    if (status !== 'skipped') {
      allSkipped = false;
    }
    if (status === 'completed') {
      anyCompleted = true;
    }
  }

  if (!allTerminal) return 'waiting';
  if (allSkipped) return 'skipped';
  if (anyCompleted) return 'ready';
  // All terminal but no completed (all failed/cancelled) — let the engine handle it.
  return 'waiting';
}

// ---------------------------------------------------------------------------
// 24.3 parseDecisionOutput
// ---------------------------------------------------------------------------

/**
 * Parse a raw LLM output string into a validated AgentDecisionOutput.
 * Returns a discriminated result — never throws.
 *
 * Validation order:
 *   1. Strip leading/trailing whitespace and common wrapping (code blocks, prose preamble).
 *   2. Parse JSON. Fail with 'invalid_json' if malformed.
 *   3. Validate against the base Zod schema. Fail with 'schema_violation' if mismatched.
 *   4. Validate chosenBranchId is one of step.branches[*].id. Fail with 'unknown_branch'.
 *   5. Return { ok: true, output }.
 */
export function parseDecisionOutput(
  raw: string,
  step: AgentDecisionStep,
): DecisionParseResult {
  const stripped = stripJsonWrapping(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'invalid_json',
        message: `Failed to parse JSON: ${(err as Error).message}`,
        detail: { raw: truncate(raw, 500) },
      },
    };
  }

  const baseResult = agentDecisionOutputBaseSchema.safeParse(parsed);
  if (!baseResult.success) {
    return {
      ok: false,
      error: {
        code: 'schema_violation',
        message: baseResult.error.issues.map((i: { message: string }) => i.message).join('; '),
        detail: { issues: baseResult.error.issues },
      },
    };
  }

  const output = baseResult.data as AgentDecisionOutput;

  const validBranchIds = new Set(step.branches.map((b) => b.id));
  if (!validBranchIds.has(output.chosenBranchId)) {
    return {
      ok: false,
      error: {
        code: 'unknown_branch',
        message: `chosenBranchId '${output.chosenBranchId}' is not one of [${step.branches
          .map((b) => b.id)
          .join(', ')}]`,
        detail: { validBranchIds: Array.from(validBranchIds) },
      },
    };
  }

  return { ok: true, output };
}

/**
 * Strip common LLM output wrapping patterns before JSON parsing.
 * - Remove leading / trailing whitespace.
 * - Remove a single wrapping ```json ... ``` or ``` ... ``` fence.
 * - Remove leading prose before the first '{'.
 * - Remove trailing prose after the last '}'.
 */
function stripJsonWrapping(raw: string): string {
  let s = raw.trim();

  // Strip code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = s.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) s = fenceMatch[1]!.trim();

  // Strip leading prose before the first '{'
  const firstBrace = s.indexOf('{');
  if (firstBrace > 0) s = s.slice(firstBrace);

  // Strip trailing prose after the last '}'
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace !== -1 && lastBrace < s.length - 1) {
    s = s.slice(0, lastBrace + 1);
  }

  return s;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '\u2026';
}

// ---------------------------------------------------------------------------
// 24.4 validateDecisionStep
// ---------------------------------------------------------------------------

/**
 * Validate a single decision step in the context of the full playbook.
 * Pure, no DB access. Called by the publish-path validator and by the
 * runtime dispatcher as a belt-and-braces check.
 *
 * Returns the canonical ValidationResult shape used by the rest of the codebase.
 */
export function validateDecisionStep(
  step: AgentDecisionStep,
  definition: WorkflowDefinition,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Branch count
  if (!step.branches || step.branches.length < 2) {
    errors.push({
      rule: 'decision_branches_too_few',
      stepId: step.id,
      message: `Decision step requires at least 2 branches; has ${step.branches?.length ?? 0}`,
    });
  } else if (step.branches.length > 8) {
    errors.push({
      rule: 'decision_branches_too_many',
      stepId: step.id,
      message: `Phase 1 caps branches at 8; has ${step.branches.length}`,
    });
  }

  // Branch ids unique
  const branchIds = new Set<string>();
  for (const branch of step.branches ?? []) {
    if (branchIds.has(branch.id)) {
      errors.push({
        rule: 'decision_branch_duplicate_id',
        stepId: step.id,
        message: `Duplicate branch id: '${branch.id}'`,
      });
    }
    branchIds.add(branch.id);
  }

  // Side effect type — must be 'none'
  if (step.sideEffectType !== 'none') {
    errors.push({
      rule: 'decision_side_effect_not_none',
      stepId: step.id,
      message: `Decision steps MUST have sideEffectType='none'; got '${step.sideEffectType}'`,
    });
  }

  // defaultBranchId — must match a declared branch if set
  if (step.defaultBranchId !== undefined && !branchIds.has(step.defaultBranchId)) {
    errors.push({
      rule: 'decision_default_branch_invalid',
      stepId: step.id,
      message: `defaultBranchId '${step.defaultBranchId}' does not match any declared branch`,
    });
  }

  // minConfidence — must be in [0, 1] if set
  if (
    step.minConfidence !== undefined &&
    (step.minConfidence < 0 || step.minConfidence > 1)
  ) {
    errors.push({
      rule: 'decision_min_confidence_out_of_range',
      stepId: step.id,
      message: `minConfidence must be in [0, 1]; got ${step.minConfidence}`,
    });
  }

  // Entry step existence + dependsOn correctness + collision
  const allStepsById = new Map(definition.steps.map((s) => [s.id, s]));
  const entryStepOwnership = new Map<string, string>(); // entryStepId → owning branch id

  for (const branch of step.branches ?? []) {
    if (!branch.entrySteps || branch.entrySteps.length === 0) {
      errors.push({
        rule: 'decision_branch_no_entry_steps',
        stepId: step.id,
        message: `Branch '${branch.id}' has no entry steps`,
      });
      continue;
    }
    for (const entryStepId of branch.entrySteps) {
      const entryStep = allStepsById.get(entryStepId);
      if (!entryStep) {
        errors.push({
          rule: 'decision_entry_step_not_found',
          stepId: step.id,
          message: `Entry step '${entryStepId}' on branch '${branch.id}' does not exist in the playbook`,
        });
        continue;
      }
      if (!entryStep.dependsOn.includes(step.id)) {
        errors.push({
          rule: 'decision_entry_step_missing_dep',
          stepId: step.id,
          message: `Entry step '${entryStepId}' on branch '${branch.id}' must include '${step.id}' in its dependsOn`,
        });
      }
      const previousOwner = entryStepOwnership.get(entryStepId);
      if (previousOwner !== undefined) {
        errors.push({
          rule: 'decision_branch_entry_collision',
          stepId: step.id,
          message: `Entry step '${entryStepId}' is claimed by both '${previousOwner}' and '${branch.id}'`,
        });
      } else {
        entryStepOwnership.set(entryStepId, branch.id);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// 24.5 renderBranchesTable
// ---------------------------------------------------------------------------

/**
 * Render the branches as a markdown bullet list for inclusion in the
 * decision envelope. Pure, deterministic.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §17.3.
 */
export function renderBranchesTable(
  branches: readonly AgentDecisionBranch[],
): string {
  return branches
    .map(
      (b) =>
        `- **id:** \`${escapeMarkdownInline(b.id)}\`\n` +
        `  **label:** ${escapeMarkdownInline(b.label)}\n` +
        `  **description:** ${escapeMarkdownInline(b.description)}`,
    )
    .join('\n\n');
}

/**
 * Escape inline markdown-breaking characters. This is not a full sanitiser —
 * it protects against accidental formatting breaks. Authors are trusted (§22.2).
 *
 * - Triple-backticks: split with a zero-width space to break the fence.
 * - Level-2 headings at line start: escaped so the envelope's own ## headings
 *   are not confused with injected headings.
 */
function escapeMarkdownInline(s: string): string {
  return s
    .replace(/```/g, '``\u200b`') // zero-width space between backticks
    .replace(/^## /gm, '\\## '); // escape level-2 headings
}
