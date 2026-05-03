/**
 * useTaskProjectionPure.ts — pure reducer + types for task projection.
 *
 * Defines the TaskProjection read-model shape and the pure applyEvent
 * reducer. No side effects, no React, no fetches.
 *
 * Spec: docs/workflows-dev-spec.md §9 (open task view).
 * Tests: client/src/hooks/__tests__/useTaskProjectionPure.test.ts
 */

import type { TaskEvent, TaskEventEnvelope, TaskEventKind } from '../../../shared/types/taskEvent.js';

// ─── TaskProjection shape ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  authorKind: 'user' | 'agent';
  authorId: string;
  body: string;
  timestamp: string;
}

export interface AgentNode {
  agentId: string;
  status: 'idle' | 'working' | 'done';
  parentAgentId: string | null;
}

export type PlanStepStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting_approval'
  | 'awaiting_input';

export interface PlanStep {
  stepId: string;
  stepType: string;
  status: PlanStepStatus;
  isCritical: boolean;
  branchLabel?: string;
}

export type OpenCardKind = 'approval' | 'ask' | 'pause';

export interface OpenCard {
  kind: OpenCardKind;
  gateId?: string;
  payload: unknown;
}

export interface ActivityFeedItem {
  taskSequence: number;
  eventSubsequence: number;
  kind: TaskEventKind;
  payload: unknown;
  timestamp: string;
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'partial';

export interface TaskProjection {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  requesterUserId: string | null;
  startedAt: string | null;

  // Chat events
  chatMessages: ChatMessage[];
  thinking: { text: string; updatedAt: string } | null;

  // Activity events (all events, newest-at-bottom for scrolling)
  activityFeed: ActivityFeedItem[];

  // Now tab — agent org-chart
  agentTree: {
    rootAgentId: string | null;
    nodes: AgentNode[];
  };

  // Plan tab — step states
  planSteps: PlanStep[];

  // Approval / Pause / Ask cards
  openCards: OpenCard[];

  // Run status
  pauseReason: 'cost_ceiling' | 'wall_clock' | 'by_user' | null;
  degradationReason: string | null;

  // Internal dedup — processed envelopeIds
  _processedIds: Set<string>;
}

// ─── Empty projection factory ─────────────────────────────────────────────────

export function emptyProjection(taskId: string): TaskProjection {
  return {
    taskId,
    taskName: '',
    status: 'pending',
    requesterUserId: null,
    startedAt: null,
    chatMessages: [],
    thinking: null,
    activityFeed: [],
    agentTree: { rootAgentId: null, nodes: [] },
    planSteps: [],
    openCards: [],
    pauseReason: null,
    degradationReason: null,
    _processedIds: new Set(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function upsertAgentNode(
  nodes: AgentNode[],
  agentId: string,
  patch: Partial<AgentNode>,
): AgentNode[] {
  const idx = nodes.findIndex((n) => n.agentId === agentId);
  if (idx === -1) {
    return [
      ...nodes,
      {
        agentId,
        status: patch.status ?? 'idle',
        parentAgentId: patch.parentAgentId ?? null,
      },
    ];
  }
  const next = [...nodes];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

function upsertPlanStep(steps: PlanStep[], patch: Partial<PlanStep> & { stepId: string }): PlanStep[] {
  const idx = steps.findIndex((s) => s.stepId === patch.stepId);
  if (idx === -1) {
    return [
      ...steps,
      {
        stepId: patch.stepId,
        stepType: patch.stepType ?? 'unknown',
        status: patch.status ?? 'pending',
        isCritical: patch.isCritical ?? false,
        branchLabel: patch.branchLabel,
      },
    ];
  }
  const next = [...steps];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

// ─── Core reducer ────────────────────────────────────────────────────────────

/**
 * Apply a single event to a projection. Pure and idempotent.
 *
 * Idempotency: eventId (from envelope) is stored in _processedIds. A
 * duplicate call returns the same state immediately.
 */
export function applyEvent(
  prev: TaskProjection,
  event: TaskEvent,
  envelope: TaskEventEnvelope,
): TaskProjection {
  // Idempotency guard
  if (prev._processedIds.has(envelope.eventId)) {
    return prev;
  }

  const newIds = new Set(prev._processedIds);
  newIds.add(envelope.eventId);

  // Add to activity feed (all events land here)
  const feedItem: ActivityFeedItem = {
    taskSequence: envelope.taskSequence,
    eventSubsequence: envelope.eventSubsequence,
    kind: event.kind,
    payload: event.payload,
    timestamp: envelope.timestamp,
  };
  const activityFeed = [...prev.activityFeed, feedItem];

  let next: TaskProjection = { ...prev, activityFeed, _processedIds: newIds };

  switch (event.kind) {
    case 'task.created': {
      const p = (event as Extract<TaskEvent, { kind: 'task.created' }>).payload;
      next = {
        ...next,
        status: 'pending',
        requesterUserId: p.requesterId,
        startedAt: envelope.timestamp,
      };
      break;
    }

    case 'task.routed': {
      next = { ...next, status: 'running' };
      break;
    }

    case 'agent.delegation.opened': {
      const p = (event as Extract<TaskEvent, { kind: 'agent.delegation.opened' }>).payload;
      let nodes = next.agentTree.nodes;
      // Register child agent
      nodes = upsertAgentNode(nodes, p.childAgentId, {
        status: 'working',
        parentAgentId: p.parentAgentId,
      });
      // Ensure parent exists
      if (!nodes.find((n) => n.agentId === p.parentAgentId)) {
        nodes = upsertAgentNode(nodes, p.parentAgentId, {
          status: 'working',
          parentAgentId: null,
        });
      }
      const rootAgentId = next.agentTree.rootAgentId ?? p.parentAgentId;
      next = { ...next, agentTree: { rootAgentId, nodes } };
      break;
    }

    case 'agent.delegation.closed': {
      const p = (event as Extract<TaskEvent, { kind: 'agent.delegation.closed' }>).payload;
      const nodes = upsertAgentNode(next.agentTree.nodes, p.childAgentId, { status: 'done' });
      next = { ...next, agentTree: { ...next.agentTree, nodes } };
      break;
    }

    case 'step.queued': {
      const p = (event as Extract<TaskEvent, { kind: 'step.queued' }>).payload;
      const planSteps = upsertPlanStep(next.planSteps, {
        stepId: p.stepId,
        stepType: p.stepType,
        status: 'queued',
        isCritical: false,
      });
      next = { ...next, planSteps };
      break;
    }

    case 'step.started': {
      const p = (event as Extract<TaskEvent, { kind: 'step.started' }>).payload;
      const planSteps = upsertPlanStep(next.planSteps, { stepId: p.stepId, status: 'running' });
      next = { ...next, planSteps, status: 'running' };
      break;
    }

    case 'step.completed': {
      const p = (event as Extract<TaskEvent, { kind: 'step.completed' }>).payload;
      const planSteps = upsertPlanStep(next.planSteps, { stepId: p.stepId, status: 'completed' });
      next = { ...next, planSteps };
      break;
    }

    case 'step.failed': {
      const p = (event as Extract<TaskEvent, { kind: 'step.failed' }>).payload;
      const planSteps = upsertPlanStep(next.planSteps, { stepId: p.stepId, status: 'failed' });
      next = { ...next, planSteps };
      break;
    }

    case 'step.branch_decided': {
      const p = (event as Extract<TaskEvent, { kind: 'step.branch_decided' }>).payload;
      const planSteps = upsertPlanStep(next.planSteps, {
        stepId: p.stepId,
        branchLabel: String(p.resolvedValue),
      });
      next = { ...next, planSteps };
      break;
    }

    case 'approval.queued': {
      const p = (event as Extract<TaskEvent, { kind: 'approval.queued' }>).payload;
      // Mark the step as awaiting_approval
      const planSteps = upsertPlanStep(next.planSteps, {
        stepId: p.stepId,
        status: 'awaiting_approval',
      });
      const card: OpenCard = { kind: 'approval', gateId: p.gateId, payload: p };
      next = {
        ...next,
        planSteps,
        status: 'awaiting_approval',
        openCards: [...next.openCards, card],
      };
      break;
    }

    case 'approval.decided': {
      const p = (event as Extract<TaskEvent, { kind: 'approval.decided' }>).payload;
      // Remove the card once decided
      const openCards = next.openCards.filter(
        (c) => !(c.kind === 'approval' && c.gateId === p.gateId),
      );
      // Status reverts to running (engine will emit step events next)
      const hasOtherApprovalCards = openCards.some((c) => c.kind === 'approval');
      const status: TaskStatus = hasOtherApprovalCards ? 'awaiting_approval' : 'running';
      next = { ...next, openCards, status };
      break;
    }

    case 'approval.pool_refreshed': {
      // No projection change needed — informational event
      break;
    }

    case 'ask.queued': {
      const p = (event as Extract<TaskEvent, { kind: 'ask.queued' }>).payload;
      const planSteps = upsertPlanStep(next.planSteps, {
        stepId: p.stepId,
        status: 'awaiting_input',
      });
      const card: OpenCard = { kind: 'ask', gateId: p.gateId, payload: p };
      next = {
        ...next,
        planSteps,
        status: 'awaiting_input',
        openCards: [...next.openCards, card],
      };
      break;
    }

    case 'ask.submitted':
    case 'ask.skipped': {
      const p = (event as Extract<TaskEvent, { kind: 'ask.submitted' | 'ask.skipped' }>).payload;
      const openCards = next.openCards.filter(
        (c) => !(c.kind === 'ask' && c.gateId === (p as { gateId: string }).gateId),
      );
      const hasOtherAskCards = openCards.some((c) => c.kind === 'ask');
      const status: TaskStatus = hasOtherAskCards ? 'awaiting_input' : 'running';
      next = { ...next, openCards, status };
      break;
    }

    case 'chat.message': {
      const p = (event as Extract<TaskEvent, { kind: 'chat.message' }>).payload;
      const msg: ChatMessage = {
        id: envelope.eventId,
        authorKind: p.authorKind,
        authorId: p.authorId,
        body: p.body,
        timestamp: envelope.timestamp,
      };
      next = { ...next, chatMessages: [...next.chatMessages, msg] };
      break;
    }

    case 'agent.milestone': {
      // Milestones render in the chat pane as MilestoneCards — they are
      // surfaced by classifyChatVisibility in openTaskViewPure.ts.
      // No additional projection state needed beyond the activity feed entry.
      break;
    }

    case 'thinking.changed': {
      const p = (event as Extract<TaskEvent, { kind: 'thinking.changed' }>).payload;
      next = {
        ...next,
        thinking: { text: p.newText, updatedAt: envelope.timestamp },
      };
      break;
    }

    case 'run.paused.cost_ceiling': {
      const pauseCard: OpenCard = { kind: 'pause', payload: event.payload };
      next = {
        ...next,
        status: 'paused',
        pauseReason: 'cost_ceiling',
        openCards: [...next.openCards.filter((c) => c.kind !== 'pause'), pauseCard],
      };
      break;
    }

    case 'run.paused.wall_clock': {
      const pauseCard: OpenCard = { kind: 'pause', payload: event.payload };
      next = {
        ...next,
        status: 'paused',
        pauseReason: 'wall_clock',
        openCards: [...next.openCards.filter((c) => c.kind !== 'pause'), pauseCard],
      };
      break;
    }

    case 'run.paused.by_user': {
      const pauseCard: OpenCard = { kind: 'pause', payload: event.payload };
      next = {
        ...next,
        status: 'paused',
        pauseReason: 'by_user',
        openCards: [...next.openCards.filter((c) => c.kind !== 'pause'), pauseCard],
      };
      break;
    }

    case 'run.resumed': {
      const openCards = next.openCards.filter((c) => c.kind !== 'pause');
      next = {
        ...next,
        status: 'running',
        pauseReason: null,
        openCards,
      };
      break;
    }

    case 'run.stopped.by_user': {
      next = {
        ...next,
        status: 'cancelled',
        openCards: [],
      };
      break;
    }

    case 'task.degraded': {
      const p = (event as Extract<TaskEvent, { kind: 'task.degraded' }>).payload;
      next = {
        ...next,
        degradationReason: p.degradationReason,
        status: 'partial',
      };
      break;
    }

    case 'file.created':
    case 'file.edited':
      // Files tab (Chunk 13) handles these; no projection state here
      break;

    default:
      // Unknown event kinds — fall through silently
      break;
  }

  return next;
}
