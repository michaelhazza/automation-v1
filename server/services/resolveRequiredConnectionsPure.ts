/**
 * resolveRequiredConnectionsPure — pure helper for pre-dispatch connection resolution.
 *
 * §1.2 REQ W1-44: verifies every required connection key is mapped for the
 * calling subaccount BEFORE a webhook is fired.
 *
 * Pure contract: deterministic, side-effect-free, no I/O.
 */

// @internal — exported for unit-testing; not part of the module's public API.
export type ResolutionResult =
  | { ok: true; resolved: Record<string, string> }
  | { ok: false; missing: string[] };

/**
 * Checks that every key in `automation.requiredConnections` has a mapping entry
 * with a non-empty `connectionId`. Returns the resolved map when all keys are
 * covered, or the ordered list of missing keys otherwise.
 *
 * Output-ordering contract: when `ok: false`, `missing` preserves the order in
 * which keys appear in `automation.requiredConnections` (spec §1.2).
 *
 * @internal
 */
export function resolveRequiredConnections(args: {
  automation: { requiredConnections: string[] | null };
  subaccountId: string;
  mappings: Array<{ connectionKey: string; connectionId: string }>;
}): ResolutionResult {
  const required = args.automation.requiredConnections;
  if (!required || required.length === 0) {
    return { ok: true, resolved: {} };
  }

  const mappingMap = new Map(args.mappings.map((m) => [m.connectionKey, m.connectionId]));
  const resolved: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of required) {
    const id = mappingMap.get(key);
    if (id && id.trim() !== '') {
      resolved[key] = id;
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, resolved };
}
