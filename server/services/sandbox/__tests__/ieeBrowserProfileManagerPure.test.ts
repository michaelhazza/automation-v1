/**
 * ieeBrowserProfileManagerPure.test.ts — Pure function tests for the IEE
 * browser profile manager helpers.
 *
 * Spec §13.7 (status transitions), §15 (GC retention).
 *
 * Covers:
 *   - assertSameTenant: accepts exact match, throws on org mismatch, throws on subaccount mismatch
 *   - resolveRetentionDays: retentionDaysOverride; settings fallback; default 30; clamp low; clamp high
 *   - isValidStatusTransition: all 4 valid transitions; rejects gc_done → *; rejects active → gc_in_progress
 *
 * No DB, no network.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/ieeBrowserProfileManagerPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  assertSameTenant,
  resolveRetentionDays,
  isValidStatusTransition,
} from '../ieeBrowserProfileManagerPure.js';
import type { IeeBrowserSessionProfile } from '../../../db/schema/ieeBrowserSessionProfiles.js';

// ---------------------------------------------------------------------------
// Minimal profile stub — avoids DB fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<IeeBrowserSessionProfile> = {}): IeeBrowserSessionProfile {
  return {
    id: 'profile-uuid-1',
    organisationId: 'org-uuid-1',
    subaccountId: 'sub-uuid-1',
    sessionKey: 'default',
    volumeId: 'vol-uuid-1',
    lastUsedAt: new Date('2026-01-01T00:00:00Z'),
    sizeBytes: 0,
    sizeCapBytes: 524288000,
    status: 'active',
    scheduledGcAt: null,
    gcStartedAt: null,
    retentionDaysOverride: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assertSameTenant
// ---------------------------------------------------------------------------

describe('assertSameTenant', () => {
  it('accepts exact tenant match', () => {
    const profile = makeProfile({ organisationId: 'org-1', subaccountId: 'sub-1' });
    expect(() =>
      assertSameTenant(profile, { organisationId: 'org-1', subaccountId: 'sub-1' }),
    ).not.toThrow();
  });

  it('throws SafetyError on organisation mismatch', () => {
    const profile = makeProfile({ organisationId: 'org-1', subaccountId: 'sub-1' });
    expect(() =>
      assertSameTenant(profile, { organisationId: 'org-OTHER', subaccountId: 'sub-1' }),
    ).toThrow('cross_tenant_mount_attempted');
  });

  it('throws SafetyError on subaccount mismatch', () => {
    const profile = makeProfile({ organisationId: 'org-1', subaccountId: 'sub-1' });
    expect(() =>
      assertSameTenant(profile, { organisationId: 'org-1', subaccountId: 'sub-OTHER' }),
    ).toThrow('cross_tenant_mount_attempted');
  });
});

// ---------------------------------------------------------------------------
// resolveRetentionDays
// ---------------------------------------------------------------------------

describe('resolveRetentionDays', () => {
  it('returns retentionDaysOverride when set', () => {
    const profile = makeProfile({ retentionDaysOverride: 45 });
    expect(resolveRetentionDays(profile, { browserProfileRetentionDays: 20 })).toBe(45);
  });

  it('falls back to settings.browserProfileRetentionDays when override is null', () => {
    const profile = makeProfile({ retentionDaysOverride: null });
    expect(resolveRetentionDays(profile, { browserProfileRetentionDays: 60 })).toBe(60);
  });

  it('falls back to 30 when settings is null and no override', () => {
    const profile = makeProfile({ retentionDaysOverride: null });
    expect(resolveRetentionDays(profile, null)).toBe(30);
  });

  it('clamps low values to 7', () => {
    const profile = makeProfile({ retentionDaysOverride: 3 });
    expect(resolveRetentionDays(profile, null)).toBe(7);
  });

  it('clamps high values to 90', () => {
    const profile = makeProfile({ retentionDaysOverride: 120 });
    expect(resolveRetentionDays(profile, null)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// isValidStatusTransition
// ---------------------------------------------------------------------------

describe('isValidStatusTransition', () => {
  it('accepts active → scheduled_gc', () => {
    expect(isValidStatusTransition('active', 'scheduled_gc')).toBe(true);
  });

  it('accepts scheduled_gc → active (reprieve)', () => {
    expect(isValidStatusTransition('scheduled_gc', 'active')).toBe(true);
  });

  it('accepts scheduled_gc → gc_in_progress', () => {
    expect(isValidStatusTransition('scheduled_gc', 'gc_in_progress')).toBe(true);
  });

  it('accepts gc_in_progress → gc_done', () => {
    expect(isValidStatusTransition('gc_in_progress', 'gc_done')).toBe(true);
  });

  it('rejects gc_done → active', () => {
    expect(isValidStatusTransition('gc_done', 'active')).toBe(false);
  });

  it('rejects gc_done → scheduled_gc', () => {
    expect(isValidStatusTransition('gc_done', 'scheduled_gc')).toBe(false);
  });

  it('rejects gc_done → gc_in_progress', () => {
    expect(isValidStatusTransition('gc_done', 'gc_in_progress')).toBe(false);
  });

  it('rejects active → gc_in_progress', () => {
    expect(isValidStatusTransition('active', 'gc_in_progress')).toBe(false);
  });

  it('rejects active → gc_done', () => {
    expect(isValidStatusTransition('active', 'gc_done')).toBe(false);
  });
});
