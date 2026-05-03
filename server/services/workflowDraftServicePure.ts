/**
 * workflowDraftServicePure — pure, DB-free helpers for workflow_drafts.
 *
 * Paired with: workflowDraftService.ts (impure, DB-bound).
 * Spec: tasks/Workflows-spec.md §3.3, §10.7.
 *
 * Tests: server/services/__tests__/workflowDraftServicePure.test.ts
 */

import type { WorkflowStep } from '../lib/workflow/types.js';

// ─── Payload validation ───────────────────────────────────────────────────────

export type ValidateDraftPayloadResult =
  | { ok: true; payload: WorkflowStep[] }
  | { ok: false; reason: string };

/**
 * Validate that an unknown value is a non-empty array of WorkflowStep-shaped
 * objects (structural check only — does not run the full validator rule set).
 *
 * Rule: each element must be an object with string `id`, string `name`, and
 * string `type`. Additional fields are allowed (pass-through). An empty array
 * is valid (new workflow scaffold).
 */
export function validateDraftPayload(payload: unknown): ValidateDraftPayloadResult {
  if (!Array.isArray(payload)) {
    return { ok: false, reason: 'payload must be an array' };
  }

  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    if (typeof item !== 'object' || item === null) {
      return { ok: false, reason: `payload[${i}] must be an object` };
    }
    const step = item as Record<string, unknown>;
    if (typeof step.id !== 'string' || step.id.trim() === '') {
      return { ok: false, reason: `payload[${i}].id must be a non-empty string` };
    }
    if (typeof step.name !== 'string' || step.name.trim() === '') {
      return { ok: false, reason: `payload[${i}].name must be a non-empty string` };
    }
    if (typeof step.type !== 'string' || step.type.trim() === '') {
      return { ok: false, reason: `payload[${i}].type must be a non-empty string` };
    }
  }

  return { ok: true, payload: payload as WorkflowStep[] };
}

// ─── Draft access outcome ─────────────────────────────────────────────────────

export type DraftAccessOutcome = 'fresh' | 'already_consumed' | 'not_found';

export interface DraftAccessInputs {
  /** Whether the draft row exists in the database. */
  exists: boolean;
  /** consumedAt value from the row, or null/undefined if not consumed. */
  consumedAt: Date | null | undefined;
}

/**
 * Decide the access outcome from a database lookup result.
 *
 * - not found → 'not_found'
 * - found + consumedAt set → 'already_consumed'
 * - found + consumedAt null → 'fresh'
 */
export function decideDraftAccessOutcome(inputs: DraftAccessInputs): DraftAccessOutcome {
  if (!inputs.exists) return 'not_found';
  if (inputs.consumedAt != null) return 'already_consumed';
  return 'fresh';
}
