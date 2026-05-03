/**
 * studioCanvasPure.ts — pure layout helpers for the Studio canvas.
 *
 * No React, no DOM, no side effects. All functions are deterministic given
 * their inputs and are covered by __tests__/studioCanvasPure.test.ts.
 *
 * Spec: tasks/Workflows-spec.md §10.1, §10.2.
 */

// ─── Cost defaults (mirrored from server/lib/workflow/costEstimationDefaults.ts) ──
// Kept in sync manually; the spec treats these as heuristic pessimistic
// estimates only, so exact parity with server is not a correctness requirement.

const STEP_COST_ESTIMATE_CENTS: Record<string, number> = {
  agent_call: 50,
  agent: 50,
  prompt: 10,
  action_call: 5,
  action: 5,
  invoke_automation: 25,
};

function estimateStepCostCents(stepType: string, params?: Record<string, unknown>): number {
  if (typeof params?.estimatedCostCents === 'number') {
    return params.estimatedCostCents;
  }
  return STEP_COST_ESTIMATE_CENTS[stepType] ?? 0;
}

// ─── Input shape ──────────────────────────────────────────────────────────────

/**
 * Minimal step shape the canvas operates on. Uses the V1 user-facing type
 * vocabulary plus the legacy engine names (the canvas renders whatever the
 * template version stores).
 */
export interface CanvasStep {
  id: string;
  name: string;
  type: string;
  /** dependsOn ids (DAG edges). */
  dependsOn?: string[];
  /** agent_decision branches. */
  branches?: Array<{ id: string; label: string; onSuccess?: string | string[] }>;
  /** For approval steps: the id of the rollback-target step on reject. */
  onReject?: string;
  /** For parallel groupings: optional explicit parallel group id. */
  parallelGroupId?: string;
  /** Per-step params (for cost estimation). */
  params?: Record<string, unknown>;
  /** Validation errors attached by the last validator run. */
  validationErrors?: StepValidationResult[];
}

export interface StepValidationResult {
  rule: string;
  stepId?: string;
  message: string;
  severity: 'error' | 'warning';
}

// ─── Output shapes ────────────────────────────────────────────────────────────

/**
 * A step as it should be rendered, with layout info attached.
 *
 * `columnIndex` and `rowIndex` position the step inside the canvas grid.
 * Steps in the same `rowIndex` but different `columnIndex` are parallel peers.
 * Steps in a branch fork sit at the same `rowIndex` under their parent with
 * different `columnIndex` values.
 */
export interface RenderableStep {
  step: CanvasStep;
  rowIndex: number;
  columnIndex: number;
  /** When true, this step is the direct child of a branch fork. */
  isBranchChild: boolean;
  /** The branch label for branch-children (e.g. "If yes"). */
  branchLabel?: string;
}

/**
 * A dashed back-arrow from an Approval rejection back to a rollback target.
 */
export interface RejectArrow {
  /** Step id of the Approval step that has onReject set. */
  fromStepId: string;
  /** Step id of the rollback target. */
  toStepId: string;
}

export interface ValidationSummary {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  /** The single worst (error-level) message to surface in the bottom bar. */
  worstError: string | null;
}

// ─── Branch layout ────────────────────────────────────────────────────────────

/**
 * Flattens a step list into renderable rows.
 *
 * Strategy (V1 simple linear + branch expansion):
 *   - Steps with no `dependsOn` or with a single linear dependency are
 *     assigned to column 0.
 *   - Steps that are listed inside a parent's `branches[].onSuccess` are
 *     assigned a column index matching their branch index.
 *   - All others are placed in column 0 after their dependencies resolve.
 *
 * This is a heuristic layout sufficient for V1. A full topological sort with
 * parallel grouping is out of scope for Chunk 14a.
 */
export function computeBranchLayout(steps: CanvasStep[]): RenderableStep[] {
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const result: RenderableStep[] = [];

  // Build a set of step ids that are direct branch children (so we can mark them).
  const branchChildOf = new Map<string, { parentId: string; branchLabel: string; colIndex: number }>();
  for (const step of steps) {
    if (step.branches) {
      step.branches.forEach((branch, idx) => {
        const targets = Array.isArray(branch.onSuccess)
          ? branch.onSuccess
          : branch.onSuccess
          ? [branch.onSuccess]
          : [];
        for (const targetId of targets) {
          if (stepById.has(targetId)) {
            branchChildOf.set(targetId, {
              parentId: step.id,
              branchLabel: branch.label,
              colIndex: idx,
            });
          }
        }
      });
    }
  }

  // Simple row assignment: topological order based on dependsOn.
  const rowOf = new Map<string, number>();
  const visited = new Set<string>();

  function assignRow(id: string): number {
    if (rowOf.has(id)) return rowOf.get(id)!;
    if (visited.has(id)) {
      // Cycle detected — assign row 0 to break.
      rowOf.set(id, 0);
      return 0;
    }
    visited.add(id);
    const step = stepById.get(id);
    if (!step || !step.dependsOn || step.dependsOn.length === 0) {
      rowOf.set(id, 0);
      return 0;
    }
    const maxDep = Math.max(...step.dependsOn.map(assignRow));
    const row = maxDep + 1;
    rowOf.set(id, row);
    return row;
  }

  for (const step of steps) {
    assignRow(step.id);
  }

  for (const step of steps) {
    const row = rowOf.get(step.id) ?? 0;
    const branchInfo = branchChildOf.get(step.id);
    result.push({
      step,
      rowIndex: row,
      columnIndex: branchInfo ? branchInfo.colIndex : 0,
      isBranchChild: !!branchInfo,
      branchLabel: branchInfo?.branchLabel,
    });
  }

  // Sort by row then column so rendering is top-to-bottom, left-to-right.
  result.sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
  return result;
}

// ─── Parallel layout ──────────────────────────────────────────────────────────

/**
 * Groups steps that share the same rowIndex into parallel "rows".
 *
 * Returns a map from rowIndex to the array of steps at that row.
 * Steps in a row with count > 1 should be rendered side-by-side.
 */
export function computeParallelLayout(
  renderableSteps: RenderableStep[]
): Map<number, RenderableStep[]> {
  const byRow = new Map<number, RenderableStep[]>();
  for (const rs of renderableSteps) {
    const row = byRow.get(rs.rowIndex) ?? [];
    row.push(rs);
    byRow.set(rs.rowIndex, row);
  }
  return byRow;
}

// ─── Reject arrows ────────────────────────────────────────────────────────────

/**
 * Returns dashed back-arrows for Approval steps that have `onReject` set.
 *
 * Each arrow is a { fromStepId, toStepId } pair. The canvas renders it as a
 * dashed line from the Approval card to the rollback-target card.
 */
export function computeRejectArrows(steps: CanvasStep[]): RejectArrow[] {
  return steps
    .filter((s) => (s.type === 'approval' || s.type === 'user_input') && s.onReject)
    .map((s) => ({ fromStepId: s.id, toStepId: s.onReject! }));
}

// ─── Validation aggregation ───────────────────────────────────────────────────

/**
 * Aggregates per-step validation results into a single summary for the
 * StudioBottomBar.
 *
 * The `stepResults` map is keyed by step id and contains the error/warning
 * list for that step (empty array means the step passed).
 */
export function aggregateValidationStatus(
  stepResults: Map<string, StepValidationResult[]>
): ValidationSummary {
  let errorCount = 0;
  let warningCount = 0;
  let worstError: string | null = null;

  for (const errors of stepResults.values()) {
    for (const e of errors) {
      if (e.severity === 'error') {
        errorCount++;
        if (!worstError) worstError = e.message;
      } else {
        warningCount++;
      }
    }
  }

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    worstError,
  };
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Sums step-level cost estimates across all steps.
 *
 * Each step's cost is resolved via `estimateStepCostCents`:
 *   1. `step.params.estimatedCostCents` — explicit override.
 *   2. Per-type default from `costEstimationDefaults.ts`.
 *   3. 0 — unknown / free types.
 */
export function aggregateCostEstimate(steps: CanvasStep[]): number {
  return steps.reduce((sum, step) => {
    return sum + estimateStepCostCents(step.type, step.params);
  }, 0);
}
