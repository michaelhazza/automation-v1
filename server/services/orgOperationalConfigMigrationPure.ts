/**
 * orgOperationalConfigMigrationPure — pure decode of the Session 1
 * operational-config read chain.
 *
 * Per contract (h) in tasks/builds/clientpulse/session-1-foundation-spec.md
 * §1.3: the effective operational config for an organisation is
 *
 *     systemHierarchyTemplates.operationalDefaults  (nullable)
 *   deep-merged with
 *     organisations.operational_config_override     (nullable)
 *
 * This module contains the pure merge function only — no I/O. Chunk A.2's
 * `getOperationalConfig` loads the two rows and calls
 * `resolveEffectiveOperationalConfig` to produce the effective config.
 * Until A.2 lands, `orgConfigService.ts` still reads the legacy
 * `hierarchyTemplates.operationalConfigSeed` column; this pure module
 * exists so the decoder is test-locked before the service retarget.
 */

export type ConfigRecord = Record<string, unknown>;

/**
 * Deep-merge `overrides` onto `systemDefaults`. Object leaves merge
 * recursively; array leaves REPLACE wholesale (not concatenate); primitive
 * leaves REPLACE.
 *
 * Per spec §4.5 / contract (h):
 *   - Null override → return systemDefaults untouched (may be {} if systemDefaults is null).
 *   - Null systemDefaults + non-null override → return override as-is
 *     (legacy pre-Session-1 org case: the org was adopted before a system
 *     template was associated; the override is the only source of truth).
 *   - Both null → return {}.
 */
export function resolveEffectiveOperationalConfig(
  systemDefaults: ConfigRecord | null | undefined,
  overrides: ConfigRecord | null | undefined,
): ConfigRecord {
  const base: ConfigRecord = systemDefaults ?? {};
  const patch: ConfigRecord = overrides ?? {};
  return deepMerge(base, patch);
}

function deepMerge(target: ConfigRecord, source: ConfigRecord): ConfigRecord {
  const result: ConfigRecord = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as ConfigRecord, sourceVal as ConfigRecord);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
