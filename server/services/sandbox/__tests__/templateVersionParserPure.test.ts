/**
 * templateVersionParserPure.test.ts — Pure tests for the template version file parser.
 *
 * Spec B §15.2, §25.4: covers the five required test scenarios:
 *   1. Valid 5-field CURRENT_VERSION file
 *   2. Valid 5-field PUBLISHED_VERSION file
 *   3. Missing field
 *   4. Malformed line (no `=` separator)
 *   5. Empty file
 *   6. Mismatched version between CURRENT_VERSION and PUBLISHED_VERSION
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/templateVersionParserPure.test.ts
 */

import { describe, test, expect } from 'vitest';
import {
  parseCurrentVersion,
  parsePublishedVersion,
  assertVersionsMatch,
  type CurrentVersion,
  type PublishedVersion,
} from '../templateVersionParserPure.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_CURRENT_VERSION_TEXT = `version=v1.0.0
template_resource_class=cpu-small
max_cost_cents_per_second=0.00042
base_image_digest=sha256:a7e2d85b97e4a0dbc9c1e4fc2d0b5d7f8e9a1b3c5d7e9f1a3b5c7d9e1f3a5b7
deps_lockfile_hash=sha256:0000000000000000000000000000000000000000000000000000000000000000
`;

const VALID_PUBLISHED_VERSION_TEXT = `version=v1.0.0
image_digest=sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1
ci_build_commit=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b
registry_published_at=2026-05-11T10:00:00Z
scanner_result_hash=sha256:789abc012def789abc012def789abc012def789abc012def789abc012def789a
`;

// ── Case 1: valid CURRENT_VERSION ────────────────────────────────────────────

describe('parseCurrentVersion', () => {
  test('case 1 — parses a valid 5-field CURRENT_VERSION file', () => {
    const result = parseCurrentVersion(VALID_CURRENT_VERSION_TEXT);

    expect(result.version).toBe('v1.0.0');
    expect(result.template_resource_class).toBe('cpu-small');
    expect(result.max_cost_cents_per_second).toBe(0.00042);
    expect(result.base_image_digest).toBe(
      'sha256:a7e2d85b97e4a0dbc9c1e4fc2d0b5d7f8e9a1b3c5d7e9f1a3b5c7d9e1f3a5b7',
    );
    expect(result.deps_lockfile_hash).toBe(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    );
  });

  test('case 3 — throws on missing field (deps_lockfile_hash absent)', () => {
    const text = `version=v1.0.0
template_resource_class=cpu-small
max_cost_cents_per_second=0.00042
base_image_digest=sha256:abc123
`;
    expect(() => parseCurrentVersion(text)).toThrow('missing required field');
    expect(() => parseCurrentVersion(text)).toThrow('deps_lockfile_hash');
  });

  test('case 3 — throws on missing field (version absent)', () => {
    const text = `template_resource_class=cpu-small
max_cost_cents_per_second=0.00042
base_image_digest=sha256:abc123
deps_lockfile_hash=sha256:def456
`;
    expect(() => parseCurrentVersion(text)).toThrow('missing required field');
    expect(() => parseCurrentVersion(text)).toThrow('version');
  });

  test('case 4 — throws on malformed line (no = separator)', () => {
    const text = `version=v1.0.0
template_resource_class cpu-small
max_cost_cents_per_second=0.00042
base_image_digest=sha256:abc123
deps_lockfile_hash=sha256:def456
`;
    expect(() => parseCurrentVersion(text)).toThrow('malformed line');
    expect(() => parseCurrentVersion(text)).toThrow('key=value');
  });

  test('case 5 — throws on empty file', () => {
    expect(() => parseCurrentVersion('')).toThrow('file is empty');
    expect(() => parseCurrentVersion('   \n   ')).toThrow('file is empty');
  });

  test('throws on non-numeric max_cost_cents_per_second', () => {
    const text = `version=v1.0.0
template_resource_class=cpu-small
max_cost_cents_per_second=not-a-number
base_image_digest=sha256:abc123
deps_lockfile_hash=sha256:def456
`;
    expect(() => parseCurrentVersion(text)).toThrow('max_cost_cents_per_second');
    expect(() => parseCurrentVersion(text)).toThrow('non-negative finite number');
  });

  test('throws on negative max_cost_cents_per_second', () => {
    const text = `version=v1.0.0
template_resource_class=cpu-small
max_cost_cents_per_second=-0.001
base_image_digest=sha256:abc123
deps_lockfile_hash=sha256:def456
`;
    expect(() => parseCurrentVersion(text)).toThrow('max_cost_cents_per_second');
    expect(() => parseCurrentVersion(text)).toThrow('non-negative finite number');
  });

  test('throws on duplicate key', () => {
    const text = `version=v1.0.0
version=v1.0.1
template_resource_class=cpu-small
max_cost_cents_per_second=0.00042
base_image_digest=sha256:abc123
deps_lockfile_hash=sha256:def456
`;
    expect(() => parseCurrentVersion(text)).toThrow('duplicate key');
    expect(() => parseCurrentVersion(text)).toThrow('"version"');
  });

  test('returns max_cost_cents_per_second as a number', () => {
    const result = parseCurrentVersion(VALID_CURRENT_VERSION_TEXT);
    expect(typeof result.max_cost_cents_per_second).toBe('number');
  });
});

// ── Case 2: valid PUBLISHED_VERSION ──────────────────────────────────────────

describe('parsePublishedVersion', () => {
  test('case 2 — parses a valid 5-field PUBLISHED_VERSION file', () => {
    const result = parsePublishedVersion(VALID_PUBLISHED_VERSION_TEXT);

    expect(result.version).toBe('v1.0.0');
    expect(result.image_digest).toBe(
      'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    );
    expect(result.ci_build_commit).toBe('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b');
    expect(result.registry_published_at).toBe('2026-05-11T10:00:00Z');
    expect(result.scanner_result_hash).toBe(
      'sha256:789abc012def789abc012def789abc012def789abc012def789abc012def789a',
    );
  });

  test('case 3 — throws on missing field (image_digest absent)', () => {
    const text = `version=v1.0.0
ci_build_commit=abc123
registry_published_at=2026-05-11T10:00:00Z
scanner_result_hash=sha256:def456
`;
    expect(() => parsePublishedVersion(text)).toThrow('missing required field');
    expect(() => parsePublishedVersion(text)).toThrow('image_digest');
  });

  test('case 4 — throws on malformed line (no = separator)', () => {
    const text = `version=v1.0.0
image_digest sha256:abc123
ci_build_commit=abc
registry_published_at=2026-05-11T10:00:00Z
scanner_result_hash=sha256:def456
`;
    expect(() => parsePublishedVersion(text)).toThrow('malformed line');
  });

  test('case 5 — throws on empty file', () => {
    expect(() => parsePublishedVersion('')).toThrow('file is empty');
  });
});

// ── Case 6: mismatched version between CURRENT and PUBLISHED ─────────────────

describe('assertVersionsMatch', () => {
  test('case 6 — throws when CURRENT_VERSION.version !== PUBLISHED_VERSION.version', () => {
    const current: CurrentVersion = {
      version: 'v1.0.0',
      template_resource_class: 'cpu-small',
      max_cost_cents_per_second: 0.00042,
      base_image_digest: 'sha256:abc',
      deps_lockfile_hash: 'sha256:def',
    };
    const published: PublishedVersion = {
      version: 'v1.0.1',  // mismatch
      image_digest: 'sha256:img',
      ci_build_commit: 'abc123',
      registry_published_at: '2026-05-11T10:00:00Z',
      scanner_result_hash: 'sha256:scan',
    };

    expect(() => assertVersionsMatch(current, published)).toThrow('version mismatch');
    expect(() => assertVersionsMatch(current, published)).toThrow('"v1.0.0"');
    expect(() => assertVersionsMatch(current, published)).toThrow('"v1.0.1"');
  });

  test('passes when versions match', () => {
    const current: CurrentVersion = {
      version: 'v1.0.0',
      template_resource_class: 'cpu-small',
      max_cost_cents_per_second: 0.00042,
      base_image_digest: 'sha256:abc',
      deps_lockfile_hash: 'sha256:def',
    };
    const published: PublishedVersion = {
      version: 'v1.0.0',  // match
      image_digest: 'sha256:img',
      ci_build_commit: 'abc123',
      registry_published_at: '2026-05-11T10:00:00Z',
      scanner_result_hash: 'sha256:scan',
    };

    expect(() => assertVersionsMatch(current, published)).not.toThrow();
  });

  test('round-trip: parse both files and assert version match', () => {
    const current = parseCurrentVersion(VALID_CURRENT_VERSION_TEXT);
    const published = parsePublishedVersion(VALID_PUBLISHED_VERSION_TEXT);
    expect(() => assertVersionsMatch(current, published)).not.toThrow();
  });
});
