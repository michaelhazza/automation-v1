import { isTerminalRunStatus } from './runStatus';

/**
 * runPlanView.ts — Brain Tree OS adoption P2.
 *
 * Pure helper for the ExecutionPlanPane right-hand panel on RunTraceViewerPage.
 * Derives a single normalised view shape (`PlanItemView`) from one of two
 * sources:
 *
 *   1. Primary: agent_runs.plan_json — when the planning prelude emitted a
 *      structured plan, the pane shows planned actions matched against the
 *      tool call log by encounter-order tool name (each tool call consumed
 *      at most once).
 *
 *   2. Fallback: agent_runs.tool_calls_log — when no plan exists, the pane
 *      shows the tool call timeline as a flat list of items.
 *
 * Both sources flow through the same renderer; this helper hides the source
 * difference.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P2
 */

export interface PlanItemView {
  /** Stable id within the view — index within phases.items array. */
  id: string;
  /** Display label: plan action's reason or tool call's tool name. */
  label: string;
  /** Status pill — derived from match + run state. */
  status: 'pending' | 'in_progress' | 'complete' | 'skipped';
  /** Phase grouping label, or null for a flat list. */
  phase: string | null;
  /** Tool name that backs this item, if any. */
  tool: string | null;
  /** Duration of the matched tool call, if any. */
  durationMs: number | null;
  /** Index into toolCallsLog for click-through navigation. */
  evidenceToolCallIndex: number | null;
}

export interface PlanPhaseView {
  phase: string | null;
  items: PlanItemView[];
  completedCount: number;
  totalCount: number;
}

export interface PlanRenderView {
  /** Source of the view — used by the renderer to show the right header. */
  source: 'plan_json' | 'tool_calls_log' | 'empty';
  /** Single phases array; the renderer flattens or groups based on length. */
  phases: PlanPhaseView[];
  /** Aggregate completion percentage across all items. */
  progressPct: number;
  /** Total count of items across all phases. */
  totalCount: number;
  /** Total count of items in the 'complete' state. */
  completedCount: number;
}

interface ToolCallEntry {
  tool?: string;
  name?: string;
  output?: unknown;
  durationMs?: number;
  // The execution code stamps these in some paths
  success?: boolean;
}

interface PlanJsonShape {
  actions?: Array<{ tool: string; reason: string }>;
}

interface RunInput {
  status: string;
  planJson: PlanJsonShape | null;
  toolCallsLog: ToolCallEntry[] | null;
}

/**
 * Derive the renderable view from a run. Pure — same input always returns
 * the same output. Uses no side effects, no DOM, no fetch.
 */
export function deriveView(run: RunInput): PlanRenderView {
  const toolCalls: ToolCallEntry[] = Array.isArray(run.toolCallsLog) ? run.toolCallsLog : [];

  // ── Primary: plan_json present ─────────────────────────────────────────
  if (run.planJson && Array.isArray(run.planJson.actions) && run.planJson.actions.length > 0) {
    return derivePlanJsonView(run, toolCalls);
  }

  // ── Fallback: empty plan, no tool calls ────────────────────────────────
  if (toolCalls.length === 0) {
    return {
      source: 'empty',
      phases: [],
      progressPct: 0,
      totalCount: 0,
      completedCount: 0,
    };
  }

  // ── Fallback: tool calls only ──────────────────────────────────────────
  return deriveToolCallsView(run, toolCalls);
}

function derivePlanJsonView(run: RunInput, toolCalls: ToolCallEntry[]): PlanRenderView {
  const planActions = run.planJson?.actions ?? [];
  const items: PlanItemView[] = [];
  // Track which tool call indices have been consumed by an earlier plan match.
  const consumed = new Set<number>();

  for (let i = 0; i < planActions.length; i++) {
    const action = planActions[i];
    // Find the first unconsumed tool call whose tool field matches.
    let evidenceIndex: number | null = null;
    for (let j = 0; j < toolCalls.length; j++) {
      if (consumed.has(j)) continue;
      const tcName = toolCalls[j].tool ?? toolCalls[j].name ?? null;
      if (tcName === action.tool) {
        evidenceIndex = j;
        consumed.add(j);
        break;
      }
    }

    items.push({
      id: `plan-${i}`,
      label: action.reason || action.tool,
      tool: action.tool,
      phase: 'planning',
      status: deriveStatus(evidenceIndex, toolCalls, run.status),
      durationMs: evidenceIndex != null ? toolCalls[evidenceIndex].durationMs ?? null : null,
      evidenceToolCallIndex: evidenceIndex,
    });
  }

  const completedCount = items.filter((i) => i.status === 'complete').length;
  return {
    source: 'plan_json',
    phases: [
      {
        phase: null, // single-phase view, render flat
        items,
        completedCount,
        totalCount: items.length,
      },
    ],
    progressPct: items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0,
    totalCount: items.length,
    completedCount,
  };
}

function deriveToolCallsView(run: RunInput, toolCalls: ToolCallEntry[]): PlanRenderView {
  const items: PlanItemView[] = toolCalls.map((tc, i) => {
    const tool = tc.tool ?? tc.name ?? 'unknown';
    const success = inferSuccess(tc);
    return {
      id: `tc-${i}`,
      label: tool,
      tool,
      phase: null,
      status: success === false ? 'skipped' : success === true ? 'complete' : 'in_progress',
      durationMs: tc.durationMs ?? null,
      evidenceToolCallIndex: i,
    };
  });

  const completedCount = items.filter((i) => i.status === 'complete').length;
  return {
    source: 'tool_calls_log',
    phases: [
      {
        phase: null,
        items,
        completedCount,
        totalCount: items.length,
      },
    ],
    progressPct: items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0,
    totalCount: items.length,
    completedCount,
  };
}

/**
 * Derive a status pill for a plan-mode item based on whether a matching tool
 * call was found and the run's terminal status.
 */
function deriveStatus(
  evidenceIndex: number | null,
  toolCalls: ToolCallEntry[],
  runStatus: string,
): PlanItemView['status'] {
  if (evidenceIndex == null) {
    // No matching call found.
    if (isTerminalRunStatus(runStatus)) return 'skipped';
    return 'pending';
  }
  const tc = toolCalls[evidenceIndex];
  const success = inferSuccess(tc);
  if (success === true) return 'complete';
  if (success === false) return 'skipped';
  return 'in_progress';
}

/** Infer whether a tool call entry succeeded based on its output shape. */
function inferSuccess(tc: ToolCallEntry): boolean | null {
  if (typeof tc.success === 'boolean') return tc.success;
  if (tc.output && typeof tc.output === 'object') {
    const out = tc.output as Record<string, unknown>;
    if ('error' in out && out.error) return false;
    if ('success' in out && typeof out.success === 'boolean') return out.success;
  }
  // Default: treat as complete if no signal of failure.
  return true;
}

