import { describe, it, expect } from 'vitest';
import { deriveSessionKey, resolveBrowserDispatch } from '../_ieeShared.js';

describe('deriveSessionKey', () => {
  it('returns skillId when provided', () => {
    expect(deriveSessionKey({ skillId: 'browse-google' })).toBe('browse-google');
  });

  it('returns default when skillId is undefined', () => {
    expect(deriveSessionKey({ skillId: undefined })).toBe('default');
  });

  it('returns default when skillId is empty after sanitization', () => {
    expect(deriveSessionKey({ skillId: '   ' })).toBe('default');
  });

  it('truncates skillId to 128 chars', () => {
    const long = 'a'.repeat(200);
    expect(deriveSessionKey({ skillId: long })).toHaveLength(128);
  });
});

describe('resolveBrowserDispatch', () => {
  const enabledSettings = { status: 'on', rolloutApproved: true, perTaskCostCeilingCents: 100 };
  const disabledSettings = { status: 'off', rolloutApproved: true, perTaskCostCeilingCents: 100 };
  const notApprovedSettings = { status: 'on', rolloutApproved: false, perTaskCostCeilingCents: 100 };

  it('returns launch_disabled when settings is null', () => {
    expect(resolveBrowserDispatch(null, null).kind).toBe('launch_disabled');
  });

  it('returns launch_disabled when status is off', () => {
    expect(resolveBrowserDispatch(disabledSettings, null).kind).toBe('launch_disabled');
  });

  it('returns launch_disabled when rolloutApproved is false', () => {
    expect(resolveBrowserDispatch(notApprovedSettings, null).kind).toBe('launch_disabled');
  });

  it('returns warm_leased when enabled and warm checkout available', () => {
    const decision = resolveBrowserDispatch(enabledSettings, { warmSessionId: 'ws1', sandboxId: 'sb1' });
    expect(decision.kind).toBe('warm_leased');
  });

  it('returns cold_start when enabled but no warm checkout', () => {
    expect(resolveBrowserDispatch(enabledSettings, null).kind).toBe('cold_start');
  });
});
