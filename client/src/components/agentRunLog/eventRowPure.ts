/**
 * Pure presentation mappers for EventRow.
 *
 * Keeps the component declarative — payload-shape inference and view-model
 * construction live here, the .tsx file just renders the result.
 *
 * Tests live in __tests__/eventRowPure.test.ts.
 *
 * ─── Migration endgame for legacy fallbacks ───────────────────────────────
 * This module contains two transitional fallback paths that exist only to
 * support emitters which have not yet migrated to the structured payload
 * (see `buildAutomationSkillCompletedPayload` in shared/types/agentExecutionLog.ts).
 * Both fallbacks emit a stable warn code on every hit so production usage is
 * observable.
 *
 *   Phase 1 (DONE): Strict builder + fallback paths shipped together.
 *   Phase 2 (DONE): Warn-on-fallback emits stable codes that ops can grep.
 *   Phase 3 (PENDING): When client metrics infra lands, increment a counter
 *                      in the same callsite as the warn so dashboards can
 *                      show fallback rate over time per emitter.
 *   Phase 4 (REMOVAL CRITERIA): When the warn rate for both codes has been
 *                      zero for ≥30 days in production, delete:
 *                        (a) the slug-shape fallback in `isAutomationSkillFailure`
 *                        (b) the regex fallback in `mapInvokeAutomationFailedViewModel`
 *                        (c) the optional fields on the base `skill.completed`
 *                            union member (force the strict shape only)
 *                      DO NOT preserve the fallbacks "just in case" — keeping
 *                      them silently re-permits drift.
 *
 * Trust contract: when an emitter has set `skillType: 'automation'`, we trust
 * its structured fields completely. We do NOT regex-fall-back even when those
 * fields are null/undefined — that's the emitter explicitly saying "unknown",
 * not a request to re-parse the human summary. Regex fallback only fires when
 * NO structured discriminator is present (the slug-shape legacy path).
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
 * Stable warn codes — log lines emit these so ops can grep for transitional
 * fallback usage and notice when emitters haven't migrated to the structured
 * fields. Tests can assert against these codes too.
 *
 * Naming convention: `<surface>.<specific_signal>` — dot-namespaced so log
 * aggregation tools can filter by surface (`event_row.*`) cleanly and
 * codes from different surfaces never collide.
 */
export const FALLBACK_WARN_CODES = {
  legacySkillSlugDetection: 'event_row.legacy_skill_slug_detection',
  legacyProviderRegex: 'event_row.legacy_provider_regex',
} as const;

/**
 * Optional warn sink — defaults to console.warn but injectable for tests
 * (so the suite can capture the call without polluting test output).
 */
export type WarnSink = (code: string, context: Record<string, unknown>) => void;

const defaultWarnSink: WarnSink = (code, ctx) => {
   
  console.warn(`[eventRowPure] ${code}`, ctx);
};

/**
 * Returns true when the event represents a failed invoke_automation skill call.
 *
 * Detection priority:
 *   1. Structured `skillType === 'automation'` field (preferred).
 *   2. Slug-shape heuristics — transitional fallback only. When taken, emits a
 *      warn with code `event_row_legacy_skill_slug_detection_used` so ops can
 *      track unmigrated emitters. Once all emitters attach `skillType`, the
 *      heuristics + warning can be removed.
 */
export function isAutomationSkillFailure(payload: unknown, warn: WarnSink = defaultWarnSink): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (p.status !== 'error') return false;
  // Structured discriminator (preferred).
  if (p.skillType === 'automation') return true;
  // Transitional fallback — slug-shape heuristics.
  const slug = typeof p.skillSlug === 'string' ? p.skillSlug : '';
  const matched =
    slug === 'invoke_automation' ||
    slug.startsWith('automation.') ||
    slug.startsWith('invoke_automation.');
  if (matched) {
    warn(FALLBACK_WARN_CODES.legacySkillSlugDetection, { skillSlug: slug });
  }
  return matched;
}

/**
 * Maps a `skill.completed` event with status 'error' (and the automation
 * shape) into a view model the row component can render declaratively.
 *
 * Trust contract (per R3-5): when the emitter has set `skillType:'automation'`,
 * its structured fields are authoritative — including a deliberate `null` or
 * `undefined` for unknown values. We do NOT regex-fall-back in that case.
 * The regex fallback only fires when no `skillType` discriminator is present
 * (the legacy slug-shape path got us here). When it fires, emits a warn with
 * code `event_row.legacy_provider_regex` so ops can track unmigrated emitters.
 * Removal criteria for the fallback: see the module-level Phase 4 block.
 */
export function mapInvokeAutomationFailedViewModel(
  event: AgentExecutionEvent,
  warn: WarnSink = defaultWarnSink,
): InvokeAutomationFailedViewModel {
  const p = event.payload as {
    skillSlug?: string;
    skillName?: string;
    resultSummary?: string;
    skillType?: string;
    provider?: string | null;
    connectionKey?: string | null;
    idempotent?: boolean;
    errorCode?: string | null;
  };

  const stepName =
    event.linkedEntity?.label ?? p.skillName ?? p.skillSlug ?? 'Automation step';

  const errorMessage = p.resultSummary ?? 'Automation step failed.';

  // Trust the discriminator — when the emitter has set skillType:'automation',
  // their structured fields (including a deliberate `null`/`undefined` for
  // unknown values) win. Only fall back to regex when no discriminator is
  // present at all (the legacy slug-shape path took us here).
  let provider: string | undefined = p.provider ?? undefined;
  const isStructuredEmitter = p.skillType === 'automation';
  if (!isStructuredEmitter && !provider && p.resultSummary) {
    const match = p.resultSummary.match(/The (\w+) connection/i);
    if (match) {
      provider = match[1];
      warn(FALLBACK_WARN_CODES.legacyProviderRegex, {
        skillSlug: p.skillSlug,
        sequenceNumber: event.sequenceNumber,
      });
    }
  }

  return {
    kind: 'invoke_automation_failed',
    stepName,
    errorMessage,
    provider,
    connectionKey: p.connectionKey ?? undefined,
    idempotent: p.idempotent,
    errorCode: p.errorCode ?? undefined,
  };
}

/**
 * Top-level mapper. Returns a view-model the EventRow component renders.
 *
 * `warn` is injectable for tests; defaults to `console.warn`. Warning is emitted
 * once per event when a transitional fallback path is taken.
 */
export function mapEventToViewModel(
  event: AgentExecutionEvent,
  warn: WarnSink = defaultWarnSink,
): EventRowViewModel {
  if (event.eventType === 'skill.completed' && isAutomationSkillFailure(event.payload, warn)) {
    return mapInvokeAutomationFailedViewModel(event, warn);
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
