/**
 * artefactFilenameSanitiserPure.test.ts — Pure tests for S3 artefact filename sanitiser.
 *
 * Spec §8.4 (SANDBOX-ADV-4.2). Covers the full discriminated-union mapping.
 *
 * No DB, no network, no side effects.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/artefactFilenameSanitiserPure.test.ts
 */

import { describe, test, expect } from 'vitest';
import { sanitiseArtefactFilename } from '../artefactFilenameSanitiserPure.js';

describe('sanitiseArtefactFilename', () => {
  test('Test 1: normal filename → ok: true', () => {
    expect(sanitiseArtefactFilename('report.pdf')).toEqual({ ok: true, sanitisedName: 'report.pdf' });
  });

  test('Test 2: path traversal → contains_path_traversal', () => {
    expect(sanitiseArtefactFilename('../etc/passwd')).toEqual({ ok: false, reason: 'contains_path_traversal' });
  });

  test('Test 3: absolute path → absolute_path', () => {
    expect(sanitiseArtefactFilename('/abs/path.txt')).toEqual({ ok: false, reason: 'absolute_path' });
  });

  test('Test 4: empty string → empty', () => {
    expect(sanitiseArtefactFilename('')).toEqual({ ok: false, reason: 'empty' });
  });

  test('Test 5: filename with spaces → ok: true', () => {
    expect(sanitiseArtefactFilename('file with space.txt')).toEqual({ ok: true, sanitisedName: 'file with space.txt' });
  });

  test('Test 6: nested path → contains_path_traversal', () => {
    expect(sanitiseArtefactFilename('foo/bar.txt')).toEqual({ ok: false, reason: 'contains_path_traversal' });
  });

  test('Test 7: control char (tab) in filename → disallowed_chars', () => {
    expect(sanitiseArtefactFilename('foo\tbar.txt')).toEqual({ ok: false, reason: 'disallowed_chars' });
  });

  test('Test 8: non-allow-list unicode → disallowed_chars', () => {
    expect(sanitiseArtefactFilename('café.pdf')).toEqual({ ok: false, reason: 'disallowed_chars' });
  });
});
