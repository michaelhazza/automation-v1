/**
 * Pure presentation mappers for EventRow.
 *
 * Keeps the component declarative — payload-shape inference and view-model
 * construction live here, the .tsx file just renders the result.
 *
 * Tests live in __tests__/eventRowPure.test.ts.
 */

import type { AgentExecutionEvent } from '../../../../shared/types/agentExecutionLog';

// ── invoke_automation failure view-model ────────────────────────────────────

export interface InvokeAutomationFailedViewModel {
  kind: 'invoke_automation_failed';
  stepName: string;
  errorMessage: string;
  /** Provider name (e.g. 'mailchimp'). May be undefined when not connection-related. */
  provider: string | undefined;
  /** Connection slot key (matches automations.requiredConnections[].key). */
  connectionKey: string | undefined;
  /**
   * Idempotency flag. When `false`, the UI should confirm before retry —
   * the side effect may already have occurred. When `true` or `undefined`
   * (unknown), retry is one-click.
   */
  idempotent: boolean | undefined;
  /** Stable error code from the §5.7 vocabulary, when present. */
  errorCode: string | undefined;
}

export interface DefaultEventViewModel {
  kind: 'default';
}

export type EventRowViewModel =
  | InvokeAutomationFailedViewModel
  | DefaultEventViewModel;

/**
 * Returns true when the event represents a failed invoke_automation skill call.
 *
 * Detection priority:
 *   1. Structured `skillType === 'automation'` field (preferred).
 *   2. Slug-shape heuristics — transitional fallback only. Once all emitters
 *      attach `skillType`, the heuristics can be removed.
 */
export function isAutomationSkillFailure(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (p.status !== 'error') return false;
  // Structured discriminator (preferred).
  if (p.skillType === 'automation') return true;
  // Transitional fallback — slug-shape heuristics.
  const slug = typeof p.skillSlug === 'string' ? p.skillSlug : '';
  return (
    slug === 'invoke_automation' ||
    slug.startsWith('automation.') ||
    slug.startsWith('invoke_automation.')
  );
}

/**
 * Maps a `skill.completed` event with status 'error' (and the automation
 * shape) into a view model the row component can render declaratively.
 *
 * Falls back to the legacy `match(/The (\w+) connection/i)` regex on
 * resultSummary only when the structured `provider` field is absent. Once
 * all emitters provide structured fields, the regex branch can be removed.
 */
export function mapInvokeAutomationFailedViewModel(
  event: AgentExecutionEvent,
): InvokeAutomationFailedViewModel {
  const p = event.payload as {
    skillSlug?: string;
    skillName?: string;
    resultSummary?: string;
    provider?: string;
    connectionKey?: string;
    idempotent?: boolean;
    errorCode?: string;
  };

  const stepName =
    event.linkedEntity?.label ?? p.skillName ?? p.skillSlug ?? 'Automation step';

  const errorMessage = p.resultSummary ?? 'Automation step failed.';

  // Prefer structured provider; fall back to regex on the human summary.
  let provider = p.provider;
  if (!provider && p.resultSummary) {
    const match = p.resultSummary.match(/The (\w+) connection/i);
    if (match) provider = match[1];
  }

  return {
    kind: 'invoke_automation_failed',
    stepName,
    errorMessage,
    provider,
    connectionKey: p.connectionKey,
    idempotent: p.idempotent,
    errorCode: p.errorCode,
  };
}

/**
 * Top-level mapper. Returns a view-model the EventRow component renders.
 */
export function mapEventToViewModel(event: AgentExecutionEvent): EventRowViewModel {
  if (event.eventType === 'skill.completed' && isAutomationSkillFailure(event.payload)) {
    return mapInvokeAutomationFailedViewModel(event);
  }
  return { kind: 'default' };
}

// ── Retry confirmation copy ─────────────────────────────────────────────────

/**
 * Copy shown in the confirmation dialog when the user clicks Retry on a
 * non-idempotent automation. Centralised here so the UX wording stays
 * consistent across surfaces.
 */
export const NON_IDEMPOTENT_RETRY_CONFIRM_MESSAGE =
  'This automation may have already taken effect (e.g. an email sent or a record created). ' +
  'Retrying could repeat the side effect. Retry anyway?';

/**
 * Decides whether the Retry click needs a confirmation dialog.
 *
 * - If `idempotent === true` → no confirm, one-click retry.
 * - If `idempotent === undefined` (unknown — emitter didn't fill it in) →
 *   default to confirm. Safer to ask once than to silently re-trigger a
 *   side effect.
 * - If `idempotent === false` → confirm.
 */
export function retryNeedsConfirmation(idempotent: boolean | undefined): boolean {
  return idempotent !== true;
}
