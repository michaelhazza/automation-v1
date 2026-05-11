/**
 * templateVersionParserPure.ts — Pure parser for sandbox template version files.
 *
 * Spec B §15.2, §25.2: Parses CURRENT_VERSION and PUBLISHED_VERSION files from
 * infra/sandbox-templates/{name}/. Surface-area for the verify-template-version-coherence
 * CI gate (C14).
 *
 * Both files use `key=value` format, one field per line, exactly five fields each.
 * Parsers throw a descriptive Error on any malformed, missing, or empty input —
 * the CI gate treats thrown errors as hard failures.
 *
 * No imports: pure functions only, no DB, no network, no side effects.
 */

/**
 * Parsed representation of CURRENT_VERSION (spec §15.2).
 * Written by humans / build agents in the same PR as the template change.
 */
export interface CurrentVersion {
  version: string;
  template_resource_class: string;
  max_cost_cents_per_second: number;
  base_image_digest: string;
  deps_lockfile_hash: string;
}

/**
 * Parsed representation of PUBLISHED_VERSION (spec §15.2).
 * Written by CI's post-publish attestation workflow.
 */
export interface PublishedVersion {
  version: string;
  image_digest: string;
  ci_build_commit: string;
  registry_published_at: string;
  scanner_result_hash: string;
}

// The ordered field names for each file — exact set, order preserved for error messages.
const CURRENT_VERSION_FIELDS = [
  'version',
  'template_resource_class',
  'max_cost_cents_per_second',
  'base_image_digest',
  'deps_lockfile_hash',
] as const;

const PUBLISHED_VERSION_FIELDS = [
  'version',
  'image_digest',
  'ci_build_commit',
  'registry_published_at',
  'scanner_result_hash',
] as const;

/**
 * Parse a key=value text block. Returns a map of key → value strings.
 * Throws if:
 *   - text is empty or whitespace-only
 *   - any non-empty line does not match the `key=value` pattern
 *   - a key appears more than once
 */
function parseKeyValueBlock(text: string, fileLabel: string): Map<string, string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fileLabel}: file is empty`);
  }

  const result = new Map<string, string>();

  const lines = trimmed.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue; // tolerate blank separating lines

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(
        `${fileLabel}: malformed line — expected key=value, got: ${JSON.stringify(line)}`,
      );
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    if (key.length === 0) {
      throw new Error(
        `${fileLabel}: malformed line — key is empty in: ${JSON.stringify(line)}`,
      );
    }

    if (result.has(key)) {
      throw new Error(`${fileLabel}: duplicate key: ${JSON.stringify(key)}`);
    }

    result.set(key, value);
  }

  return result;
}

/**
 * Extract and validate required fields from a parsed key-value map.
 * Throws if any required field is missing or has an empty value.
 */
function requireFields(
  parsed: Map<string, string>,
  requiredFields: readonly string[],
  fileLabel: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of requiredFields) {
    const value = parsed.get(field);
    if (value === undefined) {
      throw new Error(
        `${fileLabel}: missing required field: ${JSON.stringify(field)} — required fields: ${requiredFields.join(', ')}`,
      );
    }
    if (value.length === 0) {
      throw new Error(
        `${fileLabel}: field ${JSON.stringify(field)} is present but has an empty value`,
      );
    }
    result[field] = value;
  }
  return result;
}

/**
 * Parse the text content of a CURRENT_VERSION file.
 *
 * Validates the five-field shape (spec §15.2). Throws a descriptive Error on any
 * missing field, malformed line, or empty file.
 *
 * @param text - raw text content of the CURRENT_VERSION file
 * @returns parsed CurrentVersion object
 */
export function parseCurrentVersion(text: string): CurrentVersion {
  const fileLabel = 'CURRENT_VERSION';
  const parsed = parseKeyValueBlock(text, fileLabel);
  const fields = requireFields(parsed, CURRENT_VERSION_FIELDS, fileLabel);

  const maxCost = Number(fields['max_cost_cents_per_second']);
  if (!Number.isFinite(maxCost) || maxCost < 0) {
    throw new Error(
      `${fileLabel}: field max_cost_cents_per_second must be a non-negative finite number, got: ${JSON.stringify(fields['max_cost_cents_per_second'])}`,
    );
  }

  return {
    version: fields['version']!,
    template_resource_class: fields['template_resource_class']!,
    max_cost_cents_per_second: maxCost,
    base_image_digest: fields['base_image_digest']!,
    deps_lockfile_hash: fields['deps_lockfile_hash']!,
  };
}

/**
 * Parse the text content of a PUBLISHED_VERSION file.
 *
 * Validates the five-field shape (spec §15.2). Throws a descriptive Error on any
 * missing field, malformed line, or empty file.
 *
 * @param text - raw text content of the PUBLISHED_VERSION file
 * @returns parsed PublishedVersion object
 */
export function parsePublishedVersion(text: string): PublishedVersion {
  const fileLabel = 'PUBLISHED_VERSION';
  const parsed = parseKeyValueBlock(text, fileLabel);
  const fields = requireFields(parsed, PUBLISHED_VERSION_FIELDS, fileLabel);

  return {
    version: fields['version']!,
    image_digest: fields['image_digest']!,
    ci_build_commit: fields['ci_build_commit']!,
    registry_published_at: fields['registry_published_at']!,
    scanner_result_hash: fields['scanner_result_hash']!,
  };
}

/**
 * Assert that a CURRENT_VERSION and PUBLISHED_VERSION agree on the version field.
 *
 * Per spec §15.2, after a publish the `PUBLISHED_VERSION.version` must match
 * `CURRENT_VERSION.version`. The verify-template-version-coherence CI gate calls
 * this as a post-publish coherence check.
 *
 * @throws Error if the versions do not match
 */
export function assertVersionsMatch(
  current: CurrentVersion,
  published: PublishedVersion,
): void {
  if (current.version !== published.version) {
    throw new Error(
      `version mismatch: CURRENT_VERSION.version=${JSON.stringify(current.version)} does not match PUBLISHED_VERSION.version=${JSON.stringify(published.version)}`,
    );
  }
}
