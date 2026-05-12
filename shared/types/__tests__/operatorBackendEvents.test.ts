import { describe, it, expect } from 'vitest';
import {
  OPERATOR_SESSION_EVENT_NAMES,
  enumerateOperatorEventNames,
} from '../operatorBackendEvents.js';

const EXPECTED_NAMESPACE_PREFIX = 'operator-session.';

describe('OPERATOR_SESSION_EVENT_NAMES', () => {
  it('every event name starts with the operator-session. namespace', () => {
    for (const name of OPERATOR_SESSION_EVENT_NAMES) {
      expect(name).toMatch(new RegExp(`^${EXPECTED_NAMESPACE_PREFIX}`));
    }
  });

  it('contains no duplicate event names', () => {
    const unique = new Set(OPERATOR_SESSION_EVENT_NAMES);
    expect(unique.size).toBe(OPERATOR_SESSION_EVENT_NAMES.length);
  });

  it('contains exactly 20 event names (spec §4.7 closed set)', () => {
    expect(OPERATOR_SESSION_EVENT_NAMES.length).toBe(20);
  });

  it('contains the expected core event names', () => {
    const names = new Set(OPERATOR_SESSION_EVENT_NAMES);
    expect(names.has('operator-session.dispatched')).toBe(true);
    expect(names.has('operator-session.chain_link_completed')).toBe(true);
    expect(names.has('operator-session.chain_link_failed')).toBe(true);
    expect(names.has('operator-session.task_completed')).toBe(true);
    expect(names.has('operator-session.task_failed')).toBe(true);
    expect(names.has('operator-session.task_cancelled')).toBe(true);
    expect(names.has('operator-session.fresh_profile_restart')).toBe(true);
    expect(names.has('operator-session.usability_restored')).toBe(true);
  });

  it('does NOT contain incident-namespace (operator.*) events', () => {
    for (const name of OPERATOR_SESSION_EVENT_NAMES) {
      expect(name).not.toMatch(/^operator\.[^s]/);
    }
  });
});

describe('enumerateOperatorEventNames', () => {
  it('returns the same array as OPERATOR_SESSION_EVENT_NAMES', () => {
    const result = enumerateOperatorEventNames();
    expect(result).toEqual(OPERATOR_SESSION_EVENT_NAMES);
  });
});
