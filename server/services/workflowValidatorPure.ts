/**
 * Publish-time workflow template validator (V1 rules).
 *
 * Pure function — no DB imports. Checks a WorkflowDefinition against the
 * eight V1 rules and returns all errors at once (collect-all, not
 * first-error-fail).
 *
 * Spec: tasks/workflows-spec.md §4.1–§4.8 (Chunk 2).
 *
 * Used by:
 *   - workflowTemplateService.publishOrgTemplate() / upsertSystemTemplate()
 *     before any INSERT or UPDATE to a template version row.
 */

import type { ValidatorError, ValidatorResult } from '../../shared/types/workflowValidator.js';

// ─── Inline types ─────────────────────────────────────────────────────────────

/**
 * Minimal step shape the validator operates on. Deliberately looser than
 * WorkflowStep (which requires ZodSchema instances for outputSchema) so the
 * validator can be called with plain JSON objects (e.g. after deserialising
 * from the DB or from the Studio HTTP payload).
 */
export interface WorkflowStepDefinition {
  id: string;
  type: string;
  params?: Record<string, unknown>;
  /** Single target id or array of target ids. */
  onSuccess?: string | string[];
  onFail?: string;
  onReject?: string;
  dependsOn?: string[];
}

export interface WorkflowDefinition {
  steps: WorkflowStepDefinition[];
}

export interface ValidateOptions {
  /**
   * When true, the legacy engine type names (agent_call, action_call,
   * user_input, prompt, conditional, agent_decision, invoke_automation)
   * are accepted in addition to the V1 user-facing names.
   *
   * Set to true for:
   *   - System templates (shipped as files with engine names)
   *   - Org templates being updated (may still carry engine names from a fork)
   *
   * Set to false (default) for fresh Studio publishes.
   */
  acceptLegacyTypes?: boolean;
}

// ─── Type vocabulary ──────────────────────────────────────────────────────────

/** V1 user-facing ("four A's") step type names. */
const V1_USER_TYPES = new Set<string>(['agent', 'action', 'approval', 'ask']);

/** Engine / legacy type names accepted when acceptLegacyTypes === true. */
const LEGACY_ENGINE_TYPES = new Set<string>([
  'agent_call',
  'action_call',
  'user_input',
  'prompt',
  'conditional',
  'agent_decision',
  'invoke_automation',
]);

/** All step types that represent an "agent" or "action" (eligible for is_critical). */
const AGENT_OR_ACTION_TYPES = new Set<string>([
  'agent',
  'agent_call',
  'action',
  'action_call',
  'prompt',
  'invoke_automation',
]);

/** All step types that are "approval"-flavoured (allow backward edges). */
const APPROVAL_TYPES = new Set<string>(['approval', 'user_input']);

/** All step types that are "ask"-flavoured (user input, single-submit enforced). */
const ASK_TYPES = new Set<string>(['ask', 'user_input']);

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Validate a WorkflowDefinition against V1 publish-time rules.
 *
 * Runs all 8 rules and returns every violation; never short-circuits.
 *
 * @param definition  The workflow definition to validate.
 * @param options     `acceptLegacyTypes` — see ValidateOptions.
 * @returns ValidatorResult — `ok: true` iff no errors.
 */
export function validate(
  definition: WorkflowDefinition,
  options: ValidateOptions = {}
): ValidatorResult {
  const { acceptLegacyTypes = false } = options;
  const errors: ValidatorError[] = [];

  const steps = definition.steps ?? [];

  // Build an index of step ids for O(1) lookups.
  const stepIds = new Set<string>(steps.map((s) => s.id));

  // Build a step-index map for backward-edge detection (rule 4).
  const stepIndex = new Map<string, number>();
  steps.forEach((s, i) => stepIndex.set(s.id, i));

  // ── Rule 1: four_as_vocabulary ────────────────────────────────────────────
  for (const step of steps) {
    const isV1 = V1_USER_TYPES.has(step.type);
    const isLegacy = LEGACY_ENGINE_TYPES.has(step.type);
    const accepted = isV1 || (acceptLegacyTypes && isLegacy);
    if (!accepted) {
      errors.push({
        rule: 'four_as_vocabulary',
        stepId: step.id,
        message: acceptLegacyTypes
          ? `step '${step.id}' has unrecognised type '${step.type}'. Accepted: agent, action, approval, ask, agent_call, action_call, user_input, prompt, conditional, agent_decision, invoke_automation.`
          : `step '${step.id}' has type '${step.type}' which is not a V1 user-facing type. Use one of: agent, action, approval, ask. (Legacy engine names are rejected in Studio publish mode.)`,
        severity: 'error',
      });
    }
  }

  // ── Rule 2: branching_target_exists ──────────────────────────────────────
  for (const step of steps) {
    const targets: Array<{ field: string; id: string }> = [];

    // onSuccess: string | string[]
    if (typeof step.onSuccess === 'string') {
      targets.push({ field: 'onSuccess', id: step.onSuccess });
    } else if (Array.isArray(step.onSuccess)) {
      for (const id of step.onSuccess) {
        targets.push({ field: 'onSuccess', id });
      }
    }
    if (step.onFail) targets.push({ field: 'onFail', id: step.onFail });
    if (step.onReject) targets.push({ field: 'onReject', id: step.onReject });
    if (Array.isArray(step.dependsOn)) {
      for (const id of step.dependsOn) {
        targets.push({ field: 'dependsOn', id });
      }
    }

    for (const { field, id } of targets) {
      if (!stepIds.has(id)) {
        errors.push({
          rule: 'branching_target_exists',
          stepId: step.id,
          message: `step '${step.id}' ${field} references step '${id}' which does not exist in the definition.`,
          severity: 'error',
        });
      }
    }
  }

  // ── Rule 3: parallel_depth ────────────────────────────────────────────────
  // Build a successor map (onSuccess edges only — that's where fan-out
  // lives). Fan-out depth > 2 means: a step has multiple successors where
  // at least one of those successors also has multiple successors.
  const successorsOf = new Map<string, string[]>();
  for (const step of steps) {
    const succ: string[] = [];
    if (typeof step.onSuccess === 'string') succ.push(step.onSuccess);
    else if (Array.isArray(step.onSuccess)) succ.push(...step.onSuccess);
    successorsOf.set(step.id, succ);
  }

  for (const step of steps) {
    const succ = successorsOf.get(step.id) ?? [];
    if (succ.length > 1) {
      // This is a fan-out point (depth 1). Check if any successor is also a
      // fan-out point (depth 2 from here → total depth 3 at the grandchildren).
      for (const childId of succ) {
        const childSucc = successorsOf.get(childId) ?? [];
        if (childSucc.length > 1) {
          errors.push({
            rule: 'parallel_depth',
            stepId: step.id,
            message: `step '${step.id}' fans out to ${succ.length} successors, and successor '${childId}' also fans out to ${childSucc.length} successors. V1 maximum fan-out depth is 2; this path reaches depth 3.`,
            severity: 'error',
          });
          // Report once per origin step, not once per offending child.
          break;
        }
      }
    }
  }

  // ── Rule 4: loop_only_on_approval_reject ──────────────────────────────────
  // Only onReject on approval-type steps may create backward edges (loops).
  // Backward onFail on any step type is rejected — onFail is not a loop
  // primitive. Backward onSuccess is also rejected (covered below).
  for (const step of steps) {
    const currentIdx = stepIndex.get(step.id) ?? 0;

    // onReject backward edge: allowed only on approval-type steps.
    if (step.onReject) {
      const targetIdx = stepIndex.get(step.onReject);
      if (targetIdx !== undefined && targetIdx < currentIdx) {
        if (!APPROVAL_TYPES.has(step.type)) {
          errors.push({
            rule: 'loop_only_on_approval_reject',
            stepId: step.id,
            message: `step '${step.id}' (type '${step.type}') has a backward edge via onReject to '${step.onReject}'. Backward edges are only valid on approval or user_input steps.`,
            severity: 'error',
          });
        }
      }
    }

    // onFail backward edge: rejected on any step type.
    if (step.onFail) {
      const targetIdx = stepIndex.get(step.onFail);
      if (targetIdx !== undefined && targetIdx < currentIdx) {
        errors.push({
          rule: 'loop_only_on_approval_reject',
          stepId: step.id,
          message: `step '${step.id}' (type '${step.type}') has a backward edge via onFail to '${step.onFail}'. onFail is not a valid loop primitive; only onReject on approval/user_input steps may loop.`,
          severity: 'error',
        });
      }
    }
  }

  // ── Rule 5: no_workflow_to_workflow ───────────────────────────────────────
  // Any step type that contains "workflow" (case-insensitive) is rejected.
  for (const step of steps) {
    if (/workflow/i.test(step.type)) {
      errors.push({
        rule: 'no_workflow_to_workflow',
        stepId: step.id,
        message: `step '${step.id}' has type '${step.type}' which contains 'workflow'. Workflow-to-workflow invocation is not supported in V1.`,
        severity: 'error',
      });
    }
  }

  // ── Rule 6: quorum_specific_users ─────────────────────────────────────────
  for (const step of steps) {
    const approverGroup = step.params?.approverGroup as
      | { kind?: unknown; userIds?: unknown; quorum?: unknown }
      | undefined;
    if (approverGroup?.kind === 'specific_users') {
      const userIds = approverGroup.userIds;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        errors.push({
          rule: 'quorum_specific_users',
          stepId: step.id,
          message: `step '${step.id}' has approverGroup.kind === 'specific_users' but userIds is empty. Provide at least one user id.`,
          severity: 'error',
        });
      } else {
        // quorum bounds check: must be between 1 and userIds.length inclusive.
        const quorum = approverGroup.quorum;
        if (quorum !== undefined) {
          if (typeof quorum !== 'number' || quorum < 1) {
            errors.push({
              rule: 'quorum_specific_users',
              stepId: step.id,
              message: `step '${step.id}' approverGroup.quorum must be at least 1 (got ${quorum}).`,
              severity: 'error',
            });
          } else if (quorum > userIds.length) {
            errors.push({
              rule: 'quorum_specific_users',
              stepId: step.id,
              message: `step '${step.id}' approverGroup.quorum (${quorum}) exceeds the number of specific users (${userIds.length}). Quorum must be between 1 and userIds.length inclusive.`,
              severity: 'error',
            });
          }
        }
      }
    }
  }

  // ── Rule 7: is_critical_only_on_agent_action ──────────────────────────────
  for (const step of steps) {
    if (step.params?.is_critical === true && !AGENT_OR_ACTION_TYPES.has(step.type)) {
      errors.push({
        rule: 'is_critical_only_on_agent_action',
        stepId: step.id,
        message: `step '${step.id}' (type '${step.type}') has params.is_critical: true, which is only valid on agent, action, agent_call, action_call, prompt, or invoke_automation steps.`,
        severity: 'error',
      });
    }
  }

  // ── Rule 8: ask_single_submit ─────────────────────────────────────────────
  for (const step of steps) {
    if (ASK_TYPES.has(step.type)) {
      const submitterGroup = step.params?.submitterGroup as
        | { quorum?: unknown }
        | undefined;
      const quorum = submitterGroup?.quorum;
      if (typeof quorum === 'number' && quorum > 1) {
        errors.push({
          rule: 'ask_single_submit',
          stepId: step.id,
          message: `step '${step.id}' (type '${step.type}') has params.submitterGroup.quorum > 1 (got ${quorum}). V1 enforces single-submit for ask/user_input steps.`,
          severity: 'error',
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
