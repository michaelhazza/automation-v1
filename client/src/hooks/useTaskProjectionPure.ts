import type {
  TaskProjection,
  ChatMessageProjection,
  MilestoneProjection,
  ApprovalGateProjection,
  AskGateProjection,
  StepProjection,
  ActivityEventProjection,
} from '../../../shared/types/taskProjection';
import { INITIAL_TASK_PROJECTION } from '../../../shared/types/taskProjection';
import type { TaskEventEnvelope, TaskEvent } from '../../../shared/types/taskEvent';

// Re-export for convenience
export type {
  ChatMessageProjection,
  MilestoneProjection,
  ApprovalGateProjection,
  AskGateProjection,
  StepProjection,
  ActivityEventProjection,
};

/**
 * Pure deterministic reducer: (prev, event) => next.
 * Idempotent — applying the same event twice produces the same state.
 * All arrays are newest-at-bottom (append-only).
 */
export function applyTaskEvent(prev: TaskProjection, envelope: TaskEventEnvelope): TaskProjection {
  const { payload, timestamp, eventId, taskSequence, eventSubsequence } = envelope;

  const next: TaskProjection = {
    ...prev,
    lastEventSeq: Math.max(prev.lastEventSeq, taskSequence),
    lastEventSubseq:
      taskSequence > prev.lastEventSeq ? eventSubsequence
      : taskSequence === prev.lastEventSeq ? Math.max(prev.lastEventSubseq, eventSubsequence)
      : prev.lastEventSubseq,
  };

  const activityEntry: ActivityEventProjection = {
    id: eventId,
    kind: payload.kind,
    timestamp,
    summary: summariseEvent(payload),
  };
  next.activityEvents = [...prev.activityEvents, activityEntry];

  switch (payload.kind) {
    case 'chat.message':
      next.chatMessages = [...prev.chatMessages, {
        id: eventId,
        authorKind: payload.payload.authorKind,
        authorId: payload.payload.authorId,
        body: payload.payload.body,
        timestamp,
      }];
      break;
    case 'agent.milestone':
      next.milestones = [...prev.milestones, {
        id: eventId,
        agentId: payload.payload.agentId,
        summary: payload.payload.summary,
        linkRef: payload.payload.linkRef,
        timestamp,
      }];
      break;
    case 'thinking.changed':
      next.thinkingText = payload.payload.newText;
      break;
    case 'approval.queued':
      next.approvalGates = [
        ...prev.approvalGates.filter(g => g.gateId !== payload.payload.gateId),
        {
          gateId: payload.payload.gateId,
          stepId: payload.payload.stepId,
          poolSize: payload.payload.poolSize,
          poolFingerprint: payload.payload.poolFingerprint,
          seenPayload: payload.payload.seenPayload,
          seenConfidence: payload.payload.seenConfidence,
          status: 'pending',
        },
      ];
      break;
    case 'approval.decided':
      next.approvalGates = prev.approvalGates.map(g =>
        g.gateId === payload.payload.gateId
          ? {
              ...g,
              status: 'decided' as const,
              decision: payload.payload.decision,
              decidedBy: payload.payload.decidedBy,
              decisionReason: payload.payload.decisionReason,
            }
          : g
      );
      break;
    case 'approval.pool_refreshed':
      next.approvalGates = prev.approvalGates.map(g =>
        g.gateId === payload.payload.gateId
          ? {
              ...g,
              poolSize: payload.payload.newPoolSize,
              poolFingerprint: payload.payload.newPoolFingerprint,
            }
          : g
      );
      break;
    case 'ask.queued':
      next.askGates = [
        ...prev.askGates.filter(g => g.gateId !== payload.payload.gateId),
        {
          gateId: payload.payload.gateId,
          stepId: payload.payload.stepId,
          poolSize: payload.payload.poolSize,
          poolFingerprint: payload.payload.poolFingerprint,
          schema: payload.payload.schema,
          prompt: payload.payload.prompt,
          status: 'pending',
        },
      ];
      break;
    case 'ask.submitted':
      next.askGates = prev.askGates.map(g =>
        g.gateId === payload.payload.gateId
          ? { ...g, status: 'submitted' as const, submittedBy: payload.payload.submittedBy }
          : g
      );
      break;
    case 'ask.skipped':
      next.askGates = prev.askGates.map(g =>
        g.gateId === payload.payload.gateId
          ? { ...g, status: 'skipped' as const, submittedBy: payload.payload.submittedBy }
          : g
      );
      break;
    case 'step.queued':
      next.steps = [
        ...prev.steps.filter(s => s.stepId !== payload.payload.stepId),
        {
          stepId: payload.payload.stepId,
          stepType: payload.payload.stepType,
          status: 'pending',
          params: payload.payload.params,
        },
      ];
      break;
    case 'step.started':
      next.steps = prev.steps.map(s =>
        s.stepId === payload.payload.stepId ? { ...s, status: 'running' as const } : s
      );
      break;
    case 'step.completed':
      next.steps = prev.steps.map(s =>
        s.stepId === payload.payload.stepId ? { ...s, status: 'completed' as const } : s
      );
      break;
    case 'step.failed':
      next.steps = prev.steps.map(s =>
        s.stepId === payload.payload.stepId
          ? { ...s, status: 'failed' as const, errorMessage: payload.payload.errorMessage }
          : s
      );
      break;
    case 'step.awaiting_approval':
      next.steps = prev.steps.map(s =>
        s.stepId === payload.payload.stepId ? { ...s, status: 'awaiting_approval' as const } : s
      );
      break;
    case 'run.paused.by_user':
      next.runStatus = 'paused';
      break;
    case 'run.paused.cost_ceiling':
      next.runStatus = 'paused_cost';
      break;
    case 'run.paused.wall_clock':
      next.runStatus = 'paused_wall_clock';
      break;
    case 'run.resumed':
      next.runStatus = 'running';
      break;
    case 'run.stopped.by_user':
      next.runStatus = 'stopped';
      break;
    case 'task.degraded':
      next.isDegraded = true;
      next.degradationReason = payload.payload.degradationReason;
      break;
    default:
      break;
  }

  return next;
}

export function applyAllEvents(events: TaskEventEnvelope[]): TaskProjection {
  return events.reduce(applyTaskEvent, { ...INITIAL_TASK_PROJECTION });
}

function summariseEvent(event: TaskEvent): string {
  switch (event.kind) {
    case 'chat.message':
      return `${event.payload.authorKind === 'user' ? 'User' : 'Agent'} sent a message`;
    case 'agent.milestone':
      return event.payload.summary;
    case 'thinking.changed':
      return 'Agent is thinking';
    case 'step.queued':
      return `Step queued: ${event.payload.stepId}`;
    case 'step.started':
      return `Step started: ${event.payload.stepId}`;
    case 'step.completed':
      return `Step completed: ${event.payload.stepId}`;
    case 'step.failed':
      return `Step failed: ${event.payload.stepId}`;
    case 'approval.queued':
      return 'Approval requested';
    case 'approval.decided':
      return `Approval ${event.payload.decision}`;
    case 'ask.queued':
      return 'Input requested';
    case 'ask.submitted':
      return 'Input submitted';
    case 'ask.skipped':
      return 'Input skipped';
    case 'run.paused.by_user':
      return 'Run paused by user';
    case 'run.paused.cost_ceiling':
      return 'Run paused: cost ceiling reached';
    case 'run.paused.wall_clock':
      return 'Run paused: time limit reached';
    case 'run.resumed':
      return 'Run resumed';
    case 'run.stopped.by_user':
      return 'Run stopped';
    case 'task.degraded':
      return `Task degraded: ${event.payload.degradationReason}`;
    default:
      return (event as TaskEvent).kind;
  }
}
