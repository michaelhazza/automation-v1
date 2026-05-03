/**
 * openTaskViewPure.ts — pure helpers for the open task view.
 *
 * No React, no side effects — all functions are pure.
 * Tests: client/src/components/openTask/__tests__/openTaskViewPure.test.ts
 *
 * Spec: docs/workflows-dev-spec.md §9.
 */

import type { TaskEvent } from '../../../../shared/types/taskEvent.js';
import type { PlanStep } from '../../hooks/useTaskProjectionPure.js';

// ─── Task type classification ─────────────────────────────────────────────────

export type TaskType = 'trivial' | 'multi-step' | 'workflow-fired';

/**
 * Classify the task type for Plan tab rendering.
 *
 * - trivial: 0 or 1 plan step
 * - workflow-fired: any step has a branchLabel (indicates a workflow DAG with routing)
 * - multi-step: everything else with 2+ steps
 */
export function classifyTaskType(planSteps: PlanStep[]): TaskType {
  if (planSteps.length <= 1) return 'trivial';
  const hasBranch = planSteps.some((s) => s.branchLabel !== undefined);
  if (hasBranch) return 'workflow-fired';
  return 'multi-step';
}

// ─── Chat visibility ──────────────────────────────────────────────────────────

export type ChatVisibility = 'milestone' | 'narration' | 'hidden';

/**
 * Classify whether a TaskEvent should appear in the chat pane,
 * and if so, as what kind.
 *
 * Rules per spec §9.2:
 * - chat.message → narration (renders as ChatMessage)
 * - agent.milestone → milestone (renders as MilestoneCard)
 * - approval.queued → narration (renders as ApprovalCard)
 * - ask.queued → narration (renders as AskFormCard placeholder)
 * - run.paused.* → narration (renders as PauseCard)
 * - everything else → hidden (goes to activity only)
 */
export function classifyChatVisibility(event: TaskEvent): ChatVisibility {
  switch (event.kind) {
    case 'agent.milestone':
      return 'milestone';
    case 'chat.message':
    case 'approval.queued':
    case 'ask.queued':
    case 'run.paused.cost_ceiling':
    case 'run.paused.wall_clock':
    case 'run.paused.by_user':
      return 'narration';
    default:
      return 'hidden';
  }
}

// ─── Thinking text ────────────────────────────────────────────────────────────

/**
 * Extract the latest thinking text from a flat event array.
 * Returns null when no thinking.changed event has been seen.
 */
export function getLatestThinkingText(events: TaskEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'thinking.changed') {
      return (events[i] as Extract<TaskEvent, { kind: 'thinking.changed' }>).payload.newText;
    }
  }
  return null;
}

// ─── Auto-scroll decision ────────────────────────────────────────────────────

/**
 * Returns true when the activity pane should auto-scroll to the bottom.
 *
 * Auto-scroll is paused when the user manually scrolled up within the last
 * 2 seconds (user is reading history).
 */
export function shouldAutoScroll(
  _scrollState: { atBottom: boolean },
  lastUserScrollAt: number | null,
): boolean {
  if (lastUserScrollAt === null) return true;
  const elapsed = Date.now() - lastUserScrollAt;
  return elapsed > 2_000;
}
