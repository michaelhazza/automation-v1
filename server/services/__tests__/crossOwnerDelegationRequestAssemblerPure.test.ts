import { describe, it, expect } from 'vitest';
import {
  deriveTimeoutPolicy,
  deriveDelegationScope,
} from '../crossOwnerDelegationRequestAssemblerPure.js';

describe('deriveTimeoutPolicy', () => {
  it('returns fail_parent by default', () => {
    expect(deriveTimeoutPolicy({})).toBe('fail_parent');
  });

  it('returns continue_without_substep when optional=true', () => {
    expect(deriveTimeoutPolicy({ optional: true })).toBe('continue_without_substep');
  });

  it('returns ask_initiator when explicit_fallback_to_initiator=true', () => {
    expect(deriveTimeoutPolicy({ explicit_fallback_to_initiator: true })).toBe('ask_initiator');
  });

  it('explicit_fallback_to_initiator takes precedence over optional', () => {
    expect(deriveTimeoutPolicy({ optional: true, explicit_fallback_to_initiator: true })).toBe('ask_initiator');
  });
});

describe('deriveDelegationScope', () => {
  it('defaults to subaccount when no parent scope and no payload', () => {
    expect(deriveDelegationScope(null, {})).toBe('subaccount');
  });

  it('inherits parent scope when no payload override', () => {
    expect(deriveDelegationScope('children', {})).toBe('children');
  });

  it('uses payload scope when specified', () => {
    expect(deriveDelegationScope(null, { delegation_scope: 'descendants' })).toBe('descendants');
  });
});
