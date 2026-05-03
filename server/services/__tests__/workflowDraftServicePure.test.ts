/**
 * workflowDraftServicePure.test.ts
 *
 * Pure-logic tests for validateDraftPayload and decideDraftAccessOutcome.
 * No database required.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/workflowDraftServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  validateDraftPayload,
  decideDraftAccessOutcome,
} from '../workflowDraftServicePure.js';

// ─── validateDraftPayload ─────────────────────────────────────────────────────

describe('validateDraftPayload', () => {
  test('string input: not ok, reason mentions array', () => {
    const r = validateDraftPayload('not an array');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('array');
  });

  test('null input: not ok', () => {
    const r = validateDraftPayload(null);
    expect(r.ok).toBe(false);
  });

  test('empty array: ok', () => {
    const r = validateDraftPayload([]);
    expect(r.ok).toBe(true);
  });

  test('valid single step: ok', () => {
    const r = validateDraftPayload([
      { id: 'step-1', name: 'Step One', type: 'agent', dependsOn: [] },
    ]);
    expect(r.ok).toBe(true);
  });

  test('valid multi-step: ok', () => {
    const r = validateDraftPayload([
      { id: 'step-1', name: 'Step One', type: 'agent', dependsOn: [] },
      { id: 'step-2', name: 'Step Two', type: 'ask', dependsOn: ['step-1'] },
    ]);
    expect(r.ok).toBe(true);
  });

  test('missing id: not ok, reason mentions id', () => {
    const r = validateDraftPayload([{ name: 'No ID', type: 'agent' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('id');
  });

  test('empty id string: not ok', () => {
    const r = validateDraftPayload([{ id: '', name: 'Empty ID', type: 'agent' }]);
    expect(r.ok).toBe(false);
  });

  test('missing name: not ok, reason mentions name', () => {
    const r = validateDraftPayload([{ id: 'step-1', type: 'agent' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('name');
  });

  test('missing type: not ok, reason mentions type', () => {
    const r = validateDraftPayload([{ id: 'step-1', name: 'S1' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('type');
  });

  test('non-object element: not ok', () => {
    const r = validateDraftPayload([42]);
    expect(r.ok).toBe(false);
  });
});

// ─── decideDraftAccessOutcome ─────────────────────────────────────────────────

describe('decideDraftAccessOutcome', () => {
  test('not found (exists=false, consumedAt=null): not_found', () => {
    expect(decideDraftAccessOutcome({ exists: false, consumedAt: null })).toBe('not_found');
  });

  test('not found even with consumedAt set: not_found', () => {
    expect(decideDraftAccessOutcome({ exists: false, consumedAt: new Date() })).toBe('not_found');
  });

  test('found + null consumedAt: fresh', () => {
    expect(decideDraftAccessOutcome({ exists: true, consumedAt: null })).toBe('fresh');
  });

  test('found + undefined consumedAt: fresh', () => {
    expect(decideDraftAccessOutcome({ exists: true, consumedAt: undefined })).toBe('fresh');
  });

  test('found + consumedAt set: already_consumed', () => {
    expect(decideDraftAccessOutcome({ exists: true, consumedAt: new Date('2025-01-01') })).toBe('already_consumed');
  });
});
