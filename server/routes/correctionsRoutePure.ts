/**
 * correctionsRoutePure.ts
 *
 * Pure validators for the operator-corrections route.
 * Trust & Verification Layer spec §9 (cross-entity guard) and §13.2.
 *
 * No DB, no I/O — only structural / referential checks against the inputs the
 * route already has in hand. The route is responsible for any DB-side
 * verification (verifyEventBelongsToRun) after these pre-checks pass.
 */

/**
 * Verdicts emitted by {@link validateEventIdShape}. The route maps each to a
 * specific HTTP status:
 *   - 'ok'                     → continue to the DB-side verifyEventBelongsToRun.
 *   - 'event_id_required'      → 400 with code 'EVENT_ID_REQUIRED'.
 *   - 'event_id_equals_run_id' → 400 with code 'EVENT_ID_REQUIRED' (the legacy
 *                                placeholder branch — kept distinct from the
 *                                missing-id case so logs and tests can tell
 *                                them apart even though the HTTP response is
 *                                identical).
 */
export type CorrectionEventIdVerdict =
  | 'ok'
  | 'event_id_required'
  | 'event_id_equals_run_id';

/**
 * Returns 'ok' iff the eventId is a non-empty string AND distinct from runId.
 *
 * Why reject `eventId === runId`: pre-fix the route honoured it as a
 * "placeholder" path that bypassed the cross-entity guard, so any caller with
 * `subaccount.corrections.create` could spam the org's knowledge base with
 * memory_blocks carrying a non-existent sourceEventId. The placeholder path is
 * removed; this validator rejects the legacy shape explicitly so older clients
 * fail fast with a clear error code.
 */
export function validateEventIdShape(
  eventId: unknown,
  runId: unknown,
): CorrectionEventIdVerdict {
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return 'event_id_required';
  }
  if (typeof runId === 'string' && eventId === runId) {
    return 'event_id_equals_run_id';
  }
  return 'ok';
}
