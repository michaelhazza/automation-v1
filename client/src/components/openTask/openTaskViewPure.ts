import type { TaskProjection } from '../../../../shared/types/taskProjection';
import type { TaskEventEnvelope } from '../../../../shared/types/taskEvent';

export type TaskClassification = 'trivial' | 'multi_step' | 'workflow_fired';

export function classifyTask(projection: TaskProjection): TaskClassification {
  if (projection.steps.length > 3) return 'workflow_fired';
  if (projection.steps.length > 0) return 'multi_step';
  return 'trivial';
}

export function getLatestThinkingText(projection: TaskProjection): string | null {
  return projection.thinkingText;
}

export function shouldAutoScroll(
  prevEventCount: number,
  currentEventCount: number,
  isUserScrolledUp: boolean,
): boolean {
  if (isUserScrolledUp) return false;
  return currentEventCount > prevEventCount;
}

export function isMilestoneOrChat(event: TaskEventEnvelope): boolean {
  return event.payload.kind === 'chat.message' || event.payload.kind === 'agent.milestone';
}
