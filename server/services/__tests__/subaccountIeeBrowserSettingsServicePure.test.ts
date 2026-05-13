/**
 * subaccountIeeBrowserSettingsServicePure.test.ts
 *
 * Pure-function tests for IEE browser settings helpers.
 * No DB, no IO.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/subaccountIeeBrowserSettingsServicePure.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  patchBodySchema,
  rolloutBodySchema,
  isETagConflict,
  isLazyCreate,
  isLazyCreatePkConflict,
  buildRolloutAuditRow,
  synthesiseDefaults,
} from '../subaccountIeeBrowserSettingsServicePure.js';

// ---------------------------------------------------------------------------
// patchBodySchema — field range validation
// ---------------------------------------------------------------------------

describe('patchBodySchema', () => {
  describe('browserProfileRetentionDays', () => {
    it('rejects value below min (6)', () => {
      const result = patchBodySchema.safeParse({
        browserProfileRetentionDays: 6,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts min value (7)', () => {
      const result = patchBodySchema.safeParse({
        browserProfileRetentionDays: 7,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects value above max (91)', () => {
      const result = patchBodySchema.safeParse({
        browserProfileRetentionDays: 91,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts max value (90)', () => {
      const result = patchBodySchema.safeParse({
        browserProfileRetentionDays: 90,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('perTaskCostCeilingCents', () => {
    it('rejects value below min (0)', () => {
      const result = patchBodySchema.safeParse({
        perTaskCostCeilingCents: 0,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts min value (1)', () => {
      const result = patchBodySchema.safeParse({
        perTaskCostCeilingCents: 1,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects value above max (10001)', () => {
      const result = patchBodySchema.safeParse({
        perTaskCostCeilingCents: 10001,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts max value (10000)', () => {
      const result = patchBodySchema.safeParse({
        perTaskCostCeilingCents: 10000,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('perSubaccountDailyCostCeilingCents', () => {
    it('rejects value below min (0)', () => {
      const result = patchBodySchema.safeParse({
        perSubaccountDailyCostCeilingCents: 0,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts min value (1)', () => {
      const result = patchBodySchema.safeParse({
        perSubaccountDailyCostCeilingCents: 1,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects value above max (100001)', () => {
      const result = patchBodySchema.safeParse({
        perSubaccountDailyCostCeilingCents: 100001,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts max value (100000)', () => {
      const result = patchBodySchema.safeParse({
        perSubaccountDailyCostCeilingCents: 100000,
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('status', () => {
    it('rejects invalid status value', () => {
      const result = patchBodySchema.safeParse({
        status: 'enabled',
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts "on"', () => {
      const result = patchBodySchema.safeParse({
        status: 'on',
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });

    it('accepts "off"', () => {
      const result = patchBodySchema.safeParse({
        status: 'off',
        expectedSettingsVersion: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  it('rejects rolloutApproved (strict mode — not accepted in this schema)', () => {
    // rolloutApproved is admin-only — the schema is .strict() so unknown keys
    // return a parse failure instead of silently stripping. Callers know their
    // patch was not applied; the dedicated admin rollout-approval route is the
    // only path that mutates rolloutApproved.
    const body = { status: 'on', expectedSettingsVersion: 1, rolloutApproved: true };
    const result = patchBodySchema.safeParse(body);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected parse failure for rolloutApproved');
    // Zod's strict-mode error for unknown keys uses code 'unrecognized_keys'
    // and lists the offending keys in the `keys` field.
    const unrecognised = result.error.errors.find((e) => e.code === 'unrecognized_keys');
    expect(unrecognised).toBeDefined();
    expect((unrecognised as { keys?: string[] }).keys).toContain('rolloutApproved');
  });

  it('requires expectedSettingsVersion', () => {
    const result = patchBodySchema.safeParse({ status: 'on' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rolloutBodySchema
// ---------------------------------------------------------------------------

describe('rolloutBodySchema', () => {
  it('accepts valid body', () => {
    const result = rolloutBodySchema.safeParse({ approved: true, expectedSettingsVersion: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approved).toBe(true);
      expect(result.data.expectedSettingsVersion).toBe(2);
    }
  });

  it('rejects missing approved', () => {
    const result = rolloutBodySchema.safeParse({ expectedSettingsVersion: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean approved', () => {
    const result = rolloutBodySchema.safeParse({ approved: 'yes', expectedSettingsVersion: 1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isETagConflict
// ---------------------------------------------------------------------------

describe('isETagConflict', () => {
  it('returns true when expected !== current (3 vs 5)', () => {
    expect(isETagConflict(3, 5)).toBe(true);
  });

  it('returns false when expected === current (3 vs 3)', () => {
    expect(isETagConflict(3, 3)).toBe(false);
  });

  it('returns true when expected is 0 and current is 1', () => {
    expect(isETagConflict(0, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isLazyCreate
// ---------------------------------------------------------------------------

describe('isLazyCreate', () => {
  it('returns true when expectedVersion === 0 and row absent', () => {
    expect(isLazyCreate(0, false)).toBe(true);
  });

  it('returns false when expectedVersion === 0 but row exists', () => {
    expect(isLazyCreate(0, true)).toBe(false);
  });

  it('returns false when expectedVersion === 1 and row absent', () => {
    expect(isLazyCreate(1, false)).toBe(false);
  });

  it('returns false when expectedVersion > 0 and row exists', () => {
    expect(isLazyCreate(3, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isLazyCreatePkConflict
// ---------------------------------------------------------------------------

describe('isLazyCreatePkConflict', () => {
  it('returns true for PG unique violation code 23505', () => {
    expect(isLazyCreatePkConflict({ code: '23505' })).toBe(true);
  });

  it('returns false for other PG error code 42P01', () => {
    expect(isLazyCreatePkConflict({ code: '42P01' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isLazyCreatePkConflict(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isLazyCreatePkConflict('23505')).toBe(false);
  });

  it('returns false for object with no code', () => {
    expect(isLazyCreatePkConflict({ message: 'duplicate key' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRolloutAuditRow
// ---------------------------------------------------------------------------

describe('buildRolloutAuditRow', () => {
  const params = {
    actorUserId: 'user-uuid-123',
    orgId: 'org-uuid-456',
    subaccountId: 'sub-uuid-789',
    priorValue: false,
    newValue: true,
  };

  it('produces the correct action', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.action).toBe('iee_browser.rollout_approval_set');
  });

  it('sets actorType to user', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.actorType).toBe('user');
  });

  it('sets actorId to actorUserId', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.actorId).toBe('user-uuid-123');
  });

  it('sets organisationId', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.organisationId).toBe('org-uuid-456');
  });

  it('sets entityType to subaccount_iee_browser_settings', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.entityType).toBe('subaccount_iee_browser_settings');
  });

  it('sets entityId to subaccountId', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.entityId).toBe('sub-uuid-789');
  });

  it('sets metadata with priorValue and newValue', () => {
    const row = buildRolloutAuditRow(params);
    expect(row.metadata).toEqual({ priorValue: false, newValue: true });
  });

  it('captures newValue: false correctly', () => {
    const row = buildRolloutAuditRow({ ...params, priorValue: true, newValue: false });
    expect(row.metadata).toEqual({ priorValue: true, newValue: false });
  });
});

// ---------------------------------------------------------------------------
// synthesiseDefaults
// ---------------------------------------------------------------------------

describe('synthesiseDefaults', () => {
  const defaults = synthesiseDefaults('sub-1', 'org-1');

  it('returns settingsVersion: 0 (sentinel)', () => {
    expect(defaults.settingsVersion).toBe(0);
  });

  it('returns status: off', () => {
    expect(defaults.status).toBe('off');
  });

  it('returns rolloutApproved: false', () => {
    expect(defaults.rolloutApproved).toBe(false);
  });

  it('returns browserProfileRetentionDays: 30', () => {
    expect(defaults.browserProfileRetentionDays).toBe(30);
  });

  it('returns perTaskCostCeilingCents: 100', () => {
    expect(defaults.perTaskCostCeilingCents).toBe(100);
  });

  it('returns perSubaccountDailyCostCeilingCents: 500', () => {
    expect(defaults.perSubaccountDailyCostCeilingCents).toBe(500);
  });

  it('returns null updatedAt', () => {
    expect(defaults.updatedAt).toBeNull();
  });

  it('returns null updatedByUserId', () => {
    expect(defaults.updatedByUserId).toBeNull();
  });

  it('forwards subaccountId', () => {
    expect(defaults.subaccountId).toBe('sub-1');
  });

  it('forwards organisationId', () => {
    expect(defaults.organisationId).toBe('org-1');
  });
});
