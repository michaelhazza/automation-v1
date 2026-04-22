/**
 * Deep-equal helper for the Settings UI's "overridden" + "reset-to-default"
 * logic (spec §4.5 derived states).
 *
 * `hasExplicitOverride(path)` — true iff the path is present in the raw
 * override row. Presence = the leaf was explicitly written.
 *
 * `differsFromTemplate(path)` — true iff the effective leaf value is not
 * deep-equal to the system-defaults-only value at that path. Used for
 * badge display + reset-button enablement.
 *
 * Deep-equality is required because leaves include arrays and nested
 * objects; JS !== is reference equality and mis-enables on every such leaf.
 */

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export function readPath(source: unknown, path: string): unknown {
  if (!path) return source;
  const parts = path.split('.');
  let cursor: unknown = source;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * Returns true iff the raw override row has the path set at any level (the
 * path is "present" — the leaf was explicitly written).
 */
export function hasExplicitOverride(
  overrides: Record<string, unknown> | null | undefined,
  path: string,
): boolean {
  if (!overrides) return false;
  const parts = path.split('.');
  let cursor: unknown = overrides;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return false;
    const next = (cursor as Record<string, unknown>)[part];
    if (next === undefined) return false;
    cursor = next;
  }
  return true;
}

/**
 * Returns true iff the effective value at the path differs from the
 * system-defaults-only value at the same path. Deep-equality.
 */
export function differsFromTemplate(
  systemDefaults: Record<string, unknown> | null | undefined,
  effective: Record<string, unknown>,
  path: string,
): boolean {
  const sys = readPath(systemDefaults ?? {}, path);
  const eff = readPath(effective, path);
  return !deepEqual(sys, eff);
}
