/**
 * Zod schemas for agent_decision step output validation.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §9.
 *
 * This module is intentionally pure — no DB, no env, no I/O. It is imported
 * by agentDecisionPure.ts (runtime validation) and the test suite directly.
 *
 * Two-schema layering:
 *   1. `agentDecisionOutputBaseSchema` — the mandatory contract the engine
 *      enforces regardless of what the step author declares.
 *   2. `composeDecisionOutputSchema()` — merges the base with an optional
 *      author-supplied extra schema for additional output fields.
 *
 * `decisionStepRunOutputSchema` is the shape persisted to
 * `playbook_step_runs.output_json` after engine post-processing.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Branch schema — mirrors AgentDecisionBranch from types.ts but as a Zod
// schema so it can be used at runtime without importing the TS type.
// ---------------------------------------------------------------------------

export const agentDecisionBranchSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'branch id must match [a-z0-9_-]+'),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  entrySteps: z.array(z.string().min(1)).min(1),
});

export type AgentDecisionBranchValidated = z.infer<typeof agentDecisionBranchSchema>;

// ---------------------------------------------------------------------------
// Agent output schema — what the agent must return in its final message
// ---------------------------------------------------------------------------

/**
 * Minimum output required from the agent for every `agent_decision` step.
 *
 * Fields:
 *   - `chosenBranchId`: must match one of the branch ids declared on the step
 *   - `rationale`:      non-empty explanation (enforced by engine, not just linting)
 *   - `confidence`:     optional 0–1 float; absent → engine treats as 1.0
 *
 * `.passthrough()` allows the agent to emit extra fields without triggering
 * a schema violation — `composeDecisionOutputSchema` merges extra constraints
 * on top for steps that declare `outputSchema`.
 */
export const agentDecisionOutputBaseSchema = z
  .object({
    chosenBranchId: z.string().min(1, 'chosenBranchId is required'),
    rationale: z.string().min(1, 'rationale is required'),
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export type AgentDecisionOutput = z.infer<typeof agentDecisionOutputBaseSchema>;

/**
 * Compose the base schema with an optional author-supplied extra schema.
 * The author schema is intersected (not merged) so both constraints must pass.
 */
export function composeDecisionOutputSchema(authorExtra?: z.ZodTypeAny): z.ZodTypeAny {
  if (!authorExtra) return agentDecisionOutputBaseSchema;
  return z.intersection(agentDecisionOutputBaseSchema, authorExtra);
}

// ---------------------------------------------------------------------------
// Step run output schema — what the engine writes to playbook_step_runs.output_json
// ---------------------------------------------------------------------------

/**
 * Superset of AgentDecisionOutput with engine-computed fields added after the
 * decision is resolved. This is the canonical shape stored in the DB row.
 */
export const decisionStepRunOutputSchema = agentDecisionOutputBaseSchema.extend({
  /** All step ids the engine marked as `skipped` as a result of this decision. */
  skippedStepIds: z.array(z.string()),
  /** How many times the agent run was retried before a valid output was produced. */
  retryCount: z.number().int().min(0),
  /** True when the chosen branch was selected by the agent (vs. a human override or default). */
  chosenByAgent: z.boolean(),
});

export type DecisionStepRunOutput = z.infer<typeof decisionStepRunOutputSchema>;
