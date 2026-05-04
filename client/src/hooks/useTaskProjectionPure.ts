import type {
  TaskProjection,
  ChatMessageProjection,
  MilestoneProjection,
  ApprovalGateProjection,
  AskGateProjection,
  StepProjection,
  ActivityEventProjection,
  FileProjection,
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
  FileProjection,
};

/**
 * Pure deterministic reducer: (prev, event) => next.
 *
 * Idempotent via a cursor-based short-circuit: events with `(taskSequence,
 * eventSubsequence) <= (prev.lastEventSeq, prev.lastEventSubseq)` are dropped
 * because their effect is already baked into `prev`. This makes overlapping
 * replay-vs-socket deliveries safe — the appending paths below
 * (`activityEvents`, `chatMessages`, `milestones`) would otherwise duplicate
 * UI rows on any re-application, since the per-task `(seq, subseq)` pair is
 * the unique identifier for an event in `agent_execution_events`.
 *
 * Out-of-order arrivals (rare, but possible if the socket buffers reorder)
 * are dropped here too; they recover on the next full-rebuild tick which
 * resets state and replays in seq-order.
 *
 * All arrays are newest-at-bottom (append-only).
 */
export function applyTaskEvent(prev: TaskProjection, envelope: TaskEventEnvelope): TaskProjection {
  const { payload, timestamp, eventId, taskSequence, eventSubsequence } = envelope;

  // Short-circuit: this event's coordinates are at or before the highest-seen
  // cursor — its effect is already in `prev`. Returning `prev` keeps the
  // reducer truly idempotent.
  if (
    taskSequence < prev.lastEventSeq ||
    (taskSequence === prev.lastEventSeq && eventSubsequence <= prev.lastEventSubseq)
  ) {
    return prev;
  }

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
    case 'file.created': {
      const existing = prev.files.find(f => f.fileId === payload.payload.fileId);
      if (existing) {
        next.files = prev.files.map(f =>
          f.fileId === payload.payload.fileId
            ? { ...f, currentVersion: payload.payload.version, lastEditRequest: undefined }
            : f
        );
      } else {
        next.files = [
          ...prev.files,
          {
            fileId: payload.payload.fileId,
            currentVersion: payload.payload.version,
            producerAgentId: payload.payload.producerAgentId,
            updatedAt: timestamp,
          },
        ];
      }
      break;
    }
    case 'file.edited':
      next.files = prev.files.map(f =>
        f.fileId === payload.payload.fileId
          ? { ...f, currentVersion: payload.payload.newVersion, lastEditRequest: payload.payload.editRequest, updatedAt: timestamp }
          : f
      );
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
