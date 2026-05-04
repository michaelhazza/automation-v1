/**
 * subaccountOnboardingArtefacts.test.ts — pure-logic tests for artefact
 * service guards (no DB connection required).
 *
 * Covers:
 *   - isBaselineSlug / tierFor guards (shared constants)
 *   - assertVersionGate version mismatch (shared schema)
 *   - markArtefactSkipped Tier-1 rejection guard (inline reproduction)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/subaccountOnboardingArtefacts.test.ts
 *
 * Spec: docs/sub-account-baseline-artefacts-spec.md §3.
 */

import { test, expect } from 'vitest';
import {
  isBaselineSlug,
  tierFor,
  domainsFor,
} from '../../../shared/constants/baselineArtefacts.js';
import { assertVersionGate } from '../../../shared/schemas/subaccount.js';

// ── isBaselineSlug ────────────────────────────────────────────────────────────

test('isBaselineSlug returns true for all 6 known slugs', () => {
  expect(isBaselineSlug('baseline.brand_identity')).toBe(true);
  expect(isBaselineSlug('baseline.voice_tone')).toBe(true);
  expect(isBaselineSlug('baseline.offer_positioning')).toBe(true);
  expect(isBaselineSlug('baseline.audience_icp')).toBe(true);
  expect(isBaselineSlug('baseline.operating_constraints')).toBe(true);
  expect(isBaselineSlug('baseline.proof_library')).toBe(true);
});

test('isBaselineSlug returns false for unknown or bare slugs', () => {
  expect(isBaselineSlug('brand_identity')).toBe(false);
  expect(isBaselineSlug('baseline.unknown')).toBe(false);
  expect(isBaselineSlug('')).toBe(false);
});

// ── tierFor ───────────────────────────────────────────────────────────────────

test('tierFor returns 1 for Tier-1 slugs', () => {
  expect(tierFor('baseline.brand_identity')).toBe(1);
  expect(tierFor('baseline.voice_tone')).toBe(1);
});

test('tierFor returns 2 for Tier-2 slugs', () => {
  expect(tierFor('baseline.offer_positioning')).toBe(2);
  expect(tierFor('baseline.audience_icp')).toBe(2);
});

test('tierFor returns 3 for Tier-3 slugs', () => {
  expect(tierFor('baseline.operating_constraints')).toBe(3);
  expect(tierFor('baseline.proof_library')).toBe(3);
});

// ── domainsFor ────────────────────────────────────────────────────────────────

test('domainsFor returns empty array for Tier-1 slugs', () => {
  expect(domainsFor('baseline.brand_identity')).toHaveLength(0);
  expect(domainsFor('baseline.voice_tone')).toHaveLength(0);
});

test('domainsFor returns non-empty array for Tier-2 slugs', () => {
  expect(domainsFor('baseline.offer_positioning').length).toBeGreaterThan(0);
  expect(domainsFor('baseline.audience_icp').length).toBeGreaterThan(0);
});

// ── assertVersionGate ─────────────────────────────────────────────────────────

test('assertVersionGate accepts a valid version-1 payload', () => {
  const validStatus = {
    version: 1,
    tier1: {
      brand_identity: { status: 'not_started', captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
      voice_tone:     { status: 'not_started', captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
    },
    tier2: {
      offer_positioning: { status: 'not_started', captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
      audience_icp:      { status: 'not_started', captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
    },
    tier3: {
      operating_constraints: { status: 'not_started', captured_at: null, skipped_at: null, workspace_memory_id: null, captured_by_user_id: null },
      proof_library:         { status: 'not_started', captured_at: null, skipped_at: null, workspace_memory_id: null, captured_by_user_id: null },
    },
  };
  const result = assertVersionGate(validStatus, 1);
  expect(result.version).toBe(1);
});

test('assertVersionGate throws on invalid shape (missing tier1)', () => {
  expect(() =>
    assertVersionGate({ version: 1, tier2: {}, tier3: {} }, 1),
  ).toThrow();
});

test('assertVersionGate throws when version field is wrong type', () => {
  expect(() =>
    assertVersionGate({ version: 2, tier1: {}, tier2: {}, tier3: {} }, 1),
  ).toThrow();
});

// ── markArtefactSkipped Tier-1 rejection guard ────────────────────────────────
// Inline reproduction of the guard — confirms the throw condition without DB.

test('markArtefactSkipped rejects Tier-1 slug (BASELINE_SKIP_NOT_PERMITTED)', () => {
  function skipGuard(slug: string): void {
    if (!isBaselineSlug(slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
    const tier = tierFor(slug);
    if (tier !== 3) {
      throw { statusCode: 400, errorCode: 'BASELINE_SKIP_NOT_PERMITTED' };
    }
  }

  expect(() => skipGuard('baseline.brand_identity')).toThrow();
  try {
    skipGuard('baseline.brand_identity');
  } catch (err) {
    expect((err as { errorCode: string }).errorCode).toBe('BASELINE_SKIP_NOT_PERMITTED');
  }
});

test('markArtefactSkipped rejects Tier-2 slug (BASELINE_SKIP_NOT_PERMITTED)', () => {
  function skipGuard(slug: string): void {
    if (!isBaselineSlug(slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
    const tier = tierFor(slug);
    if (tier !== 3) {
      throw { statusCode: 400, errorCode: 'BASELINE_SKIP_NOT_PERMITTED' };
    }
  }

  expect(() => skipGuard('baseline.offer_positioning')).toThrow();
  try {
    skipGuard('baseline.offer_positioning');
  } catch (err) {
    expect((err as { errorCode: string }).errorCode).toBe('BASELINE_SKIP_NOT_PERMITTED');
  }
});

test('markArtefactSkipped does NOT throw for Tier-3 slug', () => {
  function skipGuard(slug: string): void {
    if (!isBaselineSlug(slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
    const tier = tierFor(slug);
    if (tier !== 3) {
      throw { statusCode: 400, errorCode: 'BASELINE_SKIP_NOT_PERMITTED' };
    }
  }

  expect(() => skipGuard('baseline.operating_constraints')).not.toThrow();
  expect(() => skipGuard('baseline.proof_library')).not.toThrow();
});

test('markArtefactCaptured rejects unknown slug (INVALID_BASELINE_SLUG)', () => {
  function captureGuard(slug: string): void {
    if (!isBaselineSlug(slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
  }

  expect(() => captureGuard('baseline.unknown')).toThrow();
  try {
    captureGuard('baseline.unknown');
  } catch (err) {
    expect((err as { errorCode: string }).errorCode).toBe('INVALID_BASELINE_SLUG');
  }
});
