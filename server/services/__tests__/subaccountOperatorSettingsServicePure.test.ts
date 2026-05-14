import { describe, expect, it } from 'vitest';

import {
  validateOperatorSettingsField,
  validateOperatorSettingsRange,
  deriveSettingsETag,
  extractSettingsSnapshot,
  getDefaultSettingsSnapshot,
  OPERATOR_SETTINGS_RANGES,
} from '../subaccountOperatorSettingsServicePure.js';
import { OperatorPureValidationError } from '../executionBackends/operatorManagedBackendPure.js';

describe('validateOperatorSettingsField', () => {
  describe('session_soft_cap_minutes [30, 240]', () => {
    it('accepts min boundary (30)', () => {
      expect(() => validateOperatorSettingsField('session_soft_cap_minutes', 30)).not.toThrow();
    });
    it('accepts max boundary (240)', () => {
      expect(() => validateOperatorSettingsField('session_soft_cap_minutes', 240)).not.toThrow();
    });
    it('accepts midpoint (120)', () => {
      expect(() => validateOperatorSettingsField('session_soft_cap_minutes', 120)).not.toThrow();
    });
    it('rejects below min (29)', () => {
      expect(() => validateOperatorSettingsField('session_soft_cap_minutes', 29)).toThrow(
        OperatorPureValidationError,
      );
    });
    it('rejects above max (241)', () => {
      expect(() => validateOperatorSettingsField('session_soft_cap_minutes', 241)).toThrow(
        OperatorPureValidationError,
      );
    });
    it('rejects non-integer', () => {
      expect(() => validateOperatorSettingsField('session_soft_cap_minutes', 120.5)).toThrow(
        OperatorPureValidationError,
      );
    });
  });

  describe('auto_extend_grace_minutes [0, 60]', () => {
    it('accepts 0 (min boundary)', () => {
      expect(() => validateOperatorSettingsField('auto_extend_grace_minutes', 0)).not.toThrow();
    });
    it('accepts 60 (max boundary)', () => {
      expect(() => validateOperatorSettingsField('auto_extend_grace_minutes', 60)).not.toThrow();
    });
    it('rejects -1', () => {
      expect(() => validateOperatorSettingsField('auto_extend_grace_minutes', -1)).toThrow(
        OperatorPureValidationError,
      );
    });
    it('rejects 61', () => {
      expect(() => validateOperatorSettingsField('auto_extend_grace_minutes', 61)).toThrow(
        OperatorPureValidationError,
      );
    });
  });

  describe('max_chain_length [1, 500]', () => {
    it('accepts 1 (min boundary)', () => {
      expect(() => validateOperatorSettingsField('max_chain_length', 1)).not.toThrow();
    });
    it('accepts 500 (max boundary)', () => {
      expect(() => validateOperatorSettingsField('max_chain_length', 500)).not.toThrow();
    });
    it('rejects 0', () => {
      expect(() => validateOperatorSettingsField('max_chain_length', 0)).toThrow(
        OperatorPureValidationError,
      );
    });
    it('rejects 501', () => {
      expect(() => validateOperatorSettingsField('max_chain_length', 501)).toThrow(
        OperatorPureValidationError,
      );
    });
  });

  describe('max_wall_clock_per_task_days [1, 365]', () => {
    it('accepts 1 (min boundary)', () => {
      expect(() =>
        validateOperatorSettingsField('max_wall_clock_per_task_days', 1),
      ).not.toThrow();
    });
    it('accepts 365 (max boundary)', () => {
      expect(() =>
        validateOperatorSettingsField('max_wall_clock_per_task_days', 365),
      ).not.toThrow();
    });
    it('rejects 0', () => {
      expect(() =>
        validateOperatorSettingsField('max_wall_clock_per_task_days', 0),
      ).toThrow(OperatorPureValidationError);
    });
    it('rejects 366', () => {
      expect(() =>
        validateOperatorSettingsField('max_wall_clock_per_task_days', 366),
      ).toThrow(OperatorPureValidationError);
    });
  });

  describe('per_task_budget_cap_minutes [60, 60000]', () => {
    it('accepts 60 (min boundary)', () => {
      expect(() =>
        validateOperatorSettingsField('per_task_budget_cap_minutes', 60),
      ).not.toThrow();
    });
    it('accepts 60000 (max boundary)', () => {
      expect(() =>
        validateOperatorSettingsField('per_task_budget_cap_minutes', 60000),
      ).not.toThrow();
    });
    it('rejects 59', () => {
      expect(() =>
        validateOperatorSettingsField('per_task_budget_cap_minutes', 59),
      ).toThrow(OperatorPureValidationError);
    });
    it('rejects 60001', () => {
      expect(() =>
        validateOperatorSettingsField('per_task_budget_cap_minutes', 60001),
      ).toThrow(OperatorPureValidationError);
    });
  });

  describe('concurrent_operator_sessions_cap [1, 25]', () => {
    it('accepts 1 (min boundary)', () => {
      expect(() =>
        validateOperatorSettingsField('concurrent_operator_sessions_cap', 1),
      ).not.toThrow();
    });
    it('accepts 25 (max boundary)', () => {
      expect(() =>
        validateOperatorSettingsField('concurrent_operator_sessions_cap', 25),
      ).not.toThrow();
    });
    it('rejects 0', () => {
      expect(() =>
        validateOperatorSettingsField('concurrent_operator_sessions_cap', 0),
      ).toThrow(OperatorPureValidationError);
    });
    it('rejects 26', () => {
      expect(() =>
        validateOperatorSettingsField('concurrent_operator_sessions_cap', 26),
      ).toThrow(OperatorPureValidationError);
    });
  });
});

describe('validateOperatorSettingsRange', () => {
  it('accepts a valid partial patch', () => {
    expect(() =>
      validateOperatorSettingsRange({ session_soft_cap_minutes: 90, max_chain_length: 100 }),
    ).not.toThrow();
  });

  it('throws on first invalid field in the patch', () => {
    expect(() =>
      validateOperatorSettingsRange({ session_soft_cap_minutes: 1 }),
    ).toThrow(OperatorPureValidationError);
  });

  it('accepts an empty patch (no fields provided)', () => {
    expect(() => validateOperatorSettingsRange({})).not.toThrow();
  });
});

describe('deriveSettingsETag — R2-F3 integer version', () => {
  it('ETag for version 1 is exactly "1"', () => {
    expect(deriveSettingsETag(1)).toBe('1');
  });

  it('ETag for version 2 is exactly "2"', () => {
    expect(deriveSettingsETag(2)).toBe('2');
  });

  it('ETag is NOT timestamp-based (no date/time string)', () => {
    const etag1 = deriveSettingsETag(1);
    const etag2 = deriveSettingsETag(2);
    // Must be numeric string representations only
    expect(Number.isFinite(Number(etag1))).toBe(true);
    expect(Number.isFinite(Number(etag2))).toBe(true);
    // Must differ for different versions — collision-free for same-second writes
    expect(etag1).not.toBe(etag2);
  });

  it('two writes in the same second produce different ETags (collision-free)', () => {
    // If we increment version by 1 (the PATCH rule), ETags are always different
    const etag1 = deriveSettingsETag(7);
    const etag2 = deriveSettingsETag(8);
    expect(etag1).not.toBe(etag2);
  });
});

describe('extractSettingsSnapshot', () => {
  it('extracts all six snapshot fields from a settings row', () => {
    const row = {
      session_soft_cap_minutes: 90,
      auto_extend_grace_minutes: 15,
      max_chain_length: 100,
      max_wall_clock_per_task_days: 14,
      per_task_budget_cap_minutes: 3000,
      concurrent_operator_sessions_cap: 3,
    };
    const snapshot = extractSettingsSnapshot(row);
    expect(snapshot).toEqual(row);
  });
});

describe('getDefaultSettingsSnapshot', () => {
  it('returns defaults matching OPERATOR_SETTINGS_RANGES', () => {
    const defaults = getDefaultSettingsSnapshot();
    for (const [field, range] of Object.entries(OPERATOR_SETTINGS_RANGES)) {
      expect(
        defaults[field as keyof typeof defaults],
        `default for ${field}`,
      ).toBe(range.default);
    }
  });
});
