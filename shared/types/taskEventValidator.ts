import { TASK_EVENT_KINDS } from './taskEvent.js';
import type { TaskEvent } from './taskEvent.js';

const VALID_ORIGINS = new Set(['engine', 'gate', 'user', 'orchestrator']);

export function validateTaskEvent(
  payload: unknown
): { ok: true; event: TaskEvent } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'payload must be an object' };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.kind !== 'string') {
    return { ok: false, reason: 'payload.kind must be a string' };
  }
  if (!TASK_EVENT_KINDS.includes(p.kind as TaskEvent['kind'])) {
    return { ok: false, reason: `unknown event kind: ${p.kind}` };
  }
  if (!p.payload || typeof p.payload !== 'object') {
    return { ok: false, reason: 'payload.payload must be an object' };
  }
  return { ok: true, event: payload as TaskEvent };
}

export function validateEventOrigin(
  origin: unknown
): origin is 'engine' | 'gate' | 'user' | 'orchestrator' {
  return typeof origin === 'string' && VALID_ORIGINS.has(origin);
}
