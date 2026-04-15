/**
 * Playbook DAG validator.
 *
 * Spec: tasks/playbooks-spec.md §4.
 *
 * Implements all 13 rules from §4.1 plus the cycle detection algorithm
 * from §4.3 and template-reference checking from §4.4. Pure function —
 * no DB access. Used by:
 *
 *   - The seeder when loading a system template file.
 *   - playbookTemplateService.publishOrgTemplate() at publish time.
 *   - playbookRunService.startRun() as a defense-in-depth check at run
 *     start (catches schema drift between publish and start).
 *   - The Playbook Studio `validate_candidate` tool.
 *
 * Returns a structured ValidationResult — never throws on validation
 * failure. Throws only on programmer errors (e.g. invalid input shape).
 */

import type {
  PlaybookDefinition,
  PlaybookStep,
  ValidationError,
  ValidationResult,
  AgentDecisionStep,
} from './types.js';
import { extractReferences, TemplatingError } from './templating.js';
import { validateDecisionStep } from './agentDecisionPure.js';
import { MAX_DECISION_BRANCHES_PER_STEP } from '../../config/limits.js';
import {
  isActionCallSlugAllowed,
  isSingletonResourceAction,
  isReadOnlyAction,
} from './actionCallAllowlist.js';

/** Matches the Memory Block label format (§8.3). */
const KNOWLEDGE_BLOCK_LABEL_RE = /^[a-zA-Z0-9 _-]{1,80}$/;

/** Matches a dot-separated output path, optionally with array indices. */
const KNOWLEDGE_OUTPUT_PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:(?:\.[a-zA-Z_][a-zA-Z0-9_]*)|(?:\[\d+\]))*$/;

export const MAX_DAG_DEPTH = 50;

// Step id format. The rule is HISTORICALLY named "kebab_case" (and the
// rule name is preserved in the ValidationError discriminator union for
// backwards-compat with tests + error catalogues), but the regex
// actually allows underscores and disallows hyphens — i.e. it enforces
// snake_case style identifiers like `event_basics`, `landing_page_hero`.
//
// Spec §0.1 (naming conventions table) explicitly documents this:
//   "Step ids inside a playbook definition | kebab_case (lowercase, _
//    allowed, kebab convention enforced by validator regex
//    ^[a-z][a-z0-9_]*$) | event_basics, landing_page_hero"
//
// Template SLUGS (filename / DB) are kebab-case with hyphens — that's a
// different namespace. Don't confuse the two.
//
// If you change this regex, every existing playbook breaks. Don't.
const STEP_ID_RE = /^[a-z][a-z0-9_]*$/;
// Backwards-compat alias.
const KEBAB_CASE_RE = STEP_ID_RE;

/**
 * Validates a playbook definition. Optionally cross-checks against the
 * previous published version number to enforce monotonicity (§4.1 rule 11).
 */
export function validateDefinition(
  def: PlaybookDefinition,
  options?: { previousVersion?: number }
): ValidationResult {
  const errors: ValidationError[] = [];

  // ── Rule 1: unique step ids ────────────────────────────────────────────
  const seenIds = new Set<string>();
  for (const step of def.steps) {
    if (seenIds.has(step.id)) {
      errors.push({
        rule: 'unique_id',
        stepId: step.id,
        message: `duplicate step id '${step.id}'`,
      });
    }
    seenIds.add(step.id);
  }

  // ── Rule 2: step id format (rule name "kebab_case" is historical;
  // ──         see STEP_ID_RE comment — actually enforces snake_case)
  for (const step of def.steps) {
    if (!STEP_ID_RE.test(step.id)) {
      errors.push({
        rule: 'kebab_case',
        stepId: step.id,
        message: `step id '${step.id}' must use lowercase letters, digits, and underscores (regex ${STEP_ID_RE.source}). Examples: event_basics, landing_page_hero. Hyphens are NOT allowed in step ids — they are reserved for template slugs (filenames + DB).`,
      });
    }
  }

  // ── Rule 3: dependsOn entries resolve ──────────────────────────────────
  const stepById = new Map<string, PlaybookStep>();
  for (const step of def.steps) stepById.set(step.id, step);
  for (const step of def.steps) {
    for (const dep of step.dependsOn) {
      if (!stepById.has(dep)) {
        errors.push({
          rule: 'unresolved_dep',
          stepId: step.id,
          message: `step '${step.id}' depends on unknown step '${dep}'`,
        });
      }
    }
  }

  // ── Rule 4: no cycles (Kahn's algorithm) ───────────────────────────────
  const cycleCheck = detectCycle(def.steps);
  if (cycleCheck) {
    errors.push({
      rule: 'cycle',
      path: cycleCheck.join(' -> '),
      message: `cycle detected: ${cycleCheck.join(' -> ')}`,
    });
  }

  // ── Rule 5: topological reachability (no orphans) + Rule 6: entry exists
  const entrySteps = def.steps.filter((s) => s.dependsOn.length === 0);
  if (entrySteps.length === 0) {
    errors.push({
      rule: 'missing_entry',
      message: 'definition has no entry steps (all steps have dependencies)',
    });
  } else if (!cycleCheck) {
    // Only check reachability if there's no cycle (otherwise BFS would loop).
    const reachable = computeReachableSet(def.steps, entrySteps);
    for (const step of def.steps) {
      if (!reachable.has(step.id)) {
        errors.push({
          rule: 'orphan',
          stepId: step.id,
          message: `step '${step.id}' is not reachable from any entry step`,
        });
      }
    }
  }

  // ── Rules 7, 8, 9, 12 (per-step) ───────────────────────────────────────
  for (const step of def.steps) {
    // Rule 9: outputSchema present
    if (!step.outputSchema) {
      errors.push({
        rule: 'missing_output_schema',
        stepId: step.id,
        message: `step '${step.id}' is missing outputSchema (REQUIRED for every step type)`,
      });
    }

    // Rule (mandatory): sideEffectType present
    if (!step.sideEffectType) {
      errors.push({
        rule: 'missing_side_effect_type',
        stepId: step.id,
        message: `step '${step.id}' is missing sideEffectType (one of: none, idempotent, reversible, irreversible)`,
      });
    }

    // Rule 8: type-specific required fields
    switch (step.type) {
      case 'prompt':
        if (!step.prompt) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `prompt step '${step.id}' must declare a prompt`,
          });
        }
        break;
      case 'agent_call':
        if (!step.agentRef) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `agent_call step '${step.id}' must declare agentRef`,
          });
        }
        break;
      case 'user_input':
        if (!step.formSchema) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `user_input step '${step.id}' must declare formSchema`,
          });
        }
        break;
      case 'approval':
        // approvalPrompt is optional but recommended; no hard rule
        break;
      case 'conditional':
        if (step.condition === undefined) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `conditional step '${step.id}' must declare a condition`,
          });
        }
        break;
      case 'agent_decision':
        if (!step.decisionPrompt) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `agent_decision step '${step.id}' must declare decisionPrompt`,
          });
        }
        if (!step.agentRef) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `agent_decision step '${step.id}' must declare agentRef`,
          });
        }
        if (!step.branches || step.branches.length === 0) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `agent_decision step '${step.id}' must declare branches`,
          });
        }
        break;
      case 'action_call':
        if (!step.actionSlug) {
          errors.push({
            rule: 'missing_field',
            stepId: step.id,
            message: `action_call step '${step.id}' must declare actionSlug`,
          });
        } else {
          if (!isActionCallSlugAllowed(step.actionSlug)) {
            errors.push({
              rule: 'action_slug_not_allowed',
              stepId: step.id,
              message: `action_call step '${step.id}' references action '${step.actionSlug}', which is not on the action_call allowlist. See server/lib/playbook/actionCallAllowlist.ts.`,
            });
          }
          if (
            isSingletonResourceAction(step.actionSlug) &&
            step.idempotencyScope !== 'entity'
          ) {
            errors.push({
              rule: 'entity_idempotency_required',
              stepId: step.id,
              message: `action_call step '${step.id}' calls '${step.actionSlug}' which creates a singleton resource. Set idempotencyScope: 'entity' and provide entityKey to prevent duplicate creation across runs.`,
            });
          }
          if (step.idempotencyScope === 'entity' && !step.entityKey) {
            errors.push({
              rule: 'missing_field',
              stepId: step.id,
              message: `action_call step '${step.id}' has idempotencyScope: 'entity' but no entityKey. Provide a stable identifier like 'task:\${subaccountId}:\${taskSlug}'.`,
            });
          }
          // sideEffectType cross-check (§4.4 / §4.10)
          if (step.sideEffectType) {
            const isRead = isReadOnlyAction(step.actionSlug);
            if (
              isRead &&
              step.sideEffectType !== 'none' &&
              step.sideEffectType !== 'idempotent'
            ) {
              errors.push({
                rule: 'action_side_effect_mismatch',
                stepId: step.id,
                message: `action_call step '${step.id}' calls read-only action '${step.actionSlug}' but declares sideEffectType '${step.sideEffectType}'. Use 'none' or 'idempotent'.`,
              });
            }
            if (
              !isRead &&
              step.sideEffectType !== 'reversible' &&
              step.sideEffectType !== 'irreversible' &&
              step.sideEffectType !== 'idempotent'
            ) {
              errors.push({
                rule: 'action_side_effect_mismatch',
                stepId: step.id,
                message: `action_call step '${step.id}' calls mutating action '${step.actionSlug}' but declares sideEffectType '${step.sideEffectType}'. Use 'reversible', 'irreversible', or 'idempotent'.`,
              });
            }
          }
        }
        break;
    }

    // ── referenceBinding validation (§G8) ────────────────────────────────────
    if (step.referenceBinding) {
      if (step.type !== 'user_input') {
        errors.push({
          rule: 'reference_binding_wrong_step_type',
          stepId: step.id,
          message: `referenceBinding is only valid on user_input steps; step '${step.id}' has type '${step.type}'`,
        });
      } else if (step.formSchema) {
        // Best-effort field presence check. We only inspect the schema's
        // top-level shape when it exposes one (ZodObject) — deeper paths
        // are not supported in v1.
        const schema = step.formSchema as unknown as {
          _def?: { shape?: () => Record<string, unknown>; typeName?: string };
          shape?: Record<string, unknown>;
        };
        const shape =
          typeof schema._def?.shape === 'function'
            ? schema._def.shape()
            : schema.shape;
        if (shape && typeof shape === 'object' && !(step.referenceBinding.field in shape)) {
          errors.push({
            rule: 'reference_binding_field_not_in_schema',
            stepId: step.id,
            message: `referenceBinding.field '${step.referenceBinding.field}' is not present in step '${step.id}' formSchema`,
          });
        }
      }
    }

    // Rule 12: irreversible steps cannot have retryPolicy.maxAttempts > 1
    if (step.sideEffectType === 'irreversible') {
      const max = step.retryPolicy?.maxAttempts;
      if (max !== undefined && max > 1) {
        errors.push({
          rule: 'irreversible_with_retries',
          stepId: step.id,
          message: `irreversible step '${step.id}' cannot have retryPolicy.maxAttempts > 1 (got ${max})`,
        });
      }
    }
  }

  // ── Decision step validation (agent_decision rules) ───────────────────────
  // Delegate to the pure helper for rule-by-rule checks. The helper returns
  // errors using the canonical ValidationError shape (rule, stepId, message).
  for (const step of def.steps) {
    if (step.type !== 'agent_decision') continue;
    // Belt-and-braces check — the per-step loop above already validated required
    // fields. Run the full decision-step pure validator for all 10 decision rules.
    const decisionResult = validateDecisionStep(step as AgentDecisionStep, def);
    if (!decisionResult.ok) {
      for (const err of decisionResult.errors) {
        errors.push(err);
      }
    }
  }

  // ── Rule 7: template expression references ─────────────────────────────
  // Each `{{ ... }}` reference must be parseable, must reference a step
  // listed in dependsOn (no transitive deps), and the namespace must be
  // permitted. We don't validate the path against the referenced step's
  // outputSchema in Phase 1 — that requires Zod introspection that doesn't
  // round-trip cleanly through ZodTransform / ZodUnion. The path is
  // validated at runtime by the resolver.
  for (const step of def.steps) {
    const refSources: string[] = [];
    if (step.prompt) refSources.push(step.prompt);
    if (step.decisionPrompt) refSources.push(step.decisionPrompt);
    if (step.agentInputs) {
      for (const v of Object.values(step.agentInputs)) {
        if (typeof v === 'string') refSources.push(v);
      }
    }
    if (step.actionInputs) {
      for (const v of Object.values(step.actionInputs)) {
        if (typeof v === 'string') refSources.push(v);
      }
    }
    for (const source of refSources) {
      let refs;
      try {
        refs = extractReferences(source);
      } catch (err) {
        if (err instanceof TemplatingError) {
          errors.push({
            rule: 'unresolved_template_ref',
            stepId: step.id,
            message: `step '${step.id}' has invalid expression '${err.expression}': ${err.message}`,
          });
          continue;
        }
        throw err;
      }
      for (const ref of refs) {
        if (ref.namespace === 'steps' && ref.stepId) {
          if (!step.dependsOn.includes(ref.stepId)) {
            errors.push({
              rule: 'transitive_dep',
              stepId: step.id,
              message: `step '${step.id}' references 'steps.${ref.stepId}.output.${ref.path.join('.')}' but does not list '${ref.stepId}' in dependsOn`,
            });
          }
          if (!stepById.has(ref.stepId)) {
            errors.push({
              rule: 'unresolved_template_ref',
              stepId: step.id,
              message: `step '${step.id}' references nonexistent step '${ref.stepId}'`,
            });
          }
        }
      }
    }
  }

  // ── Knowledge bindings (onboarding-playbooks-spec §8.3) ──────────────────
  if (def.knowledgeBindings && def.knowledgeBindings.length > 0) {
    const seenLabels = new Set<string>();
    for (const binding of def.knowledgeBindings) {
      const sourceStep = stepById.get(binding.stepId);
      if (!sourceStep) {
        errors.push({
          rule: 'knowledge_binding_step_not_found',
          message: `knowledgeBinding references step '${binding.stepId}' which does not exist in steps[]`,
        });
        continue;
      }
      if (!binding.blockLabel || !KNOWLEDGE_BLOCK_LABEL_RE.test(binding.blockLabel)) {
        errors.push({
          rule: 'knowledge_binding_invalid_label',
          message: `knowledgeBinding blockLabel '${binding.blockLabel}' must be 1-80 chars matching [a-zA-Z0-9 _-]`,
        });
      } else if (seenLabels.has(binding.blockLabel)) {
        errors.push({
          rule: 'knowledge_binding_duplicate_label',
          message: `knowledgeBinding duplicate blockLabel '${binding.blockLabel}' (labels must be unique within a definition)`,
        });
      } else {
        seenLabels.add(binding.blockLabel);
      }
      if (!binding.outputPath || !KNOWLEDGE_OUTPUT_PATH_RE.test(binding.outputPath)) {
        errors.push({
          rule: 'knowledge_binding_invalid_output_path',
          message: `knowledgeBinding outputPath '${binding.outputPath}' is invalid (must be dot-notation like 'result.summary' or 'items[0].name')`,
        });
      }
      // 'merge' strategy requires object-typed output — best-effort introspection
      if (binding.mergeStrategy === 'merge' && sourceStep.outputSchema) {
        const schema = sourceStep.outputSchema as unknown as {
          _def?: { typeName?: string };
        };
        const typeName = schema._def?.typeName;
        // ZodObject is the only shape where merge is well-defined. We don't
        // fail on ZodAny (too restrictive) — only on explicit non-object types
        // we can recognise.
        if (
          typeName === 'ZodString' ||
          typeName === 'ZodNumber' ||
          typeName === 'ZodBoolean' ||
          typeName === 'ZodArray' ||
          typeName === 'ZodNull'
        ) {
          errors.push({
            rule: 'knowledge_binding_merge_requires_object',
            message: `knowledgeBinding for step '${binding.stepId}' uses mergeStrategy: 'merge' but the step's outputSchema is '${typeName}', not an object`,
          });
        }
      }
    }
  }

  // ── Portal presentation (§9.4 / §11.5) ───────────────────────────────────
  if (def.portalPresentation) {
    if (!stepById.has(def.portalPresentation.headlineStepId)) {
      errors.push({
        rule: 'portal_presentation_step_not_found',
        message: `portalPresentation.headlineStepId '${def.portalPresentation.headlineStepId}' does not exist in steps[]`,
      });
    }
  }

  // ── Rule 11: version monotonicity ──────────────────────────────────────
  if (options?.previousVersion !== undefined && def.version <= options.previousVersion) {
    errors.push({
      rule: 'version_not_monotonic',
      message: `version ${def.version} must be greater than previous published version ${options.previousVersion}`,
    });
  }

  // ── Rule 13: max DAG depth ─────────────────────────────────────────────
  if (!cycleCheck) {
    const depth = computeLongestPath(def.steps);
    if (depth > MAX_DAG_DEPTH) {
      errors.push({
        rule: 'max_dag_depth_exceeded',
        message: `longest path through DAG is ${depth} steps (max ${MAX_DAG_DEPTH})`,
      });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─── Cycle detection (Kahn's algorithm) ──────────────────────────────────────

/**
 * Returns a cycle path if one exists, otherwise undefined. Uses Kahn's
 * algorithm to peel off entry steps; any nodes that remain unpeeled are
 * part of a cycle. We then DFS from one of them to materialise a concrete
 * cycle for the error message.
 */
function detectCycle(steps: PlaybookStep[]): string[] | undefined {
  const stepById = new Map<string, PlaybookStep>();
  const inDegree = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();
  for (const s of steps) {
    stepById.set(s.id, s);
    inDegree.set(s.id, 0);
    childrenOf.set(s.id, []);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (!stepById.has(dep)) continue; // unresolved_dep already reported
      inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      childrenOf.get(dep)!.push(s.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      const next = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, next);
      if (next === 0) queue.push(child);
    }
  }

  if (visited.size === steps.length) return undefined;

  // Cycle exists. DFS from any unvisited node to materialise it.
  const unvisited = steps.find((s) => !visited.has(s.id));
  if (!unvisited) return undefined;
  return findCyclePath(unvisited.id, stepById);
}

function findCyclePath(start: string, stepById: Map<string, PlaybookStep>): string[] {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): string[] | undefined {
    visited.add(id);
    stack.push(id);
    onStack.add(id);
    const step = stepById.get(id);
    if (step) {
      for (const dep of step.dependsOn) {
        if (onStack.has(dep)) {
          // Found a cycle: trim stack to start of the cycle.
          const startIdx = stack.indexOf(dep);
          return stack.slice(startIdx).concat(dep);
        }
        if (!visited.has(dep)) {
          const cycle = dfs(dep);
          if (cycle) return cycle;
        }
      }
    }
    stack.pop();
    onStack.delete(id);
    return undefined;
  }

  return dfs(start) ?? [start];
}

// ─── Reachability (rule 5) ───────────────────────────────────────────────────

function computeReachableSet(
  steps: PlaybookStep[],
  entries: PlaybookStep[]
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const s of steps) childrenOf.set(s.id, []);
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (childrenOf.has(dep)) childrenOf.get(dep)!.push(s.id);
    }
  }
  const reachable = new Set<string>();
  const queue: string[] = entries.map((e) => e.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      queue.push(child);
    }
  }
  return reachable;
}

// ─── Longest path (rule 13) ──────────────────────────────────────────────────

function computeLongestPath(steps: PlaybookStep[]): number {
  // Topological order, then DP on incoming edges.
  const stepById = new Map<string, PlaybookStep>();
  for (const s of steps) stepById.set(s.id, s);

  // Compute topological order via DFS post-order.
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const step = stepById.get(id);
    if (step) {
      for (const dep of step.dependsOn) {
        visit(dep);
      }
    }
    order.push(id);
  }

  for (const s of steps) visit(s.id);

  // DP: longest path ending at each node = 1 + max(longest of deps).
  const longest = new Map<string, number>();
  for (const id of order) {
    const step = stepById.get(id);
    if (!step) continue;
    let max = 0;
    for (const dep of step.dependsOn) {
      max = Math.max(max, longest.get(dep) ?? 0);
    }
    longest.set(id, 1 + max);
  }

  let result = 0;
  for (const v of longest.values()) result = Math.max(result, v);
  return result;
}
