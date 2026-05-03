/**
 * taskEventValidator.ts — pure runtime validator for TaskEvent payloads.
 *
 * Used at WRITE-TIME before persisting. Per DEVELOPMENT_GUIDELINES §8.13,
 * adding a new kind requires updating BOTH the union in taskEvent.ts AND
 * the validator switch here in the same commit.
 *
 * No runtime deps — hand-rolled type guards so this can run in any env
 * without zod being present.
 */

import type { TaskEvent, TaskEventKind, AskFormSchema } from './taskEvent.js';

// ─── Result type ──────────────────────────────────────────────────────────────

export type ValidateTaskEventResult =
  | { ok: true; event: TaskEvent }
  | { ok: false; reason: string };

// ─── Guard helpers ────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isAskFormSchema(v: unknown): v is AskFormSchema {
  if (!isObject(v)) return false;
  if (!Array.isArray(v['fields'])) return false;
  return true;
}

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validates that `payload` is a well-formed TaskEvent. Checks the `kind`
 * discriminator and each required field's type. Extra fields are tolerated
 * (forward-compatibility).
 */
export function validateTaskEvent(payload: unknown): ValidateTaskEventResult {
  if (!isObject(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }
  const { kind } = payload as { kind?: unknown };
  if (!isString(kind)) {
    return { ok: false, reason: 'missing or non-string kind' };
  }

  const p = (payload as { kind: string; payload?: unknown }).payload;

  switch (kind as TaskEventKind) {
    case 'task.created': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['requesterId'])) return { ok: false, reason: `${kind}: requesterId must be string` };
      if (!isString(p['initialPrompt'])) return { ok: false, reason: `${kind}: initialPrompt must be string` };
      break;
    }
    case 'task.routed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      // targetAgentId and targetWorkflowTemplateId are optional
      break;
    }
    case 'agent.delegation.opened': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['parentAgentId'])) return { ok: false, reason: `${kind}: parentAgentId must be string` };
      if (!isString(p['childAgentId'])) return { ok: false, reason: `${kind}: childAgentId must be string` };
      if (!isString(p['scope'])) return { ok: false, reason: `${kind}: scope must be string` };
      break;
    }
    case 'agent.delegation.closed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['childAgentId'])) return { ok: false, reason: `${kind}: childAgentId must be string` };
      if (!isString(p['summary'])) return { ok: false, reason: `${kind}: summary must be string` };
      break;
    }
    case 'step.queued': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      if (!isString(p['stepType'])) return { ok: false, reason: `${kind}: stepType must be string` };
      if (!isObject(p['params'])) return { ok: false, reason: `${kind}: params must be object` };
      break;
    }
    case 'step.started': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      break;
    }
    case 'step.completed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      if (!isStringArray(p['fileRefs'])) return { ok: false, reason: `${kind}: fileRefs must be string[]` };
      break;
    }
    case 'step.failed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      if (!isString(p['errorClass'])) return { ok: false, reason: `${kind}: errorClass must be string` };
      if (!isString(p['errorMessage'])) return { ok: false, reason: `${kind}: errorMessage must be string` };
      break;
    }
    case 'step.branch_decided': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      if (!isString(p['field'])) return { ok: false, reason: `${kind}: field must be string` };
      if (!isString(p['targetStep'])) return { ok: false, reason: `${kind}: targetStep must be string` };
      // resolvedValue is `unknown` — any value is valid
      break;
    }
    case 'approval.queued': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['gateId'])) return { ok: false, reason: `${kind}: gateId must be string` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      if (!isStringArray(p['approverPool'])) return { ok: false, reason: `${kind}: approverPool must be string[]` };
      if (!isObject(p['seenPayload'])) return { ok: false, reason: `${kind}: seenPayload must be object` };
      if (!isObject(p['seenConfidence'])) return { ok: false, reason: `${kind}: seenConfidence must be object` };
      break;
    }
    case 'approval.decided': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['gateId'])) return { ok: false, reason: `${kind}: gateId must be string` };
      if (!isString(p['decidedBy'])) return { ok: false, reason: `${kind}: decidedBy must be string` };
      if (p['decision'] !== 'approved' && p['decision'] !== 'rejected') {
        return { ok: false, reason: `${kind}: decision must be 'approved' | 'rejected'` };
      }
      break;
    }
    case 'approval.pool_refreshed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['gateId'])) return { ok: false, reason: `${kind}: gateId must be string` };
      if (!isString(p['actorId'])) return { ok: false, reason: `${kind}: actorId must be string` };
      if (!isNumber(p['newPoolSize'])) return { ok: false, reason: `${kind}: newPoolSize must be number` };
      if (typeof p['stillBelowQuorum'] !== 'boolean') return { ok: false, reason: `${kind}: stillBelowQuorum must be boolean` };
      break;
    }
    case 'ask.queued': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['gateId'])) return { ok: false, reason: `${kind}: gateId must be string` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      if (!isStringArray(p['submitterPool'])) return { ok: false, reason: `${kind}: submitterPool must be string[]` };
      if (!isAskFormSchema(p['schema'])) return { ok: false, reason: `${kind}: schema must have fields array` };
      if (!isString(p['prompt'])) return { ok: false, reason: `${kind}: prompt must be string` };
      break;
    }
    case 'ask.submitted': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['gateId'])) return { ok: false, reason: `${kind}: gateId must be string` };
      if (!isString(p['submittedBy'])) return { ok: false, reason: `${kind}: submittedBy must be string` };
      if (!isObject(p['values'])) return { ok: false, reason: `${kind}: values must be object` };
      break;
    }
    case 'ask.skipped': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['gateId'])) return { ok: false, reason: `${kind}: gateId must be string` };
      if (!isString(p['submittedBy'])) return { ok: false, reason: `${kind}: submittedBy must be string` };
      if (!isString(p['stepId'])) return { ok: false, reason: `${kind}: stepId must be string` };
      break;
    }
    case 'file.created': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['fileId'])) return { ok: false, reason: `${kind}: fileId must be string` };
      if (!isNumber(p['version'])) return { ok: false, reason: `${kind}: version must be number` };
      if (!isString(p['producerAgentId'])) return { ok: false, reason: `${kind}: producerAgentId must be string` };
      break;
    }
    case 'file.edited': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['fileId'])) return { ok: false, reason: `${kind}: fileId must be string` };
      if (!isNumber(p['priorVersion'])) return { ok: false, reason: `${kind}: priorVersion must be number` };
      if (!isNumber(p['newVersion'])) return { ok: false, reason: `${kind}: newVersion must be number` };
      if (!isString(p['editRequest'])) return { ok: false, reason: `${kind}: editRequest must be string` };
      break;
    }
    case 'chat.message': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (p['authorKind'] !== 'user' && p['authorKind'] !== 'agent') {
        return { ok: false, reason: `${kind}: authorKind must be 'user' | 'agent'` };
      }
      if (!isString(p['authorId'])) return { ok: false, reason: `${kind}: authorId must be string` };
      if (!isString(p['body'])) return { ok: false, reason: `${kind}: body must be string` };
      // N5: `attachments` shape is deferred to Chunk 13 — not validated here.
      // Extra fields are tolerated (forward-compatibility) so attachments are
      // passed through without validation until Chunk 13 defines the schema.
      break;
    }
    case 'agent.milestone': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['agentId'])) return { ok: false, reason: `${kind}: agentId must be string` };
      if (!isString(p['summary'])) return { ok: false, reason: `${kind}: summary must be string` };
      break;
    }
    case 'thinking.changed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['newText'])) return { ok: false, reason: `${kind}: newText must be string` };
      break;
    }
    case 'run.paused.cost_ceiling': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isNumber(p['capValue'])) return { ok: false, reason: `${kind}: capValue must be number` };
      if (!isNumber(p['currentCost'])) return { ok: false, reason: `${kind}: currentCost must be number` };
      break;
    }
    case 'run.paused.wall_clock': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isNumber(p['capValue'])) return { ok: false, reason: `${kind}: capValue must be number` };
      if (!isNumber(p['currentElapsed'])) return { ok: false, reason: `${kind}: currentElapsed must be number` };
      break;
    }
    case 'run.paused.by_user': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['actorId'])) return { ok: false, reason: `${kind}: actorId must be string` };
      break;
    }
    case 'run.resumed': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['actorId'])) return { ok: false, reason: `${kind}: actorId must be string` };
      break;
    }
    case 'run.stopped.by_user': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (!isString(p['actorId'])) return { ok: false, reason: `${kind}: actorId must be string` };
      break;
    }
    case 'task.degraded': {
      if (!isObject(p)) return { ok: false, reason: `${kind}: payload must be object` };
      if (p['reason'] !== 'consumer_gap_detected' && p['reason'] !== 'replay_cursor_expired') {
        return { ok: false, reason: `${kind}: reason must be 'consumer_gap_detected' | 'replay_cursor_expired'` };
      }
      if (!isString(p['degradationReason'])) return { ok: false, reason: `${kind}: degradationReason must be string` };
      break;
    }
    default: {
      // Unknown kind — not in the allow-list.
      const exhaustive: never = kind as never;
      return { ok: false, reason: `unknown event kind: ${exhaustive}` };
    }
  }

  return { ok: true, event: payload as TaskEvent };
}
