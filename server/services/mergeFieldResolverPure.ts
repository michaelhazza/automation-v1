/**
 * Merge-field resolver — pure V1 grammar (§16).
 *
 * Grammar:
 *   {{namespace.path}}   — single token, no whitespace inside, no fallback
 *                          syntax (|), no conditionals. Nested paths allowed
 *                          (e.g. `{{contact.address.line1}}`).
 *   Allowed namespaces:  contact, subaccount, signals, org, agency
 *
 * Strict:
 *   - Unknown namespace or missing field → literal `{{…}}` stays in the
 *     output AND the path appears in the returned `unresolved` array
 *     (deduplicated, set semantics).
 *   - Malformed grammar (unmatched `{{`, empty `{{}}`) → throws.
 *
 * No I/O. Namespace inputs are passed in by the caller.
 */

export type MergeFieldNamespace =
  | 'contact'
  | 'subaccount'
  | 'signals'
  | 'org'
  | 'agency';

export const MERGE_FIELD_NAMESPACES: readonly MergeFieldNamespace[] = Object.freeze([
  'contact',
  'subaccount',
  'signals',
  'org',
  'agency',
]);

export interface MergeFieldInputs {
  contact?: Record<string, unknown>;
  subaccount?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  org?: Record<string, unknown>;
  agency?: Record<string, unknown>;
}

export interface ResolveResult {
  output: string;
  unresolved: string[];
}

const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

export function resolveMergeFields(
  template: string,
  inputs: MergeFieldInputs,
): ResolveResult {
  if (typeof template !== 'string') {
    throw new Error('merge field template must be a string');
  }

  // Malformed grammar: an unmatched `{{` (one that does not close) is a hard
  // error. We detect this by scanning for `{{` occurrences that are not part
  // of a successful token match.
  const unmatched = findUnmatchedOpen(template);
  if (unmatched !== -1) {
    throw new Error(
      `malformed merge-field grammar: unmatched '{{' at position ${unmatched}`,
    );
  }

  // Empty token `{{}}` (or `{{ }}`) is a hard error — operators likely meant
  // to type a field name and left it blank.
  if (/\{\{\s*\}\}/.test(template)) {
    throw new Error('malformed merge-field grammar: empty token {{}}');
  }

  const unresolvedSet = new Set<string>();

  const output = template.replace(TOKEN_RE, (fullMatch, rawPath: string) => {
    const path = rawPath.trim();
    if (path.length === 0) {
      throw new Error('malformed merge-field grammar: empty token {{}}');
    }

    const firstDot = path.indexOf('.');
    if (firstDot === -1) {
      unresolvedSet.add(path);
      return fullMatch;
    }

    const namespace = path.slice(0, firstDot) as MergeFieldNamespace;
    const rest = path.slice(firstDot + 1);

    if (!MERGE_FIELD_NAMESPACES.includes(namespace)) {
      unresolvedSet.add(path);
      return fullMatch;
    }

    const nsValue = inputs[namespace];
    if (!nsValue || typeof nsValue !== 'object') {
      unresolvedSet.add(path);
      return fullMatch;
    }

    const value = lookupNestedPath(nsValue as Record<string, unknown>, rest);
    if (value === undefined || value === null) {
      unresolvedSet.add(path);
      return fullMatch;
    }

    if (typeof value === 'object') {
      // V1: objects cannot be rendered directly — mark unresolved.
      unresolvedSet.add(path);
      return fullMatch;
    }

    return String(value);
  });

  return {
    output,
    unresolved: Array.from(unresolvedSet),
  };
}

/**
 * Scan for `{{` occurrences that do not close with `}}`. Returns the index
 * of the first unmatched open, or -1 if every `{{` has a matching `}}`.
 *
 * Note: this is looser than strict grammar — we accept any content between
 * `{{` and `}}` (the token regex validates the inner path separately). The
 * goal here is to catch the specific "missing close" failure mode.
 */
function findUnmatchedOpen(template: string): number {
  let idx = 0;
  while (idx < template.length) {
    const open = template.indexOf('{{', idx);
    if (open === -1) return -1;
    const close = template.indexOf('}}', open + 2);
    if (close === -1) return open;
    idx = close + 2;
  }
  return -1;
}

function lookupNestedPath(
  source: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Helper: resolve merge fields on an object whose string leaves are templates.
 * Used by the email + sms editors where subject + body are separate strings.
 * Returns the transformed object + the union of all unresolved paths.
 */
export function resolveMergeFieldsOnObject(
  obj: Record<string, string | undefined>,
  inputs: MergeFieldInputs,
): { output: Record<string, string | undefined>; unresolved: string[] } {
  const output: Record<string, string | undefined> = {};
  const unresolvedSet = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      output[key] = undefined;
      continue;
    }
    const result = resolveMergeFields(value, inputs);
    output[key] = result.output;
    for (const path of result.unresolved) unresolvedSet.add(path);
  }
  return { output, unresolved: Array.from(unresolvedSet) };
}
