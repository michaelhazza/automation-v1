import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// derivedDataMissingLog — WARN helper for missing async-produced derived data
//
// Used by service code that reads fields populated by background jobs
// (bundleUtilizationJob, measureInterventionOutcomeJob, ruleAutoDeprecateJob,
// connectorPollingSync). When a field is null because the job hasn't run yet,
// call this helper instead of throwing or silently returning wrong data.
//
// Pattern: Pattern B — first-occurrence WARN, subsequent occurrences DEBUG.
//   - The first time a <service>.<field>:<orgId> triple is encountered the
//     helper emits at WARN level. Every subsequent call for the same key
//     emits at DEBUG (which is filtered in production by default).
//   - The Set resets on process restart — a long-lived pod accumulating many
//     keys is a separate scaling concern, out of H1 scope.
//
// Why Pattern B (not Pattern A rate-limit by time):
//   Phase 1 has ≤ 5 in-scope call sites per domain, all low-volume paths.
//   Pattern B is simpler and correct for low-volume paths. If a high-volume
//   path is added in Phase 2, upgrade to Pattern A at that point.
//
// Interface: logDataDependencyMissing(service, field, orgId)
//   service — the service/module name calling this helper (e.g. "documentBundleService")
//   field   — the derived field that is null (e.g. "utilizationByModelFamily")
//   orgId   — the organisation ID for which the field is missing
// ---------------------------------------------------------------------------

/** In-memory Set of keys already emitted at WARN level this process lifetime. */
const _warnedKeys = new Set<string>();

/**
 * Log a missing async-produced derived-data field.
 *
 * First call for a given (service, field, orgId) triple emits at WARN.
 * Subsequent calls emit at DEBUG (suppressed by default in production).
 *
 * @param service - Calling service name, e.g. "documentBundleService"
 * @param field   - Derived field name, e.g. "utilizationByModelFamily"
 * @param orgId   - Organisation ID for which the field is null
 */
export function logDataDependencyMissing(
  service: string,
  field: string,
  orgId: string,
): void {
  const key = `${service}.${field}:${orgId}`;
  if (_warnedKeys.has(key)) {
    logger.debug('data_dependency_missing', { service, field, orgId, repeated: true });
    return;
  }
  _warnedKeys.add(key);
  logger.warn('data_dependency_missing', { service, field, orgId });
}

/**
 * Reset the warned-keys set. Intended for use in tests only.
 * Do not call in production code.
 */
export function _resetWarnedKeysForTesting(): void {
  _warnedKeys.clear();
}
